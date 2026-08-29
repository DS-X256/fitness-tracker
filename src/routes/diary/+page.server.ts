import { fail } from '@sveltejs/kit';
import { getTargets, recentDaySummaries } from '$lib/server/repositories/nutritionLog';
import { getCached } from '$lib/server/repositories/nutritionInsights';
import { generateNutritionInsight } from '$lib/server/ai/nutritionInsights';
import { aiAvailable } from '$lib/server/ai/client';
import { todayIso } from '$lib/utils/todayIso';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const [days, targets, insight] = await Promise.all([
		recentDaySummaries(userId),
		getTargets(userId),
		getCached(userId)
	]);
	return { days, targets, today: todayIso(), insight, aiAvailable: aiAvailable() };
};

export const actions: Actions = {
	generateNutritionInsight: async ({ locals }) => {
		const result = await generateNutritionInsight(locals.user!.id);
		if ('error' in result) return fail(502, { error: result.error });
		return { insight: result.insight, fromCache: result.fromCache };
	}
};
