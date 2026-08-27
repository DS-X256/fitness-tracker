// Orchestrates Peptide Protocol Insights: an administrative adherence/inventory summary built entirely
// from numbers already computed elsewhere (scheduledCount, listVials + delivery-math utils, dose
// timestamps) — no new decryption logic, and free-text `notes` fields are deliberately excluded from
// what gets serialized to the prompt.
//
// ⚠️ Scope constraint (see SYSTEM_PROMPT below): this must stay administrative/adherence-summary only —
// never medical, dosing, safety, or efficacy commentary. Don't "improve" the prompt toward that later.

import { generateText, AI_MODEL_HAIKU, AI_DAILY_LIMIT_PER_USER } from './client';
import { getCached, save, type PeptideInsight } from '$lib/server/repositories/peptideInsights';
import { getSettings } from '$lib/server/repositories/userSettings';
import { listProtocols, toSchedule } from '$lib/server/repositories/peptideProtocols';
import { listVials } from '$lib/server/repositories/peptideVials';
import { listDoses, loggedDatesForPeptide, mcgConsumedByVial } from '$lib/server/repositories/peptideDoses';
import { peptideNameMap } from '$lib/server/repositories/peptides';
import { scheduledCount } from '$lib/utils/peptideSchedule';
import { containerTotalMcg, daysOfSupply } from '$lib/utils/delivery';
import { todayIso } from '$lib/utils/todayIso';
import { shiftIsoDate } from '$lib/utils/isoDate';

const REGENERATE_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const ADHERENCE_WINDOW_DAYS = 30;
const TIMING_SAMPLE_SIZE = 20;

const SYSTEM_PROMPT = `You are an administrative data-summarization assistant. You will receive structured data about a user's *own logged records* for a self-administered peptide protocol: how many of the doses planned for the current cycle have been logged vs. missed, estimated remaining supply for their inventory, and how consistent dose timing has been relative to the schedule the user set for themselves.

Each protocol entry has both a scheduledDoseMcg (the dose configured in the protocol) and loggedDoseMcgValues (the actual dose amounts recorded in the log, one per logged dose). These can differ — the user may log a different amount than the protocol specifies. When you state a dose amount for doses that were logged, you MUST use loggedDoseMcgValues, never scheduledDoseMcg. If loggedDoseMcgValues is empty, don't state a dose amount for that protocol at all. If the logged amounts differ from scheduledDoseMcg, you may note the actual logged amount, but never comment on whether that's appropriate — administrative fact only.

Your only job is to turn this data into a short, readable administrative summary — for example: '12 of 14 planned doses logged this cycle at 300mcg each', 'Vial A has about 5 days of supply left at the current rate', 'Doses have trended about 40 minutes later than scheduled this week'.

You must NOT: give medical, dosing, safety, or efficacy advice or opinion, even if asked; comment on whether a compound, dose, route, or schedule is appropriate, safe, or effective; suggest changes to a dose, frequency, or protocol; or interpret any effect, symptom, or outcome. If the data or a request seems to invite that kind of commentary, state the administrative facts plainly and stop — add no caveats, warnings, or medically-toned language. Describe only the counts, ratios, and durations given to you; never invent a number that isn't in the input; write 3–5 sentences, plain prose.`;

type Result = { insight: PeptideInsight; fromCache: boolean } | { error: string };

export async function generatePeptideInsight(userId: number): Promise<Result> {
	const settings = await getSettings(userId);
	if (!settings.aiPeptideInsightsEnabled) return { error: 'AI adherence insights are turned off in settings.' };

	const cached = await getCached(userId);
	if (cached && Date.now() - cached.generatedAt.getTime() < REGENERATE_COOLDOWN_MS) {
		return { insight: cached, fromCache: true };
	}

	const today = todayIso();
	const [protocols, vials, consumedByVial, recentDoses, names] = await Promise.all([
		listProtocols(userId, { activeOnly: true }),
		listVials(userId),
		mcgConsumedByVial(userId),
		listDoses(userId, { limit: TIMING_SAMPLE_SIZE }),
		peptideNameMap(userId)
	]);
	const nameOf = (id: number) => names.get(id)?.name ?? 'Unknown compound';

	const protocolSummaries = [];
	for (const p of protocols) {
		const windowStart = shiftIsoDate(today, -(ADHERENCE_WINDOW_DAYS - 1));
		const from = p.startDate > windowStart ? p.startDate : windowStart;
		if (from > today) continue;
		const planned = scheduledCount(toSchedule(p), from, today);
		if (planned === 0) continue;
		// loggedDatesForPeptide (distinct days) drives the count, matching the adherence-day semantics
		// elsewhere in this app; the actual dose amounts come from a separate decrypt of the same-window
		// doses, filtered to real doses (excludes priming/removal events, same exclusion as that helper).
		const [loggedDays, doses] = await Promise.all([
			loggedDatesForPeptide(userId, p.peptideId, from, today),
			listDoses(userId, { peptideId: p.peptideId, from, to: today })
		]);
		const loggedDoseMcgValues = doses.filter((d) => d.kind === 'dose').map((d) => d.doseMcg);
		protocolSummaries.push({
			peptideName: nameOf(p.peptideId),
			scheduledDoseMcg: p.doseMcg,
			plannedThisCycle: planned,
			loggedThisCycle: loggedDays.size,
			loggedDoseMcgValues
		});
	}

	const vialSummaries = vials
		.filter((v) => !v.depleted)
		.map((v) => {
			const proto = protocols.find((p) => p.peptideId === v.peptideId);
			const totalMcg = containerTotalMcg(v);
			const remainingMcg = totalMcg != null ? Math.max(0, totalMcg - (consumedByVial.get(v.id) ?? 0)) : null;
			const days = proto && proto.doseMcg > 0 && remainingMcg != null ? daysOfSupply(remainingMcg, proto.doseMcg) : null;
			return {
				peptideName: nameOf(v.peptideId),
				form: v.form,
				estimatedDaysRemaining: days != null && Number.isFinite(days) ? days : null
			};
		})
		.filter((v) => v.estimatedDaysRemaining != null);

	const timingOffsetMinutes = averageTimingOffsetMinutes(recentDoses, protocols);

	const input = { protocols: protocolSummaries, vials: vialSummaries, timingOffsetMinutes };

	const aiResult = await generateText({
		userId,
		model: AI_MODEL_HAIKU,
		system: SYSTEM_PROMPT,
		prompt: JSON.stringify(input),
		maxTokens: 512
	});
	if (!aiResult.ok) {
		if (aiResult.reason === 'rate_limited') {
			return { error: `You've reached today's AI usage limit (${AI_DAILY_LIMIT_PER_USER} requests). Try again tomorrow.` };
		}
		return { error: 'AI is not configured or the request failed. Try again later.' };
	}

	const insight = await save(userId, aiResult.text.trim(), aiResult.model);
	return { insight, fromCache: false };
}

function parseTimeToMinutes(time: string | null): number | null {
	if (!time) return null;
	const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
	if (!m) return null;
	const hours = Number(m[1]);
	const minutes = Number(m[2]);
	if (hours > 23 || minutes > 59) return null;
	return hours * 60 + minutes;
}

/** Average signed offset (actual − scheduled, in minutes, wrapped to [-720, 720]) across recently logged
 *  doses that have both an actual time and a scheduled timeOfDay to compare against. Null when there's
 *  nothing to compare. */
function averageTimingOffsetMinutes(
	doses: Awaited<ReturnType<typeof listDoses>>,
	protocols: Awaited<ReturnType<typeof listProtocols>>
): number | null {
	const scheduledByPeptide = new Map(
		protocols.filter((p) => p.timeOfDay).map((p) => [p.peptideId, parseTimeToMinutes(p.timeOfDay)])
	);
	const offsets: number[] = [];
	for (const dose of doses) {
		const scheduled = scheduledByPeptide.get(dose.peptideId);
		const actual = parseTimeToMinutes(dose.time);
		if (scheduled == null || actual == null) continue;
		let diff = actual - scheduled;
		if (diff > 720) diff -= 1440;
		if (diff < -720) diff += 1440;
		offsets.push(diff);
	}
	if (offsets.length === 0) return null;
	return Math.round(offsets.reduce((sum, o) => sum + o, 0) / offsets.length);
}
