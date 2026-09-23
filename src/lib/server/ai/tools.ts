// Read-only, userId-scoped tools the AI Coach can call to pull the user's own data on demand. Every
// handler takes `userId` from the server session — never from the model — so a tool can only ever read
// the calling user's rows. Each is a thin wrapper over existing repository/shared-engine functions; there
// is no new query logic here. Handlers return a JSON string (the tool_result content) built from the
// pre-computed totals/trends those already produce. Peptide tools read the same shared facts the
// dashboard shows (ai/peptideFacts.ts). Dose notes and side-effect check-ins are included ONLY in
// get_peptide_dose_log — the user opted into that for the Coach; the dashboard recap never sends them.

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
import { loadPeptideContext } from '$lib/server/peptideContext';
import { activeLevelRows } from '$lib/server/peptideViews';
import { buildPeptideFacts, doseLogForAi } from './peptideFacts';
import { activeAmountMcg, formatLevel, formatHalfLife, ROUTE_LABELS } from '$lib/utils/peptides';
import { levelDoses } from '$lib/utils/peptideIntake';
import { isValidIsoDate } from '$lib/utils/isoDate';
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
			"The user's peptide overview for a window (default last 30 days): what they actually took per compound and route (blend doses already split into components, e.g. KLOW → GHK-Cu/BPC-157/TB-500/KPV), every protocol (active or paused) with schedule, loading/taper phases, today's target and what's still due today, adherence (taken/missed/skipped), each logged dose with the target for that date, supply per container with a schedule-aware run-out date and concentration, upcoming phase changes, and recent side-effect tags. Call this first for any question about their peptides, protocols, what they've taken, adherence or supply.",
		input_schema: {
			type: 'object',
			properties: { days: { type: 'integer', description: 'Window length in days, ending today (default 30, max 180).' } }
		}
	},
	{
		name: 'get_peptide_dose_log',
		description:
			"The detailed dose log for a date range, newest first: each entry's compound, amount (and blend split), route, injection site, syringe units/sprays, container, protocol, skip/prime markers, side-effect check-ins and the user's own notes. Use when you need individual doses, timing, sites, how they felt, or notes — e.g. 'when did the nausea start', 'which sites have I used'.",
		input_schema: {
			type: 'object',
			properties: {
				from: { type: 'string', description: 'Start date YYYY-MM-DD (default 30 days ago).' },
				to: { type: 'string', description: 'End date YYYY-MM-DD (default today).' },
				compound: { type: 'string', description: 'Optional compound name filter; also matches blend doses containing it.' }
			}
		}
	},
	{
		name: 'get_peptide_levels',
		description:
			"Estimated amount still active in the body per compound and route (single-compartment decay from logged doses incl. blend components, using each compound's reference half-life), with a daily estimate for the last 14 days. Only compounds with a half-life on file. A rough model — say so when you use it.",
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
				return JSON.stringify(await peptideStatus(userId, input));
			case 'get_peptide_dose_log':
				return JSON.stringify(await peptideDoseLog(userId, input));
			case 'get_peptide_levels':
				return JSON.stringify(await peptideLevels(userId));
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

async function peptideStatus(userId: number, input: Record<string, unknown>) {
	const ctx = await loadPeptideContext(userId);
	return buildPeptideFacts(ctx, { windowDays: clampInt(input.days, 30, 1, 180) });
}

async function peptideDoseLog(userId: number, input: Record<string, unknown>) {
	const ctx = await loadPeptideContext(userId);
	const to = typeof input.to === 'string' && isValidIsoDate(input.to) ? input.to : ctx.today;
	const from = typeof input.from === 'string' && isValidIsoDate(input.from) ? input.from : shiftIsoDate(to, -29);
	const compound = typeof input.compound === 'string' ? input.compound : null;
	return { today: ctx.today, ...doseLogForAi(ctx, { from, to, compound, limit: 200 }) };
}

async function peptideLevels(userId: number) {
	const ctx = await loadPeptideContext(userId);
	const now = new Date();
	const levels = activeLevelRows(ctx, now).map((l) => {
		const series = levelDoses(ctx.intake, l.peptideId, l.route);
		const daily = [];
		for (let i = 13; i >= 0; i--) {
			const date = shiftIsoDate(ctx.today, -i);
			daily.push({ date, estimatedMcgAtNoon: Math.round(activeAmountMcg(series, l.halfLifeHours, new Date(`${date}T12:00:00`)) * 10) / 10 });
		}
		return {
			compound: l.peptideName,
			route: l.route ? ROUTE_LABELS[l.route] : null,
			halfLife: formatHalfLife(l.halfLifeHours),
			estimatedNow: formatLevel(l.activeMcg),
			estimatedNowMcg: Math.round(l.activeMcg * 10) / 10,
			lastDoseDate: l.lastDoseDate,
			includesBlendDoses: l.viaBlend,
			daily
		};
	});
	return {
		today: ctx.today,
		model: 'single-compartment exponential decay from each logged dose (anchored at noon on its date) using the reference half-life; ignores absorption/distribution — a ballpark',
		compoundsWithoutHalfLife: ctx.peptides.filter((p) => p.halfLifeHours == null && !p.isBlend && p.doseCount > 0).map((p) => p.name),
		levels
	};
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, Math.round(n)));
}
