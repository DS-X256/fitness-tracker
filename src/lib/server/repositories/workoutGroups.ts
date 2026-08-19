import { db } from '$lib/server/db';
import { workoutGroups, workoutGroupMembers, workoutSessions, workoutSets, workoutPlans, users } from '$lib/server/db/schema';
import { createSession } from '$lib/server/repositories/workouts';
import { todayIso } from '$lib/utils/todayIso';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';

/** The acting user's own 'joined' membership row for this session, if any — i.e. proof this
 *  session is currently linked into a training group. */
async function myMembership(userId: number, sessionId: number) {
	const [row] = await db
		.select()
		.from(workoutGroupMembers)
		.where(
			and(
				eq(workoutGroupMembers.userId, userId),
				eq(workoutGroupMembers.sessionId, sessionId),
				eq(workoutGroupMembers.status, 'joined')
			)
		);
	return row ?? null;
}

/** Invite `targetUsername` to train together on `sessionId`. Creates the group (and the owner's
 *  own 'joined' membership) on the first invite for that session; later invites reuse it, so a
 *  session can pick up several training partners. */
export async function inviteToTrainTogether(ownerId: number, sessionId: number, targetUsername: string) {
	const trimmed = targetUsername.trim();
	if (!trimmed) throw new Error('Username is required');

	const [session] = await db
		.select({ id: workoutSessions.id })
		.from(workoutSessions)
		.where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.userId, ownerId)));
	if (!session) throw new Error('Workout session not found');

	const [target] = await db
		.select({ id: users.id })
		.from(users)
		.where(sql`lower(${users.username}) = lower(${trimmed})`);
	if (!target) throw new Error('No user with that username');
	if (target.id === ownerId) throw new Error("You can't invite yourself");

	let membership = await myMembership(ownerId, sessionId);
	let groupId: number;
	if (membership) {
		groupId = membership.groupId;
	} else {
		const [group] = await db.insert(workoutGroups).values({ createdBy: ownerId, createdAt: new Date() }).returning();
		groupId = group.id;
		await db
			.insert(workoutGroupMembers)
			.values({ groupId, userId: ownerId, sessionId, status: 'joined', createdAt: new Date() });
	}

	const [existing] = await db
		.select({ id: workoutGroupMembers.id })
		.from(workoutGroupMembers)
		.where(and(eq(workoutGroupMembers.groupId, groupId), eq(workoutGroupMembers.userId, target.id)));
	if (existing) throw new Error('Already invited to train together');

	await db
		.insert(workoutGroupMembers)
		.values({ groupId, userId: target.id, sessionId: null, status: 'invited', createdAt: new Date() });
}

export type PendingInvite = {
	memberId: number;
	inviterUsername: string;
	date: string | null;
	planName: string | null;
};

/** Invites waiting for `userId` to accept or decline, newest first — each with enough of the
 *  inviter's session context (date, plan) to preview what training together would look like. */
export async function listPendingInvites(userId: number): Promise<PendingInvite[]> {
	const invites = await db
		.select({
			memberId: workoutGroupMembers.id,
			groupId: workoutGroupMembers.groupId,
			createdBy: workoutGroups.createdBy
		})
		.from(workoutGroupMembers)
		.innerJoin(workoutGroups, eq(workoutGroups.id, workoutGroupMembers.groupId))
		.where(and(eq(workoutGroupMembers.userId, userId), eq(workoutGroupMembers.status, 'invited')))
		.orderBy(desc(workoutGroupMembers.createdAt));

	return Promise.all(
		invites.map(async (inv) => {
			const [inviter] = await db.select({ username: users.username }).from(users).where(eq(users.id, inv.createdBy));

			const [ownerMember] = await db
				.select({ sessionId: workoutGroupMembers.sessionId })
				.from(workoutGroupMembers)
				.where(
					and(
						eq(workoutGroupMembers.groupId, inv.groupId),
						eq(workoutGroupMembers.userId, inv.createdBy),
						eq(workoutGroupMembers.status, 'joined')
					)
				);

			let date: string | null = null;
			let planName: string | null = null;
			if (ownerMember?.sessionId) {
				const [session] = await db
					.select({ date: workoutSessions.date, planId: workoutSessions.planId })
					.from(workoutSessions)
					.where(eq(workoutSessions.id, ownerMember.sessionId));
				date = session?.date ?? null;
				if (session?.planId) {
					const [plan] = await db.select({ name: workoutPlans.name }).from(workoutPlans).where(eq(workoutPlans.id, session.planId));
					planName = plan?.name ?? null;
				}
			}

			return { memberId: inv.memberId, inviterUsername: inviter?.username ?? 'Someone', date, planName };
		})
	);
}

/** Accepts an invite: creates the acceptor's own workout session (same date/plan as whoever
 *  started the group, so both sides land on the same workout), links it into the group, and
 *  returns its id so the caller can send the user straight there — "go train with them". */
export async function acceptInvite(userId: number, memberId: number): Promise<number> {
	const [member] = await db
		.select()
		.from(workoutGroupMembers)
		.where(and(eq(workoutGroupMembers.id, memberId), eq(workoutGroupMembers.userId, userId), eq(workoutGroupMembers.status, 'invited')));
	if (!member) throw new Error('Invite not found');

	const [group] = await db.select({ createdBy: workoutGroups.createdBy }).from(workoutGroups).where(eq(workoutGroups.id, member.groupId));

	let date = todayIso();
	let planId: number | null = null;
	if (group) {
		const [ownerMember] = await db
			.select({ sessionId: workoutGroupMembers.sessionId })
			.from(workoutGroupMembers)
			.where(
				and(
					eq(workoutGroupMembers.groupId, member.groupId),
					eq(workoutGroupMembers.userId, group.createdBy),
					eq(workoutGroupMembers.status, 'joined')
				)
			);
		if (ownerMember?.sessionId) {
			const [session] = await db
				.select({ date: workoutSessions.date, planId: workoutSessions.planId })
				.from(workoutSessions)
				.where(eq(workoutSessions.id, ownerMember.sessionId));
			if (session) {
				date = session.date;
				planId = session.planId;
			}
		}
	}

	const newSession = await createSession(userId, date, null, planId);
	await db.update(workoutGroupMembers).set({ sessionId: newSession.id, status: 'joined' }).where(eq(workoutGroupMembers.id, memberId));
	return newSession.id;
}

/** Removes a member row — self-leave (decline an invite, or step away from a group you'd
 *  joined) when `actingUserId` owns the row, or an owner revoke/kick when `actingUserId`
 *  started the group. Either way the member's own workout session is untouched, only the link
 *  is dropped. */
export async function removeMember(actingUserId: number, memberId: number) {
	const [member] = await db.select().from(workoutGroupMembers).where(eq(workoutGroupMembers.id, memberId));
	if (!member) return;
	const [group] = await db.select({ createdBy: workoutGroups.createdBy }).from(workoutGroups).where(eq(workoutGroups.id, member.groupId));
	if (member.userId !== actingUserId && group?.createdBy !== actingUserId) return;
	await db.delete(workoutGroupMembers).where(eq(workoutGroupMembers.id, memberId));
}

export type TrainingPartner = {
	memberId: number;
	userId: number;
	username: string;
	status: 'invited' | 'joined';
	setCount: number;
	exerciseCount: number;
	lastSetAt: Date | null;
};

/** Everyone else training alongside `userId` on `sessionId` — joined partners with their live
 *  set/exercise counts and last-logged time (for the "training with" panel), plus anyone still
 *  invited but not yet started. Empty when this session isn't part of a group. */
export async function listTrainingPartners(userId: number, sessionId: number): Promise<{ selfMemberId: number | null; partners: TrainingPartner[] }> {
	const membership = await myMembership(userId, sessionId);
	if (!membership) return { selfMemberId: null, partners: [] };

	const members = await db
		.select({
			memberId: workoutGroupMembers.id,
			userId: workoutGroupMembers.userId,
			username: users.username,
			status: workoutGroupMembers.status,
			sessionId: workoutGroupMembers.sessionId
		})
		.from(workoutGroupMembers)
		.innerJoin(users, eq(users.id, workoutGroupMembers.userId))
		.where(and(eq(workoutGroupMembers.groupId, membership.groupId), ne(workoutGroupMembers.userId, userId)))
		.orderBy(asc(users.username));

	const partners = await Promise.all(
		members.map(async (m): Promise<TrainingPartner> => {
			if (!m.sessionId) {
				return { memberId: m.memberId, userId: m.userId, username: m.username, status: m.status as 'invited' | 'joined', setCount: 0, exerciseCount: 0, lastSetAt: null };
			}
			const [stats] = await db
				.select({
					setCount: sql<number>`count(${workoutSets.id})`.mapWith(Number),
					exerciseCount: sql<number>`count(distinct ${workoutSets.exerciseId})`.mapWith(Number),
					lastSetAt: sql<number | null>`max(${workoutSets.createdAt})`
				})
				.from(workoutSets)
				.where(eq(workoutSets.sessionId, m.sessionId));
			return {
				memberId: m.memberId,
				userId: m.userId,
				username: m.username,
				status: m.status as 'invited' | 'joined',
				setCount: stats?.setCount ?? 0,
				exerciseCount: stats?.exerciseCount ?? 0,
				lastSetAt: stats?.lastSetAt ? new Date(stats.lastSetAt) : null
			};
		})
	);

	return { selfMemberId: membership.id, partners };
}
