// Orchestrates Nutrition Insights: a plain-language read on recent calorie/macro trends vs. the user's
// targets, built from numbers recentDaySummaries + getTargets already compute. Mirrors the peptide/weekly
// features — check cache + cooldown, gather from existing repos, ask Haiku, cache the answer.

import { generateText, AI_MODEL_HAIKU, AI_DAILY_LIMIT_PER_USER } from './client';
import { getCached, save, type NutritionInsight } from '$lib/server/repositories/nutritionInsights';
import { recentDaySummaries, getTargets } from '$lib/server/repositories/nutritionLog';
import { todayIso } from '$lib/utils/todayIso';
import { shiftIsoDate } from '$lib/utils/isoDate';

const REGENERATE_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

const SYSTEM_PROMPT = `You are a nutrition data summarizer. You'll receive structured JSON describing one user's recent food logging: their daily calorie/protein/carb/fat targets, and per-window averages of what they actually logged over the last 7 and 14 days plus how many days they logged. Write a short (3–5 sentence), plain-language, encouraging summary suitable for a dashboard card: how consistent their logging has been and how their averages compare to their targets. Mention only facts present in the JSON — never invent a number. You may point out a gap between average and target (e.g. "protein is averaging below target"), but keep it factual and supportive; don't prescribe a specific diet or meal plan. Omit any field that's null rather than guessing.`;

type Result = { insight: NutritionInsight; fromCache: boolean } | { error: string };

export async function generateNutritionInsight(userId: number): Promise<Result> {
	const cached = await getCached(userId);
	if (cached && Date.now() - cached.generatedAt.getTime() < REGENERATE_COOLDOWN_MS) {
		return { insight: cached, fromCache: true };
	}

	const today = todayIso();
	const [days, targets] = await Promise.all([recentDaySummaries(userId, 30), getTargets(userId)]);
	const window = (n: number) => {
		const from = shiftIsoDate(today, -(n - 1));
		return days.filter((d) => d.date >= from && d.date <= today);
	};
	const w7 = window(7);
	const w14 = window(14);
	const summarize = (rows: typeof days) => ({
		daysLogged: rows.length,
		avgCalories: rows.length ? Math.round(rows.reduce((s, d) => s + d.calories, 0) / rows.length) : null,
		avgProtein: rows.length ? Math.round(rows.reduce((s, d) => s + d.protein, 0) / rows.length) : null,
		avgCarbs: rows.length ? Math.round(rows.reduce((s, d) => s + d.carbs, 0) / rows.length) : null,
		avgFat: rows.length ? Math.round(rows.reduce((s, d) => s + d.fat, 0) / rows.length) : null
	});

	const input = { targets, last7Days: summarize(w7), last14Days: summarize(w14) };

	const result = await generateText({ userId, model: AI_MODEL_HAIKU, system: SYSTEM_PROMPT, prompt: JSON.stringify(input), maxTokens: 512 });
	if (!result.ok) {
		if (result.reason === 'rate_limited') {
			return { error: `You've reached today's AI usage limit (${AI_DAILY_LIMIT_PER_USER} requests). Try again tomorrow.` };
		}
		return { error: 'AI is not configured or the request failed. Try again later.' };
	}
	const insight = await save(userId, result.text.trim(), result.model);
	return { insight, fromCache: false };
}
