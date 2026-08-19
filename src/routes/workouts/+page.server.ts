import { fail, redirect } from '@sveltejs/kit';
import { listSessions, createSession } from '$lib/server/repositories/workouts';
import { listPendingInvites, acceptInvite, removeMember } from '$lib/server/repositories/workoutGroups';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const [sessions, pendingInvites] = await Promise.all([listSessions(userId), listPendingInvites(userId)]);
	return { sessions, pendingInvites };
};

function todayIso(): string {
	const now = new Date();
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, '0');
	const d = String(now.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

export const actions: Actions = {
	start: async ({ locals }) => {
		const session = await createSession(locals.user!.id, todayIso());
		throw redirect(303, `/workouts/${session.id}`);
	},

	acceptTrainingInvite: async ({ request, locals }) => {
		const memberId = Number((await request.formData()).get('memberId'));
		if (!Number.isFinite(memberId)) return fail(400, { error: 'Invalid invite' });
		let sessionId: number;
		try {
			sessionId = await acceptInvite(locals.user!.id, memberId);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not accept invite' });
		}
		throw redirect(303, `/workouts/${sessionId}`);
	},

	declineTrainingInvite: async ({ request, locals }) => {
		const memberId = Number((await request.formData()).get('memberId'));
		if (!Number.isFinite(memberId)) return fail(400, { error: 'Invalid invite' });
		await removeMember(locals.user!.id, memberId);
		return { success: true };
	}
};
