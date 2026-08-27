import { error, fail, redirect } from '@sveltejs/kit';
import {
	getSessionWithSets,
	updateSession,
	deleteSession,
	addSet,
	updateSet,
	deleteSet,
	lastSetsForExercise
} from '$lib/server/repositories/workouts';
import { listExercises, createExercise } from '$lib/server/repositories/exercises';
import { getPlan } from '$lib/server/repositories/workoutPlans';
import { goalsByExercise } from '$lib/server/repositories/exerciseGoals';
import { listTrainingPartners, inviteToTrainTogether, removeMember } from '$lib/server/repositories/workoutGroups';
import { getCached } from '$lib/server/repositories/workoutCoachInsights';
import { aiAvailable } from '$lib/server/ai/client';
import { generateCoachInsight } from '$lib/server/ai/workoutCoach';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, depends }) => {
	const userId = locals.user!.id;
	const id = Number(params.id);
	depends('workout:training-partners');
	const result = await getSessionWithSets(userId, id);
	if (!result) throw error(404, 'Workout session not found');

	// Preload "last time" numbers for every exercise so picking one in the UI is instant
	// (no extra round-trip needed between selecting an exercise and seeing a prefilled row).
	const allExercises = await listExercises(userId);
	const lastSetsByExercise: Record<number, Awaited<ReturnType<typeof lastSetsForExercise>>> = {};
	await Promise.all(
		allExercises.map(async (ex) => {
			lastSetsByExercise[ex.id] = await lastSetsForExercise(userId, ex.id, id);
		})
	);

	// If this session was started from a plan, feed its exercise list (with target sets) to the
	// page so exercises the plan calls for but haven't had a set logged yet still show up ready to go.
	const plan = result.session.planId ? await getPlan(userId, result.session.planId) : null;
	const planExercises = plan?.exercises ?? [];

	const { selfMemberId, partners } = await listTrainingPartners(userId, id);

	return {
		session: result.session,
		exerciseGroups: result.exerciseGroups,
		allExercises,
		lastSetsByExercise,
		planExercises,
		planName: plan?.plan.name ?? null,
		goalsByExercise: await goalsByExercise(userId),
		trainingPartners: partners,
		selfMemberId,
		coachInsight: await getCached(userId, id),
		aiAvailable: aiAvailable()
	};
};

function friendlyError(e: unknown, fallback: string): string {
	if (e instanceof Error) {
		return e.message.includes('UNIQUE') ? 'An exercise with that name and brand already exists' : e.message;
	}
	return fallback;
}

export const actions: Actions = {
	updateSession: async ({ request, params, locals }) => {
		const id = Number(params.id);
		const form = await request.formData();
		const date = String(form.get('date') ?? '').trim();
		const notes = String(form.get('notes') ?? '');
		if (!date) return fail(400, { error: 'Date is required' });
		await updateSession(locals.user!.id, id, date, notes);
	},

	deleteSession: async ({ params, locals }) => {
		await deleteSession(locals.user!.id, Number(params.id));
		throw redirect(303, '/workouts');
	},

	createExercise: async ({ request, locals }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const brand = String(form.get('brand') ?? '').trim();
		if (!name) return fail(400, { error: 'Name is required' });
		try {
			const exercise = await createExercise(locals.user!.id, name, null, brand || null);
			return { exercise };
		} catch (e) {
			return fail(400, { error: friendlyError(e, 'Could not create exercise') });
		}
	},

	addSet: async ({ request, params, locals }) => {
		const sessionId = Number(params.id);
		const form = await request.formData();
		const exerciseId = Number(form.get('exerciseId'));
		const repsRaw = form.get('reps');
		const weightRaw = form.get('weight');
		if (!exerciseId || repsRaw === null || weightRaw === null) {
			return fail(400, { error: 'Invalid set data' });
		}
		const reps = Math.round(Number(repsRaw));
		const weight = Number(weightRaw);
		if (!Number.isFinite(reps) || !Number.isFinite(weight)) {
			return fail(400, { error: 'Invalid set data' });
		}
		try {
			await addSet(locals.user!.id, sessionId, exerciseId, { reps, weight });
		} catch (e) {
			return fail(400, { error: friendlyError(e, 'Could not add set') });
		}
	},

	updateSet: async ({ request, locals }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const reps = Math.round(Number(form.get('reps')));
		const weight = Number(form.get('weight'));
		const rpeRaw = form.get('rpe');
		const rpe = rpeRaw !== null && String(rpeRaw).trim() !== '' ? Number(rpeRaw) : null;
		const notes = String(form.get('notes') ?? '');
		if (!id || !Number.isFinite(reps) || !Number.isFinite(weight)) {
			return fail(400, { error: 'Invalid set data' });
		}
		await updateSet(locals.user!.id, id, { reps, weight, rpe, notes });
	},

	deleteSet: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!id) return fail(400, { error: 'Missing id' });
		await deleteSet(locals.user!.id, id);
	},

	inviteToTrain: async ({ request, params, locals }) => {
		const sessionId = Number(params.id);
		const username = String((await request.formData()).get('username') ?? '');
		try {
			await inviteToTrainTogether(locals.user!.id, sessionId, username);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not send invite' });
		}
		return { success: true };
	},

	removeTrainingMember: async ({ request, locals }) => {
		const memberId = Number((await request.formData()).get('memberId'));
		if (!Number.isFinite(memberId)) return fail(400, { error: 'Invalid member' });
		await removeMember(locals.user!.id, memberId);
		return { success: true };
	},

	generateCoachInsight: async ({ params, locals }) => {
		const result = await generateCoachInsight(locals.user!.id, Number(params.id));
		if ('error' in result) return fail(502, { error: result.error });
		return { insight: result.insight, fromCache: result.fromCache };
	}
};
