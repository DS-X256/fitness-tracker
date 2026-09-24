// Orchestrates the peptide dashboard's AI recap: a short, FACTUAL summary of what the user actually took,
// how they're tracking against their protocols, supply and what's coming up. Built entirely from
// buildPeptideFacts() (the same shared engine the screens use), so it can't contradict them — and every
// number it may state is precomputed there. Free-text notes and side-effect check-ins are never sent.
//
// Scope: a recap, not advice. Interpretation, estimates and evidence are the AI Coach's job (the card
// links there) — this card must stay something you can glance at and trust.

import { generateText, AI_MODEL_PEPTIDE_SUMMARY, AI_DAILY_LIMIT_PER_USER } from './client';
import { buildPeptideFacts, factsFingerprint } from './peptideFacts';
import { getCached, save, type PeptideInsight } from '$lib/server/repositories/peptideInsights';
import { getSettings } from '$lib/server/repositories/userSettings';
import { loadPeptideContext, type PeptideContext } from '$lib/server/peptideContext';

/** Guards against double-clicks re-billing an identical request; a CHANGED log always regenerates. */
const DOUBLE_CLICK_GUARD_MS = 60 * 1000;
const WINDOW_DAYS = 30;
/** Bump when SYSTEM_PROMPT changes meaningfully, so cached recaps written under the old one go stale. */
const PROMPT_VERSION = 'recap-2';

const SYSTEM_PROMPT = `You write the short recap at the top of a person's own peptide log. The input is JSON the app computed from their log; every number in it is authoritative and already correct. Your job is only to phrase it — never recount, re-add, convert or estimate anything yourself, and never mention a number that isn't in the input.

Cover, most important first, in 3-6 short sentences of plain prose:
1. What they actually took in the window (window.from to window.to; today is given). Use \`intake\`: blend doses are already split into components there — name the blend and its main components' amounts (e.g. "4 mg KLOW twice, i.e. 5 mg GHK-Cu and 1 mg each of BPC-157, TB-500 and KPV"). Keep different routes separate; never add them together.
2. How they're tracking: use each protocol's adherenceInWindow (taken, missed, skipped — skipped is deliberate, not missed) and \`today\` (what's still due today). If a protocol is in a loading or taper phase, say so; a logged dose that matches targetMcgThatDay is on plan, not a deviation.
3. Supply: use daysOfSupplyOnSchedule / runsOutOn exactly as given (these already account for the schedule — "runs out around Oct 3"). dosesLeftAtCurrentTarget is a count of doses, not days. Mention expired or soon-expiring containers.
4. Anything coming up in upcomingChanges (loading ends, taper starts, cycle break) in the next couple of weeks.

Refer to dates relative to today where natural ("yesterday", "on Thursday"). Skip anything with nothing to say. Don't give advice, opinions or dose suggestions, and add no disclaimers — interpretation is handled elsewhere. Plain text only: no markdown, bullets, headers or emphasis.`;

type Result = { insight: PeptideInsight; fromCache: boolean } | { error: string };

/** The fingerprint the current log would produce — the dashboard compares it with the cached recap's
 *  to show "out of date" the moment something is logged, edited or deleted. */
export function currentInsightFingerprint(ctx: PeptideContext): string {
	return factsFingerprint(buildPeptideFacts(ctx, { windowDays: WINDOW_DAYS }), PROMPT_VERSION);
}

export async function generatePeptideInsight(userId: number): Promise<Result> {
	const settings = await getSettings(userId);
	if (!settings.aiPeptideInsightsEnabled) return { error: 'AI adherence insights are turned off in settings.' };

	const ctx = await loadPeptideContext(userId);
	const facts = buildPeptideFacts(ctx, { windowDays: WINDOW_DAYS });
	const fingerprint = factsFingerprint(facts, PROMPT_VERSION);

	const cached = await getCached(userId);
	if (cached && (cached.fingerprint === fingerprint || Date.now() - cached.generatedAt.getTime() < DOUBLE_CLICK_GUARD_MS)) {
		return { insight: cached, fromCache: true };
	}

	if (facts.intake.length === 0 && facts.protocols.length === 0) {
		return { error: 'Nothing logged in the last 30 days yet — log a dose or set up a protocol first.' };
	}

	const aiResult = await generateText({
		userId,
		model: AI_MODEL_PEPTIDE_SUMMARY,
		system: SYSTEM_PROMPT,
		prompt: JSON.stringify(facts),
		// Thinking counts against max_tokens on thinking models — leave plenty of room for a 6-sentence answer.
		maxTokens: 4000,
		effort: 'low',
		timeoutMs: 90_000
	});
	if (!aiResult.ok) {
		if (aiResult.reason === 'rate_limited') {
			return { error: `You've reached today's AI usage limit (${AI_DAILY_LIMIT_PER_USER} requests). Try again tomorrow.` };
		}
		return { error: 'AI is not configured or the request failed. Try again later.' };
	}

	const insight = await save(userId, aiResult.text.trim(), aiResult.model, fingerprint);
	return { insight, fromCache: false };
}
