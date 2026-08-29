import { fail } from '@sveltejs/kit';
import { getSettings, updateSettings } from '$lib/server/repositories/userSettings';
import {
	deleteBodyMetric,
	getBodyMetric,
	latestBodyMetric,
	listBodyMetrics,
	logBodyMetrics,
	weightStats,
	weightTrend,
	type BodyMetricInput
} from '$lib/server/repositories/bodyMetrics';
import { deleteWeightGoal, goalProgress, upsertWeightGoal } from '$lib/server/repositories/weightGoals';
import { listPhotos } from '$lib/server/repositories/progressPhotos';
import { getCached } from '$lib/server/repositories/bodyInsights';
import { generateBodyInsight } from '$lib/server/ai/bodyInsights';
import { aiAvailable } from '$lib/server/ai/client';
import { todayIso } from '$lib/utils/todayIso';
import { parseDecimal } from '$lib/utils/parseDecimal';
import { displayToCm, displayToKg } from '$lib/utils/units';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const [settings, stats, trend, goal, latest, today, recent, photos, insight] = await Promise.all([
		getSettings(userId),
		weightStats(userId),
		weightTrend(userId, { days: 180 }),
		goalProgress(userId),
		latestBodyMetric(userId),
		getBodyMetric(userId, todayIso()),
		listBodyMetrics(userId, { limit: 10 }),
		listPhotos(userId),
		getCached(userId)
	]);

	return {
		settings,
		stats,
		trend,
		goal,
		latest,
		today,
		recent,
		photos: photos.slice(0, 6),
		photoCount: photos.length,
		insight,
		aiAvailable: aiAvailable()
	};
};

/** A form value in the user's display unit, or undefined when the field was left blank. */
function optNum(form: FormData, key: string): number | undefined {
	const raw = String(form.get(key) ?? '').trim();
	if (raw === '') return undefined;
	const n = parseDecimal(raw);
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

export const actions: Actions = {
	logMetrics: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const settings = await getSettings(userId);
		const form = await request.formData();
		const date = String(form.get('date') ?? '').trim() || todayIso();

		const input: BodyMetricInput = {};
		const weight = optNum(form, 'weight');
		if (weight !== undefined) input.weightKg = displayToKg(weight, settings.weightUnit);
		const bodyFat = optNum(form, 'bodyFat');
		if (bodyFat !== undefined) input.bodyFatPct = bodyFat;

		const neck = optNum(form, 'neck');
		if (neck !== undefined) input.neckCm = displayToCm(neck, settings.lengthUnit);
		const chest = optNum(form, 'chest');
		if (chest !== undefined) input.chestCm = displayToCm(chest, settings.lengthUnit);
		const waist = optNum(form, 'waist');
		if (waist !== undefined) input.waistCm = displayToCm(waist, settings.lengthUnit);
		const hips = optNum(form, 'hips');
		if (hips !== undefined) input.hipsCm = displayToCm(hips, settings.lengthUnit);
		const thigh = optNum(form, 'thigh');
		if (thigh !== undefined) input.thighCm = displayToCm(thigh, settings.lengthUnit);
		const arm = optNum(form, 'arm');
		if (arm !== undefined) input.armCm = displayToCm(arm, settings.lengthUnit);
		const calf = optNum(form, 'calf');
		if (calf !== undefined) input.calfCm = displayToCm(calf, settings.lengthUnit);

		const notes = String(form.get('notes') ?? '').trim();
		if (notes) input.notes = notes;

		try {
			await logBodyMetrics(userId, date, input);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not save' });
		}
		return { success: true };
	},

	deleteMetric: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isFinite(id)) return fail(400, { error: 'Invalid entry' });
		await deleteBodyMetric(locals.user!.id, id);
		return { success: true };
	},

	saveGoal: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const settings = await getSettings(userId);
		const form = await request.formData();
		const target = optNum(form, 'target');
		if (target === undefined) return fail(400, { error: 'Enter a target weight' });
		const targetDateRaw = String(form.get('targetDate') ?? '').trim();
		try {
			await upsertWeightGoal(userId, displayToKg(target, settings.weightUnit), targetDateRaw || null);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not save goal' });
		}
		return { success: true };
	},

	deleteGoal: async ({ locals }) => {
		await deleteWeightGoal(locals.user!.id);
		return { success: true };
	},

	generateBodyInsight: async ({ locals }) => {
		const result = await generateBodyInsight(locals.user!.id);
		if ('error' in result) return fail(502, { error: result.error });
		return { insight: result.insight, fromCache: result.fromCache };
	},

	saveProfile: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const weightUnit = String(form.get('weightUnit') ?? '');
		const lengthUnit = String(form.get('lengthUnit') ?? '');
		if (weightUnit !== 'kg' && weightUnit !== 'lb') return fail(400, { error: 'Invalid weight unit' });
		if (lengthUnit !== 'cm' && lengthUnit !== 'in') return fail(400, { error: 'Invalid length unit' });

		const heightRaw = optNum(form, 'height');
		const heightCm = heightRaw === undefined ? null : displayToCm(heightRaw, lengthUnit);
		try {
			await updateSettings(userId, { weightUnit, lengthUnit, heightCm });
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not save' });
		}
		return { success: true };
	}
};
