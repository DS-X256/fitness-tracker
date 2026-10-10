import { isValidIsoDate } from '$lib/utils/isoDate';
import { validateWorkoutSet } from '$lib/utils/workoutValidation';
import { db } from '$lib/server/db';
import { workoutSessions, workoutSets, exercises } from '$lib/server/db/schema';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';

export async function listSessions(userId: number, opts: { from?: string; to?: string; limit?: number } = {}) {
	const conditions = [eq(workoutSessions.userId, userId)];
	if (opts.from) conditions.push(gte(workoutSessions.date, opts.from));
	if (opts.to) conditions.push(lte(workoutSessions.date, opts.to));
	const query = db
		.select({
			id: workoutSessions.id,
			date: workoutSessions.date,
			planId: workoutSessions.planId,
			notes: workoutSessions.notes,
			createdAt: workoutSessions.createdAt,
			setCount: sql<number>`count(${workoutSets.id})`.mapWith(Number),
			exerciseCount: sql<number>`count(distinct ${workoutSets.exerciseId})`.mapWith(Number)
		})
		.from(workoutSessions)
		.leftJoin(workoutSets, eq(workoutSets.sessionId, workoutSessions.id))
		.where(and(...conditions))
		.groupBy(workoutSessions.id)
		.orderBy(desc(workoutSessions.date), desc(workoutSessions.createdAt));
	return opts.limit !== undefined ? query.limit(opts.limit) : query;
}

export async function createSession(userId: number, date: string, notes?: string | null, planId?: number | null) {
	if (!isValidIsoDate(date)) throw new Error('Invalid date');
	const [row] = await db
		.insert(workoutSessions)
		.values({ userId, date, notes: notes?.trim() || null, planId: planId ?? null, createdAt: new Date() })
		.returning();
	return row;
}

export async function updateSession(userId: number, id: number, date: string, notes?: string | null) {
	if (!isValidIsoDate(date)) throw new Error('Invalid date');
	await db
		.update(workoutSessions)
		.set({ date, notes: notes?.trim() || null })
		.where(and(eq(workoutSessions.id, id), eq(workoutSessions.userId, userId)));
}

export async function deleteSession(userId: number, id: number) {
	await db.delete(workoutSessions).where(and(eq(workoutSessions.id, id), eq(workoutSessions.userId, userId)));
}

export async function getSessionWithSets(userId: number, id: number) {
	const [session] = await db
		.select()
		.from(workoutSessions)
		.where(and(eq(workoutSessions.id, id), eq(workoutSessions.userId, userId)));
	if (!session) return null;

	const rows = await db
		.select({
			id: workoutSets.id,
			exerciseId: workoutSets.exerciseId,
			exerciseName: exercises.name,
			exerciseBrand: exercises.brand,
			order: workoutSets.order,
			reps: workoutSets.reps,
			weight: workoutSets.weight,
			rpe: workoutSets.rpe,
			notes: workoutSets.notes
		})
		.from(workoutSets)
		.innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
		.where(eq(workoutSets.sessionId, id))
		.orderBy(asc(workoutSets.order));

	const groups = new Map<
		number,
		{ exerciseId: number; exerciseName: string; exerciseBrand: string | null; sets: typeof rows }
	>();
	for (const row of rows) {
		if (!groups.has(row.exerciseId)) {
			groups.set(row.exerciseId, {
				exerciseId: row.exerciseId,
				exerciseName: row.exerciseName,
				exerciseBrand: row.exerciseBrand,
				sets: []
			});
		}
		groups.get(row.exerciseId)!.sets.push(row);
	}

	return { session, exerciseGroups: Array.from(groups.values()) };
}

export async function addSet(
	userId: number,
	sessionId: number,
	exerciseId: number,
	data: { reps: number; weight: number; rpe?: number | null; notes?: string | null }
) {
	validateWorkoutSet(data);
	const [session] = await db
		.select({ id: workoutSessions.id })
		.from(workoutSessions)
		.where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.userId, userId)));
	if (!session) throw new Error('Workout session not found');

	const [exercise] = await db
		.select({ id: exercises.id })
		.from(exercises)
		.where(and(eq(exercises.id, exerciseId), eq(exercises.userId, userId)));
	if (!exercise) throw new Error('Exercise not found');

	const [{ maxOrder }] = await db
		.select({ maxOrder: sql<number>`coalesce(max(${workoutSets.order}), -1)`.mapWith(Number) })
		.from(workoutSets)
		.where(eq(workoutSets.sessionId, sessionId));

	const [row] = await db
		.insert(workoutSets)
		.values({
			sessionId,
			exerciseId,
			order: maxOrder + 1,
			reps: data.reps,
			weight: data.weight,
			rpe: data.rpe ?? null,
			notes: data.notes?.trim() || null,
			createdAt: new Date()
		})
		.returning();
	return row;
}

async function ownsSet(userId: number, setId: number): Promise<boolean> {
	const [row] = await db
		.select({ id: workoutSets.id })
		.from(workoutSets)
		.innerJoin(workoutSessions, eq(workoutSessions.id, workoutSets.sessionId))
		.where(and(eq(workoutSets.id, setId), eq(workoutSessions.userId, userId)));
	return !!row;
}

export async function updateSet(
	userId: number,
	id: number,
	data: { reps: number; weight: number; rpe?: number | null; notes?: string | null }
) {
	validateWorkoutSet(data);
	if (!(await ownsSet(userId, id))) return;
	await db
		.update(workoutSets)
		.set({ reps: data.reps, weight: data.weight, rpe: data.rpe ?? null, notes: data.notes?.trim() || null })
		.where(eq(workoutSets.id, id));
}

export async function deleteSet(userId: number, id: number) {
	if (!(await ownsSet(userId, id))) return;
	await db.delete(workoutSets).where(eq(workoutSets.id, id));
}

/** Sets for a given exercise across all of the user's sessions, most recent first — used for repeating last session's numbers. */
export async function lastSetsForExercise(userId: number, exerciseId: number, excludeSessionId?: number) {
	const conditions = [eq(workoutSets.exerciseId, exerciseId), eq(workoutSessions.userId, userId)];
	if (excludeSessionId) conditions.push(sql`${workoutSets.sessionId} != ${excludeSessionId}`);

	return db
		.select({
			sessionId: workoutSets.sessionId,
			date: workoutSessions.date,
			reps: workoutSets.reps,
			weight: workoutSets.weight,
			order: workoutSets.order
		})
		.from(workoutSets)
		.innerJoin(workoutSessions, eq(workoutSessions.id, workoutSets.sessionId))
		.where(and(...conditions))
		.orderBy(desc(workoutSessions.date), desc(workoutSets.order))
		.limit(10);
}
