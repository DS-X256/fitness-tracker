// Live, stateless research lookups the AI Coach can call for a *named compound* — never a userId. This
// is deliberately the opposite shape from ./tools.ts: those are thin, userId-scoped wrappers over this
// app's own repositories with no new query logic; this file has real parsing/synthesis logic over public,
// external, keyless biomedical APIs (NCBI E-utilities / PubMed, ClinicalTrials.gov) and touches no user
// data at all — the only thing that can ever reach an outbound URL from here is a compound-name string.
//
// Phase 1 only: PubMed + ClinicalTrials.gov. An openFDA layer for FDA-approved compounds (semaglutide,
// tirzepatide, tesamorelin, PT-141, ...) is a deliberate follow-up (Phase 2), not built here — the `fda`
// field is simply omitted from the response rather than shipped as an always-empty stub.
//
// Never throws: every upstream call is independently time-boxed and caught, matching tools.ts's runTool
// contract, so one dead/slow source degrades gracefully instead of failing the whole tool call.

import type Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';

const USER_AGENT = 'FitnessTracker-AICoach/1.0 (self-hosted; peptide-research tool)';
const SOURCE_TIMEOUT_MS = 6_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

export const RESEARCH_TOOLS: Anthropic.Tool[] = [
	{
		name: 'research_peptide',
		description:
			"Live evidence lookup for a specific peptide/compound: recent PubMed literature and ClinicalTrials.gov trial status. Use for any question about a compound's current evidence, whether it's proven/legit, its trial status, or how solid its safety data is — prefer this over general background knowledge whenever the user names a specific compound. Returns an evidence-tier verdict plus citable PMIDs/NCT IDs.",
		input_schema: {
			type: 'object',
			properties: {
				compound: { type: 'string', description: 'Compound name, e.g. "BPC-157", "Tirzepatide", "TB-500".' }
			},
			required: ['compound']
		}
	}
];

export function researchToolLabel(name: string): string {
	switch (name) {
		case 'research_peptide':
			return 'Researching current evidence…';
		default:
			return 'Researching…';
	}
}

/** Dispatch a research tool call and return the tool_result content (JSON string). Never throws — a
 *  total failure still returns a JSON payload describing what went wrong, so the model can say so. */
export async function runResearchTool(name: string, input: Record<string, unknown>): Promise<string> {
	try {
		switch (name) {
			case 'research_peptide':
				return JSON.stringify(await researchPeptide(String(input.compound ?? '').trim()));
			default:
				return JSON.stringify({ error: `Unknown tool: ${name}` });
		}
	} catch (err) {
		console.error(`AI research tool ${name} failed`, err);
		return JSON.stringify({ error: 'Live research lookups are unavailable right now.' });
	}
}

// --- types -------------------------------------------------------------------------------------------

type StudyType = 'human-rct' | 'human-other' | 'review' | 'animal' | 'unknown';
type EvidenceTier = 'fda-approved' | 'human-rct' | 'human-pilot' | 'preclinical-only' | 'no-data';
type SourceStatus = 'ok' | 'timeout' | 'error';

interface PubMedArticle {
	pmid: string;
	title: string;
	journal: string | null;
	year: number | null;
	studyType: StudyType;
}

interface PubMedResult {
	status: SourceStatus;
	totalResultCount: number;
	articles: PubMedArticle[];
}

interface Trial {
	nctId: string;
	title: string;
	status: string | null;
	phase: string | null;
	conditions: string[];
}

interface TrialsResult {
	status: SourceStatus;
	totalCount: number;
	trials: Trial[];
}

interface ResearchBundle {
	compound: string;
	evidenceTier: EvidenceTier;
	evidenceSummary: string;
	pubmed: { totalResultCount: number; articles: PubMedArticle[] };
	clinicalTrials: { totalCount: number; trials: Trial[] };
	sourcesQueried: { pubmed: SourceStatus; clinicalTrials: SourceStatus };
	asOf: string;
}

// --- cache ---------------------------------------------------------------------------------------------

const cache = new Map<string, { bundle: ResearchBundle; expiresAt: number }>();

function cacheKey(compound: string): string {
	return compound.trim().toLowerCase();
}

function getCached(compound: string): ResearchBundle | null {
	const hit = cache.get(cacheKey(compound));
	if (!hit) return null;
	if (Date.now() > hit.expiresAt) {
		cache.delete(cacheKey(compound));
		return null;
	}
	return hit.bundle;
}

function setCached(compound: string, bundle: ResearchBundle): void {
	const key = cacheKey(compound);
	if (!cache.has(key) && cache.size >= CACHE_MAX_ENTRIES) {
		// Simple insertion-order eviction — a bound on unbounded growth, not an LRU.
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	cache.set(key, { bundle, expiresAt: Date.now() + CACHE_TTL_MS });
}

// --- orchestration -------------------------------------------------------------------------------------

async function researchPeptide(compound: string): Promise<ResearchBundle | { error: string }> {
	if (!compound) return { error: 'No compound name given.' };

	const cached = getCached(compound);
	if (cached) return cached;

	const [pubmedSettled, trialsSettled] = await Promise.allSettled([fetchPubMed(compound), fetchClinicalTrials(compound)]);

	const pubmed: PubMedResult =
		pubmedSettled.status === 'fulfilled' ? pubmedSettled.value : { status: 'error', totalResultCount: 0, articles: [] };
	const trials: TrialsResult =
		trialsSettled.status === 'fulfilled' ? trialsSettled.value : { status: 'error', totalCount: 0, trials: [] };

	const evidenceTier = classifyEvidenceTier(pubmed, trials);
	const bundle: ResearchBundle = {
		compound,
		evidenceTier,
		evidenceSummary: summarizeEvidence(evidenceTier, pubmed, trials),
		pubmed: { totalResultCount: pubmed.totalResultCount, articles: pubmed.articles },
		clinicalTrials: { totalCount: trials.totalCount, trials: trials.trials },
		sourcesQueried: { pubmed: pubmed.status, clinicalTrials: trials.status },
		asOf: new Date().toISOString().slice(0, 10)
	};

	// Only cache a bundle if at least one source actually answered — don't lock in a fully-failed
	// lookup for 6 hours when the next question might hit a source that's recovered by then.
	if (pubmed.status === 'ok' || trials.status === 'ok') setCached(compound, bundle);
	return bundle;
}

function classifyEvidenceTier(pubmed: PubMedResult, trials: TrialsResult): EvidenceTier {
	const hasRegisteredTrial = trials.trials.length > 0;
	const hasRctArticle = pubmed.articles.some((a) => a.studyType === 'human-rct');
	if (hasRegisteredTrial || hasRctArticle) return 'human-rct';

	const hasHumanOtherArticle = pubmed.articles.some((a) => a.studyType === 'human-other');
	if (hasHumanOtherArticle) return 'human-pilot';

	if (pubmed.totalResultCount > 0) return 'preclinical-only';
	return 'no-data';
}

function summarizeEvidence(tier: EvidenceTier, pubmed: PubMedResult, trials: TrialsResult): string {
	switch (tier) {
		// Not reachable in Phase 1 — classifyEvidenceTier never returns this until the openFDA layer
		// (Phase 2) exists — kept here so the EvidenceTier union stays exhaustively handled.
		case 'fda-approved':
			return 'FDA-approved compound; established label and safety data exist.';
		case 'human-rct':
			return `Human trial evidence exists: ${trials.totalCount} registered clinical trial(s) and/or RCT-classified publications found. Still not the same as FDA approval — check the trial phase/status and the article details.`;
		case 'human-pilot':
			return `Human studies exist but appear limited to small, uncontrolled, or observational work (${pubmed.totalResultCount} PubMed results total) — no randomized controlled trials or registered clinical trials identified.`;
		case 'preclinical-only':
			return `Evidence is limited to animal/in-vitro or unclassified studies (${pubmed.totalResultCount} PubMed results found); no human studies or registered clinical trials identified.`;
		case 'no-data':
			return 'No meaningful PubMed literature or registered clinical trials found under this name — double-check spelling, or it may not be a widely studied/named compound.';
	}
}

// --- PubMed (NCBI E-utilities) -------------------------------------------------------------------------

async function fetchPubMed(compound: string): Promise<PubMedResult> {
	const apiKeyParam = env.NCBI_API_KEY?.trim() ? `&api_key=${encodeURIComponent(env.NCBI_API_KEY.trim())}` : '';
	const searchUrl =
		`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=5&sort=relevance` +
		`&term=${encodeURIComponent(compound)}&tool=fitness-tracker-ai-coach${apiKeyParam}`;

	let searchRes: Response;
	try {
		searchRes = await fetchWithTimeout(searchUrl);
	} catch (err) {
		return { status: isTimeout(err) ? 'timeout' : 'error', totalResultCount: 0, articles: [] };
	}
	if (!searchRes.ok) return { status: 'error', totalResultCount: 0, articles: [] };

	const searchBody = (await searchRes.json().catch(() => null)) as {
		esearchresult?: { count?: string; idlist?: string[] };
	} | null;
	const ids = searchBody?.esearchresult?.idlist ?? [];
	const totalResultCount = Number(searchBody?.esearchresult?.count ?? 0) || 0;
	if (ids.length === 0) return { status: 'ok', totalResultCount, articles: [] };

	const summaryUrl =
		`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json` +
		`&id=${ids.map(encodeURIComponent).join(',')}&tool=fitness-tracker-ai-coach${apiKeyParam}`;

	let summaryRes: Response;
	try {
		summaryRes = await fetchWithTimeout(summaryUrl);
	} catch (err) {
		// The search succeeded, so we at least know how many results exist even without details.
		return { status: isTimeout(err) ? 'timeout' : 'error', totalResultCount, articles: [] };
	}
	if (!summaryRes.ok) return { status: 'error', totalResultCount, articles: [] };

	const summaryBody = (await summaryRes.json().catch(() => null)) as {
		result?: Record<string, { uid?: string; title?: string; fulljournalname?: string; pubdate?: string; pubtype?: string[] }>;
	} | null;

	const articles: PubMedArticle[] = ids
		.map((id) => summaryBody?.result?.[id])
		.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
		.map((entry) => ({
			pmid: entry.uid ?? '',
			title: entry.title?.trim() || 'Untitled',
			journal: entry.fulljournalname?.trim() || null,
			year: parseYear(entry.pubdate),
			studyType: classifyStudyType(entry.pubtype ?? [])
		}))
		.filter((a) => a.pmid);

	return { status: 'ok', totalResultCount, articles };
}

function classifyStudyType(pubtype: string[]): StudyType {
	const types = pubtype.map((t) => t.toLowerCase());
	if (types.some((t) => t.includes('randomized controlled trial') || t.includes('clinical trial'))) return 'human-rct';
	if (types.some((t) => t.includes('observational study') || t.includes('case reports') || t.includes('comparative study')))
		return 'human-other';
	if (types.some((t) => t.includes('review'))) return 'review';
	return 'unknown';
}

function parseYear(pubdate: string | undefined): number | null {
	const match = pubdate?.match(/\d{4}/);
	return match ? Number(match[0]) : null;
}

// --- ClinicalTrials.gov ----------------------------------------------------------------------------------

async function fetchClinicalTrials(compound: string): Promise<TrialsResult> {
	const url =
		`https://clinicaltrials.gov/api/v2/studies?pageSize=5&countTotal=true` +
		`&query.intr=${encodeURIComponent(compound)}`;

	let res: Response;
	try {
		res = await fetchWithTimeout(url);
	} catch (err) {
		return { status: isTimeout(err) ? 'timeout' : 'error', totalCount: 0, trials: [] };
	}
	if (!res.ok) return { status: 'error', totalCount: 0, trials: [] };

	const body = (await res.json().catch(() => null)) as {
		studies?: Array<{
			protocolSection?: {
				identificationModule?: { nctId?: string; briefTitle?: string };
				statusModule?: { overallStatus?: string };
				designModule?: { phases?: string[] };
				conditionsModule?: { conditions?: string[] };
			};
		}>;
		totalCount?: number;
	} | null;

	const trials: Trial[] = (body?.studies ?? [])
		.map((s) => {
			const p = s.protocolSection;
			return {
				nctId: p?.identificationModule?.nctId ?? '',
				title: p?.identificationModule?.briefTitle?.trim() || 'Untitled trial',
				status: p?.statusModule?.overallStatus ?? null,
				phase: p?.designModule?.phases?.[0] ?? null,
				conditions: p?.conditionsModule?.conditions ?? []
			};
		})
		.filter((t) => t.nctId);

	return { status: 'ok', totalCount: body?.totalCount ?? trials.length, trials };
}

// --- shared fetch helper -----------------------------------------------------------------------------

async function fetchWithTimeout(url: string): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
	try {
		return await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

function isTimeout(err: unknown): boolean {
	return err instanceof Error && err.name === 'AbortError';
}
