// Read-only, userId-scoped tools the AI Coach can call to pull the user's own data on demand. Every
// handler takes `userId` from the server session — never from the model — so a tool can only ever read
// the calling user's rows. Each is a thin wrapper over an existing repository function; there is no new
// query logic here. Handlers return a JSON string (the tool_result content) built from the pre-computed
// totals/trends the repos already produce. Free-text notes are deliberately excluded from peptide
// payloads, matching the peptide-insights precedent.

import type Anthropic from '@anthropic-ai/sdk';
import { recentDaySummaries, getTargets } from '$lib/server/repositories/nutritionLog';
import { weightStats, weightTrend } from '$lib/server/repositories/bodyMetrics';
import { goalProgress } from '$lib/server/repositories/weightGoals';
import { getSettings } from '$lib/server/repositories/userSettings';
import { computeBmi, bmiCategory, bmiCategoryLabel } from '$lib/utils/bmi';
import { listExercises } from '$lib/server/repositories/exercises';
import { getExerciseProgress, weeklySetsByMuscleGroup } from '$lib/server/repositories/progress';
import { goalsWithProgress } from '$lib/server/repositories/exerciseGoals';
import { listSessions } from '$lib/server/repositories/workouts';
import { listProtocols, toSchedule } from '$lib/server/repositories/peptideProtocols';
import { listVials } from '$lib/server/repositories/peptideVials';
import { listDoses, loggedDatesForPeptide, mcgConsumedByVial } from '$lib/server/repositories/peptideDoses';
import { peptideNameMap } from '$lib/server/repositories/peptides';
import { scheduledCount } from '$lib/utils/peptideSchedule';
import { containerTotalMcg, daysOfSupply } from '$lib/utils/delivery';
import { ROUTE_LABELS } from '$lib/utils/peptides';
import { todayIso } from '$lib/utils/todayIso';
import { shiftIsoDate } from '$lib/utils/isoDate';

/** Tool schemas advertised to the model. Kept deterministic (stable order, no timestamps) so the
 *  request prefix stays cache-friendly. */
export const TOOLS: Anthropic.Tool[] = [
	{
		name: 'get_nutrition_summary',
		description:
			"The user's daily calorie/macro totals for recent logged days plus their daily targets. Use for questions about eating, protein, calories, or diet adherence.",
		input_schema: {
			type: 'object',
			properties: { days: { type: 'integer', description: 'How many recent days to include (default 14, max 60).' } }
		}
	},
	{
		name: 'get_body_stats',
		description:
			"The user's latest body weight, 7- and 30-day change, weekly rate, weight-goal progress and ETA, and BMI. Use for questions about weight, body composition, or cutting/bulking pace.",
		input_schema: { type: 'object', properties: {} }
	},
	{
		name: 'get_workout_overview',
		description:
			'Recent workout sessions (with set/exercise counts) and weekly training volume per muscle group. Use for questions about training frequency, volume, or muscle balance.',
		input_schema: { type: 'object', properties: {} }
	},
	{
		name: 'get_exercise_progress',
		description:
			"Full history and personal records for one exercise, matched by name. Use for questions about a specific lift's progression or a stall.",
		input_schema: {
			type: 'object',
			properties: { name: { type: 'string', description: 'Exercise name, e.g. "Bench Press".' } },
			required: ['name']
		}
	},
	{
		name: 'get_strength_goals',
		description: "The user's per-exercise strength goals with current progress toward each. Use for questions about goals or how close they are to a target lift.",
		input_schema: { type: 'object', properties: {} }
	},
	{
		name: 'get_peptide_status',
		description:
			"The user's active peptide protocols with this-cycle adherence (planned vs logged), the actual logged dose amounts, inventory days-of-supply, and expiry. Use for questions about peptides, protocols, dosing, adherence, or supply.",
		input_schema: { type: 'object', properties: {} }
	}
];

/** Human-readable label for the tool-activity indicator in the UI. */
export function toolLabel(name: string): string {
	switch (name) {
		case 'get_nutrition_summary':
			return 'Checking your nutrition log…';
		case 'get_body_stats':
			return 'Checking your body stats…';
		case 'get_workout_overview':
			return 'Checking your training…';
		case 'get_exercise_progress':
			return 'Looking up that exercise…';
		case 'get_strength_goals':
			return 'Checking your strength goals…';
		case 'get_peptide_status':
			return 'Checking your peptide protocols…';
		default:
			return 'Looking something up…';
	}
}

/** Dispatch a tool call to its userId-scoped handler and return the tool_result content (JSON string).
 *  Never throws to the caller — a failed lookup returns a JSON error the model can reason about. */
export async function runTool(userId: number, name: string, input: Record<string, unknown>): Promise<string> {
	try {
		switch (name) {
			case 'get_nutrition_summary':
				return JSON.stringify(await nutritionSummary(userId, input));
			case 'get_body_stats':
				return JSON.stringify(await bodyStats(userId));
			case 'get_workout_overview':
				return JSON.stringify(await workoutOverview(userId));
			case 'get_exercise_progress':
				return JSON.stringify(await exerciseProgress(userId, input));
			case 'get_strength_goals':
				return JSON.stringify(await goalsWithProgress(userId));
			case 'get_peptide_status':
				return JSON.stringify(await peptideStatus(userId));
			default:
				return JSON.stringify({ error: `Unknown tool: ${name}` });
		}
	} catch (err) {
		console.error(`AI tool ${name} failed`, err);
		return JSON.stringify({ error: 'That data could not be read right now.' });
	}
}

async function nutritionSummary(userId: number, input: Record<string, unknown>) {
	const days = clampInt(input.days, 14, 1, 60);
	const [summaries, targets] = await Promise.all([recentDaySummaries(userId, days), getTargets(userId)]);
	return { targets, days: summaries };
}

async function bodyStats(userId: number) {
	const [stats, goal, settings, trend] = await Promise.all([
		weightStats(userId),
		goalProgress(userId),
		getSettings(userId),
		weightTrend(userId, { days: 90 })
	]);
	const bmi = stats && settings.heightCm ? computeBmi(stats.weightKg, settings.heightCm) : null;
	return {
		stats,
		goal,
		heightCm: settings.heightCm,
		bmi: bmi != null ? { value: Math.round(bmi * 10) / 10, category: bmiCategoryLabel(bmiCategory(bmi)) } : null,
		trend
	};
}

async function workoutOverview(userId: number) {
	const today = todayIso();
	const [sessions, muscleGroupSets] = await Promise.all([
		listSessions(userId),
		weeklySetsByMuscleGroup(userId, shiftIsoDate(today, -6), today)
	]);
	return { recentSessions: sessions.slice(0, 12), last7DaysMuscleGroupSets: muscleGroupSets };
}

async function exerciseProgress(userId: number, input: Record<string, unknown>) {
	const name = String(input.name ?? '').trim();
	if (!name) return { error: 'No exercise name given.' };
	const exercises = await listExercises(userId);
	const match =
		exercises.find((e) => e.name.toLowerCase() === name.toLowerCase()) ??
		exercises.find((e) => e.name.toLowerCase().includes(name.toLowerCase()));
	if (!match) {
		return { error: `No exercise named "${name}".`, availableExercises: exercises.map((e) => e.name) };
	}
	return getExerciseProgress(userId, match.id);
}

async function peptideStatus(userId: number) {
	const today = todayIso();
	const WINDOW_DAYS = 30;
	const [protocols, vials, consumedByVial, names] = await Promise.all([
		listProtocols(userId, { activeOnly: true }),
		listVials(userId),
		mcgConsumedByVial(userId),
		peptideNameMap(userId)
	]);
	const nameOf = (id: number) => names.get(id)?.name ?? 'Unknown compound';

	const protocolSummaries = [];
	for (const p of protocols) {
		const windowStart = shiftIsoDate(today, -(WINDOW_DAYS - 1));
		const from = p.startDate > windowStart ? p.startDate : windowStart;
		if (from > today) continue;
		const planned = scheduledCount(toSchedule(p), from, today);
		const [loggedDays, doses] = await Promise.all([
			loggedDatesForPeptide(userId, p.peptideId, from, today),
			listDoses(userId, { peptideId: p.peptideId, from, to: today })
		]);
		const loggedDoseMcgValues = doses.filter((d) => d.kind === 'dose').map((d) => d.doseMcg);
		protocolSummaries.push({
			peptideName: nameOf(p.peptideId),
			route: p.route ? (ROUTE_LABELS[p.route] ?? p.route) : null,
			frequency: p.frequency,
			protocolDoseMcg: p.doseMcg,
			plannedThisWindow: planned,
			loggedThisWindow: loggedDays.size,
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
				expiresAt: v.expiresAt ?? null,
				estimatedDaysRemaining: days != null && Number.isFinite(days) ? days : null
			};
		});

	return { windowDays: WINDOW_DAYS, protocols: protocolSummaries, vials: vialSummaries };
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.round(n)));
}
