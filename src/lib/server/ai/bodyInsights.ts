// Orchestrates Body Insights: a plain-language read on the user's weight trend/rate, weight-goal ETA,
// and BMI, built from the numbers weightStats/weightTrend/goalProgress already compute. Mirrors the
// peptide/nutrition features — check cache + cooldown, gather, ask Haiku, cache.

import { generateText, AI_MODEL_HAIKU, AI_DAILY_LIMIT_PER_USER } from './client';
import { getCached, save, type BodyInsight } from '$lib/server/repositories/bodyInsights';
import { weightStats, weightTrend } from '$lib/server/repositories/bodyMetrics';
import { goalProgress } from '$lib/server/repositories/weightGoals';
import { getSettings } from '$lib/server/repositories/userSettings';
import { computeBmi, bmiCategory, bmiCategoryLabel } from '$lib/utils/bmi';

const REGENERATE_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

const SYSTEM_PROMPT = `You are a body-composition data summarizer. You'll receive structured JSON with one user's recent body-weight data (all weights in kilograms): latest weight, 7- and 30-day change, average weekly rate of change, BMI and category, and — if they set a weight goal — how far they are from it and a rough ETA in weeks at the current rate. Write a short (3–5 sentence), plain-language, encouraging summary suitable for a dashboard card: the direction and pace of their weight trend and, if a goal exists, progress toward it. Mention only facts present in the JSON — never invent a number. State BMI factually if present, without medical judgement. Don't prescribe a diet, a training plan, or a target rate. Omit any field that's null rather than guessing.`;

type Result = { insight: BodyInsight; fromCache: boolean } | { error: string };

export async function generateBodyInsight(userId: number): Promise<Result> {
	const cached = await getCached(userId);
	if (cached && Date.now() - cached.generatedAt.getTime() < REGENERATE_COOLDOWN_MS) {
		return { insight: cached, fromCache: true };
	}

	const [stats, goal, settings, trend] = await Promise.all([
		weightStats(userId),
		goalProgress(userId),
		getSettings(userId),
		weightTrend(userId, { days: 90 })
	]);
	const bmiValue = stats && settings.heightCm ? computeBmi(stats.weightKg, settings.heightCm) : null;

	const input = {
		stats,
		goal,
		bmi: bmiValue != null ? { value: Math.round(bmiValue * 10) / 10, category: bmiCategoryLabel(bmiCategory(bmiValue)) } : null,
		trend90dPoints: trend.length,
		weight90dAgoKg: trend[0]?.weightKg ?? null,
		latestWeightKg: trend[trend.length - 1]?.weightKg ?? null
	};

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
