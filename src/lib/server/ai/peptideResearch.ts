// Live, stateless research lookups the AI Coach can call for a *named compound* — never a userId. This
// is deliberately the opposite shape from ./tools.ts: those are thin, userId-scoped wrappers over this
// app's own repositories with no new query logic; this file has real parsing/synthesis logic over public,
// external, keyless biomedical APIs (NCBI E-utilities / PubMed, ClinicalTrials.gov) and touches no user
// data at all — the only thing that can ever reach an outbound URL from here is a compound-name string.
//
// PubMed + ClinicalTrials.gov, searched under each compound's published synonyms, with abstracts for the
// top papers so the model can reason from what studies actually found rather than titles alone. FDA
// approval comes from a small static table (literature counts can't tell "approved" from "well studied").
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
			"Live evidence lookup for ONE compound (not a blend — look up each component separately): PubMed literature searched under its common synonyms, with a separate count of human studies, the abstracts of the most relevant papers, registered ClinicalTrials.gov trials (status, phase, size, whether results are posted), FDA-approval status where applicable, and an evidence-tier verdict. Use it for any question about what the evidence shows, whether something works or is safe, what doses were studied, or trial status. Cite results as PMID/NCT numbers.",
		input_schema: {
			type: 'object',
			properties: {
				compound: { type: 'string', description: 'Compound name, e.g. "BPC-157", "Tirzepatide", "TB-500", "GHK-Cu".' }
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

type EvidenceTier =
	| 'fda-approved'
	| 'human-rct'
	| 'human-trial'
	| 'registered-trials-only'
	| 'human-case-reports'
	| 'preclinical-only'
	| 'no-data'
	| 'lookup-failed';
type SourceStatus = 'ok' | 'timeout' | 'error';

interface PubMedArticle {
	pmid: string;
	title: string;
	journal: string | null;
	year: number | null;
	publicationTypes: string[];
	/** Matched the human-studies query (MeSH "Humans" + a clinical/observational publication type). */
	humanStudy: boolean;
	/** Abstract text, truncated. Null when PubMed has none or the fetch failed. */
	abstract: string | null;
}

interface PubMedResult {
	status: SourceStatus;
	totalResultCount: number;
	humanStudyCount: number;
	articles: PubMedArticle[];
}

interface Trial {
	nctId: string;
	title: string;
	status: string | null;
	phase: string | null;
	conditions: string[];
	enrollment: number | null;
	startDate: string | null;
	hasResults: boolean;
}

interface TrialsResult {
	status: SourceStatus;
	totalCount: number;
	trials: Trial[];
}

interface ResearchBundle {
	compound: string;
	searchedAs: string[];
	evidenceTier: EvidenceTier;
	evidenceSummary: string;
	approval: string | null;
	pubmed: { totalResultCount: number; humanStudyCount: number; articles: PubMedArticle[] };
	clinicalTrials: { totalCount: number; trials: Trial[] };
	sourcesQueried: { pubmed: SourceStatus; clinicalTrials: SourceStatus };
	asOf: string;
}

// --- reference tables ------------------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.]+/g, '');

/** Names a compound is published under — research-peptide literature rarely uses the street name alone
 *  (TB-500 is studied as thymosin β4, PT-141 as bremelanotide), so a single-term search badly undercounts. */
const SYNONYMS: Record<string, string[]> = {
	bpc157: ['BPC-157', 'BPC 157', 'pentadecapeptide BPC 157', 'body protection compound 157'],
	tb500: ['TB-500', 'thymosin beta-4', 'thymosin beta 4', 'Tbeta4'],
	thymosinbeta4: ['thymosin beta-4', 'TB-500'],
	ghkcu: ['GHK-Cu', 'copper tripeptide GHK', 'GHK copper', 'glycyl-L-histidyl-L-lysine'],
	kpv: ['KPV tripeptide', 'Lys-Pro-Val', 'alpha-MSH KPV'],
	cjc1295: ['CJC-1295', 'CJC 1295', 'modified GRF 1-29', 'DAC GRF'],
	ipamorelin: ['ipamorelin', 'NNC 26-0161'],
	sermorelin: ['sermorelin', 'GHRH 1-29'],
	tesamorelin: ['tesamorelin', 'TH9507'],
	semaglutide: ['semaglutide'],
	tirzepatide: ['tirzepatide', 'LY3298176'],
	retatrutide: ['retatrutide', 'LY3437943'],
	cagrilintide: ['cagrilintide', 'CagriSema'],
	liraglutide: ['liraglutide'],
	survodutide: ['survodutide', 'BI 456906'],
	aod9604: ['AOD9604', 'AOD-9604', 'hGH fragment 177-191'],
	pt141: ['bremelanotide', 'PT-141'],
	bremelanotide: ['bremelanotide', 'PT-141'],
	melanotan1: ['afamelanotide', 'melanotan I', 'melanotan-1'],
	melanotan2: ['melanotan II', 'melanotan-2'],
	motsc: ['MOTS-c', 'mitochondrial ORF of the 12S rRNA type-c'],
	ss31: ['elamipretide', 'SS-31'],
	epitalon: ['epitalon', 'epithalon', 'Ala-Glu-Asp-Gly'],
	selank: ['selank'],
	semax: ['semax'],
	thymosinalpha1: ['thymosin alpha 1', 'thymalfasin'],
	ta1: ['thymosin alpha 1', 'thymalfasin'],
	dsip: ['delta sleep-inducing peptide', 'DSIP'],
	kisspeptin: ['kisspeptin'],
	ll37: ['LL-37', 'cathelicidin LL-37'],
	ghrp6: ['GHRP-6', 'growth hormone releasing peptide-6'],
	ghrp2: ['GHRP-2', 'pralmorelin'],
	hexarelin: ['hexarelin']
};

/** FDA-approved compounds (as drug products) — the one tier literature counts can't infer. */
const APPROVALS: Record<string, string> = {
	semaglutide: 'FDA-approved (Ozempic, Wegovy, Rybelsus)',
	tirzepatide: 'FDA-approved (Mounjaro, Zepbound)',
	liraglutide: 'FDA-approved (Victoza, Saxenda)',
	dulaglutide: 'FDA-approved (Trulicity)',
	exenatide: 'FDA-approved (Byetta, Bydureon)',
	tesamorelin: 'FDA-approved (Egrifta) for HIV-associated abdominal fat',
	bremelanotide: 'FDA-approved (Vyleesi) for premenopausal HSDD',
	pt141: 'FDA-approved as bremelanotide (Vyleesi) for premenopausal HSDD',
	setmelanotide: 'FDA-approved (Imcivree) for specific genetic obesities',
	melanotan1: 'Approved as afamelanotide (Scenesse) implant for erythropoietic protoporphyria — not the same as research "Melanotan I"',
	sermorelin: 'Previously FDA-approved (Geref), discontinued by the maker in 2008'
};

const BLEND_NAMES: Record<string, string> = {
	klow: 'KLOW is a blend (commonly GHK-Cu + BPC-157 + TB-500 + KPV)',
	glow: 'GLOW is a blend (commonly GHK-Cu + BPC-157 + TB-500)',
	wolverine: '"Wolverine" is a blend (BPC-157 + TB-500)'
};

function synonymsFor(compound: string): string[] {
	const key = norm(compound);
	const list = SYNONYMS[key] ?? Object.entries(SYNONYMS).find(([k]) => key.includes(k) || k.includes(key))?.[1] ?? [];
	return [...new Set([compound.trim(), ...list])].slice(0, 6);
}

// --- cache ---------------------------------------------------------------------------------------------

const cache = new Map<string, { bundle: ResearchBundle; expiresAt: number }>();

function getCached(compound: string): ResearchBundle | null {
	const hit = cache.get(norm(compound));
	if (!hit) return null;
	if (Date.now() > hit.expiresAt) {
		cache.delete(norm(compound));
		return null;
	}
	return hit.bundle;
}

function setCached(compound: string, bundle: ResearchBundle): void {
	const key = norm(compound);
	if (!cache.has(key) && cache.size >= CACHE_MAX_ENTRIES) {
		// Simple insertion-order eviction — a bound on unbounded growth, not an LRU.
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	cache.set(key, { bundle, expiresAt: Date.now() + CACHE_TTL_MS });
}

// --- orchestration -------------------------------------------------------------------------------------

async function researchPeptide(compound: string): Promise<ResearchBundle | { error: string } | { blend: string; note: string }> {
	if (!compound) return { error: 'No compound name given.' };
	const blend = BLEND_NAMES[norm(compound)];
	if (blend) return { blend: compound, note: `${blend}. Call research_peptide once per component; there is essentially no literature on the blend itself.` };

	const cached = getCached(compound);
	if (cached) return cached;

	const terms = synonymsFor(compound);
	const [pubmedSettled, trialsSettled] = await Promise.allSettled([fetchPubMed(terms), fetchClinicalTrials(terms)]);
	const pubmed: PubMedResult =
		pubmedSettled.status === 'fulfilled' ? pubmedSettled.value : { status: 'error', totalResultCount: 0, humanStudyCount: 0, articles: [] };
	const trials: TrialsResult = trialsSettled.status === 'fulfilled' ? trialsSettled.value : { status: 'error', totalCount: 0, trials: [] };

	const approval = APPROVALS[norm(compound)] ?? null;
	const evidenceTier = classifyEvidenceTier(approval, pubmed, trials);
	const bundle: ResearchBundle = {
		compound,
		searchedAs: terms,
		evidenceTier,
		evidenceSummary: summarizeEvidence(evidenceTier, approval, pubmed, trials),
		approval,
		pubmed: { totalResultCount: pubmed.totalResultCount, humanStudyCount: pubmed.humanStudyCount, articles: pubmed.articles },
		clinicalTrials: { totalCount: trials.totalCount, trials: trials.trials },
		sourcesQueried: { pubmed: pubmed.status, clinicalTrials: trials.status },
		asOf: new Date().toISOString().slice(0, 10)
	};

	// Only cache a bundle if at least one source actually answered — don't lock in a fully-failed lookup
	// for 6 hours when the next question might hit a source that's recovered by then.
	if (pubmed.status === 'ok' || trials.status === 'ok') setCached(compound, bundle);
	return bundle;
}

const has = (types: string[], needle: string) => types.some((t) => t.toLowerCase().includes(needle));
const LIVE_TRIAL = (status: string | null) => !status || !/withdrawn/i.test(status);

function classifyEvidenceTier(approval: string | null, pubmed: PubMedResult, trials: TrialsResult): EvidenceTier {
	if (approval && approval.startsWith('FDA-approved')) return 'fda-approved';
	// Neither source answered: that says nothing about the evidence, and must never read as "no data".
	if (pubmed.status !== 'ok' && trials.status !== 'ok') return 'lookup-failed';
	const human = pubmed.articles.filter((a) => a.humanStudy);
	if (human.some((a) => has(a.publicationTypes, 'randomized controlled trial'))) return 'human-rct';
	if (human.some((a) => has(a.publicationTypes, 'clinical trial'))) return 'human-trial';
	if (trials.trials.some((t) => LIVE_TRIAL(t.status))) return 'registered-trials-only';
	if (pubmed.humanStudyCount > 0) return 'human-case-reports';
	if (pubmed.totalResultCount > 0) return 'preclinical-only';
	return 'no-data';
}

function summarizeEvidence(tier: EvidenceTier, approval: string | null, pubmed: PubMedResult, trials: TrialsResult): string {
	const counts = `${pubmed.totalResultCount} PubMed results, ${pubmed.humanStudyCount} tagged as human clinical/observational studies; ${trials.totalCount} registered trial(s).`;
	switch (tier) {
		case 'fda-approved':
			return `${approval}. Established label, dosing and safety data exist from large human trials. ${counts}`;
		case 'human-rct':
			return `Randomized controlled trials in humans exist — check their size, population and endpoints in the abstracts. ${counts}`;
		case 'human-trial':
			return `Human clinical trials exist but none of the top results are randomized controlled trials (small, early-phase or uncontrolled). ${counts}`;
		case 'registered-trials-only':
			return `Trials are registered but no published human trial surfaced — check status/hasResults; registration is not evidence of benefit. ${counts}`;
		case 'human-case-reports':
			return `Human evidence appears limited to case reports or observational work. ${counts}`;
		case 'preclinical-only':
			return `Evidence appears to be animal and/or in-vitro only; no human trials found. ${counts}`;
		case 'no-data':
			return 'No PubMed literature or registered trials found under these names — check the spelling, or it may be a vendor/brand name.';
		case 'lookup-failed':
			return "Couldn't reach PubMed or ClinicalTrials.gov right now, so this lookup says nothing either way about the evidence. Fall back to web search or general knowledge, and say the live lookup failed.";
	}
}

// --- PubMed (NCBI E-utilities) -------------------------------------------------------------------------

const HUMAN_FILTER =
	'humans[mh] AND (clinical trial[pt] OR randomized controlled trial[pt] OR observational study[pt] OR case reports[pt] OR clinical study[pt])';
const ABSTRACT_MAX_CHARS = 1200;
const MAX_ARTICLES = 8;

function eutils(path: string, params: string): string {
	const apiKey = env.NCBI_API_KEY?.trim() ? `&api_key=${encodeURIComponent(env.NCBI_API_KEY.trim())}` : '';
	return `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/${path}?${params}&tool=fitness-tracker-ai-coach${apiKey}`;
}

async function esearch(term: string, retmax: number): Promise<{ count: number; ids: string[] }> {
	const res = await fetchWithTimeout(eutils('esearch.fcgi', `db=pubmed&retmode=json&sort=relevance&retmax=${retmax}&term=${encodeURIComponent(term)}`));
	if (!res.ok) throw new Error(`esearch ${res.status}`);
	const body = (await res.json().catch(() => null)) as { esearchresult?: { count?: string; idlist?: string[] } } | null;
	return { count: Number(body?.esearchresult?.count ?? 0) || 0, ids: body?.esearchresult?.idlist ?? [] };
}

async function fetchPubMed(terms: string[]): Promise<PubMedResult> {
	const any = `(${terms.map((t) => `"${t.replace(/"/g, '')}"[tiab]`).join(' OR ')})`;
	let all: { count: number; ids: string[] };
	let human: { count: number; ids: string[] };
	try {
		[all, human] = await Promise.all([esearch(any, 5), esearch(`${any} AND ${HUMAN_FILTER}`, 6)]);
	} catch (err) {
		return { status: isTimeout(err) ? 'timeout' : 'error', totalResultCount: 0, humanStudyCount: 0, articles: [] };
	}
	const humanIds = new Set(human.ids);
	// Human studies first — they're what questions about "does it work in people" hinge on.
	const ids = [...new Set([...human.ids, ...all.ids])].slice(0, MAX_ARTICLES);
	if (ids.length === 0) return { status: 'ok', totalResultCount: all.count, humanStudyCount: human.count, articles: [] };

	const idParam = ids.map(encodeURIComponent).join(',');
	const [summaryRes, abstractsRes] = await Promise.allSettled([
		fetchWithTimeout(eutils('esummary.fcgi', `db=pubmed&retmode=json&id=${idParam}`)),
		fetchWithTimeout(eutils('efetch.fcgi', `db=pubmed&retmode=xml&rettype=abstract&id=${idParam}`))
	]);
	if (summaryRes.status !== 'fulfilled' || !summaryRes.value.ok) {
		return { status: 'error', totalResultCount: all.count, humanStudyCount: human.count, articles: [] };
	}
	const summary = (await summaryRes.value.json().catch(() => null)) as {
		result?: Record<string, { uid?: string; title?: string; fulljournalname?: string; pubdate?: string; pubtype?: string[] }>;
	} | null;
	const abstracts =
		abstractsRes.status === 'fulfilled' && abstractsRes.value.ok ? parseAbstracts(await abstractsRes.value.text().catch(() => '')) : new Map<string, string>();

	const articles: PubMedArticle[] = ids
		.map((id) => summary?.result?.[id])
		.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry?.uid))
		.map((entry) => ({
			pmid: entry.uid!,
			title: entry.title?.trim() || 'Untitled',
			journal: entry.fulljournalname?.trim() || null,
			year: parseYear(entry.pubdate),
			publicationTypes: entry.pubtype ?? [],
			humanStudy: humanIds.has(entry.uid!),
			abstract: abstracts.get(entry.uid!) ?? null
		}));
	return { status: 'ok', totalResultCount: all.count, humanStudyCount: human.count, articles };
}

/** PMID → abstract text from an efetch XML payload (structured abstracts keep their section labels). */
function parseAbstracts(xml: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const chunk of xml.split(/<PubmedArticle[\s>]/).slice(1)) {
		const pmid = /<PMID[^>]*>(\d+)<\/PMID>/.exec(chunk)?.[1];
		if (!pmid) continue;
		const parts: string[] = [];
		for (const m of chunk.matchAll(/<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/g)) {
			const label = /Label="([^"]+)"/.exec(m[1])?.[1];
			const text = decodeXml(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
			if (text) parts.push(label ? `${label}: ${text}` : text);
		}
		if (parts.length === 0) continue;
		const full = parts.join(' ');
		out.set(pmid, full.length > ABSTRACT_MAX_CHARS ? `${full.slice(0, ABSTRACT_MAX_CHARS).trimEnd()}…` : full);
	}
	return out;
}

function decodeXml(s: string): string {
	return s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
		.replace(/&amp;/g, '&');
}

function parseYear(pubdate: string | undefined): number | null {
	const match = pubdate?.match(/\d{4}/);
	return match ? Number(match[0]) : null;
}

// --- ClinicalTrials.gov ----------------------------------------------------------------------------------

async function fetchClinicalTrials(terms: string[]): Promise<TrialsResult> {
	const query = terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
	const url = `https://clinicaltrials.gov/api/v2/studies?pageSize=6&countTotal=true&query.intr=${encodeURIComponent(query)}`;

	let res: Response;
	try {
		res = await fetchWithTimeout(url);
	} catch (err) {
		return { status: isTimeout(err) ? 'timeout' : 'error', totalCount: 0, trials: [] };
	}
	if (!res.ok) return { status: 'error', totalCount: 0, trials: [] };

	const body = (await res.json().catch(() => null)) as {
		studies?: Array<{
			hasResults?: boolean;
			protocolSection?: {
				identificationModule?: { nctId?: string; briefTitle?: string };
				statusModule?: { overallStatus?: string; startDateStruct?: { date?: string } };
				designModule?: { phases?: string[]; enrollmentInfo?: { count?: number } };
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
				phase: p?.designModule?.phases?.join('/') ?? null,
				conditions: (p?.conditionsModule?.conditions ?? []).slice(0, 4),
				enrollment: p?.designModule?.enrollmentInfo?.count ?? null,
				startDate: p?.statusModule?.startDateStruct?.date ?? null,
				hasResults: s.hasResults ?? false
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
		return await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, text/xml' }, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

function isTimeout(err: unknown): boolean {
	return err instanceof Error && err.name === 'AbortError';
}
