// Orchestrates the Weekly Insights Digest: gathers the past 7 days of workout/food/body data from
// existing repositories, asks Haiku for a plain-language recap, and caches the result. Mirrors the
// barcode route's shape — check cache, call out on miss, cache the answer — but keyed by ISO week
// instead of by lookup key.

import { generateText, AI_MODEL_HAIKU, AI_DAILY_LIMIT_PER_USER } from './client';
import { getForWeek, create, regenerate, type WeeklyDigest } from '$lib/server/repositories/weeklyDigests';
import { recentDaySummaries } from '$lib/server/repositories/nutritionLog';
import { listSessions } from '$lib/server/repositories/workouts';
import { weeklySetsByMuscleGroup } from '$lib/server/repositories/progress';
import { weightTrend } from '$lib/server/repositories/bodyMetrics';
import { isoWeekStart } from '$lib/utils/isoDate';

const REGENERATE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour — weekly aggregates change slowly

const SYSTEM_PROMPT = `You are a fitness data summarizer. You'll receive structured JSON describing one user's past 7 days: workout volume and any notable strength PRs, days logged and average calorie/protein intake, and body-weight trend. Write a short (3–5 sentence), plain-language, encouraging weekly recap suitable for a dashboard card. Plain text only — no markdown formatting (no **bold**, *italics*, headers, or bullet lists); this renders as literal text, not formatting. Mention only facts present in the JSON — never invent a number, never give training or nutrition advice beyond restating what the data already shows, and omit any field that's null or missing rather than guessing at it.`;

type Result = { digest: WeeklyDigest; fromCache: boolean } | { error: string };

export async function generateWeeklyDigest(userId: number, today: string): Promise<Result> {
	const weekStart = isoWeekStart(today);

	const cached = await getForWeek(userId, weekStart);
	if (cached) return { digest: cached, fromCache: true };

	return callAndSave(userId, weekStart, today, create);
}

/** Explicit "regenerate this week" — only reachable once a digest already exists, so it's gated by a
 *  cooldown rather than the unconditional cache-or-call path above. */
export async function regenerateWeeklyDigest(userId: number, today: string): Promise<Result> {
	const weekStart = isoWeekStart(today);
	const cached = await getForWeek(userId, weekStart);
	if (cached && Date.now() - cached.generatedAt.getTime() < REGENERATE_COOLDOWN_MS) {
		return { digest: cached, fromCache: true };
	}
	return callAndSave(userId, weekStart, today, regenerate);
}

async function callAndSave(
	userId: number,
	weekStart: string,
	today: string,
	save: (userId: number, weekStart: string, content: string, model: string) => Promise<WeeklyDigest>
): Promise<Result> {
	const [daySummaries, sessions, muscleSets, weightPoints] = await Promise.all([
		recentDaySummaries(userId, 30),
		listSessions(userId),
		weeklySetsByMuscleGroup(userId, weekStart, today),
		weightTrend(userId, { days: 7 })
	]);

	const weekDays = daySummaries.filter((d) => d.date >= weekStart && d.date <= today);
	const weekSessions = sessions.filter((s) => s.date >= weekStart && s.date <= today);

	const avgCalories = weekDays.length
		? Math.round(weekDays.reduce((sum, d) => sum + d.calories, 0) / weekDays.length)
		: null;
	const avgProtein = weekDays.length
		? Math.round(weekDays.reduce((sum, d) => sum + d.protein, 0) / weekDays.length)
		: null;

	const input = {
		weekStart,
		weekEnd: today,
		daysLogged: weekDays.length,
		avgCalories,
		avgProtein,
		workouts: weekSessions.length,
		totalSets: weekSessions.reduce((sum, s) => sum + s.setCount, 0),
		muscleGroupSets: muscleSets
			.map((m) => ({ label: m.muscleGroup ?? 'Other', sets: m.sets }))
			.sort((a, b) => b.sets - a.sets),
		weightStartKg: weightPoints[0]?.weightKg ?? null,
		weightEndKg: weightPoints[weightPoints.length - 1]?.weightKg ?? null,
		weightDeltaKg:
			weightPoints.length >= 2
				? Math.round((weightPoints[weightPoints.length - 1].weightKg - weightPoints[0].weightKg) * 100) / 100
				: null
	};

	const result = await generateText({
		userId,
		model: AI_MODEL_HAIKU,
		system: SYSTEM_PROMPT,
		prompt: JSON.stringify(input),
		maxTokens: 512
	});
	if (!result.ok) {
		if (result.reason === 'rate_limited') {
			return { error: `You've reached today's AI usage limit (${AI_DAILY_LIMIT_PER_USER} requests). Try again tomorrow.` };
		}
		return { error: 'AI is not configured or the request failed. Try again later.' };
	}
	const digest = await save(userId, weekStart, result.text.trim(), result.model);
	return { digest, fromCache: false };
}
