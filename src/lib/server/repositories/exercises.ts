import { db } from '$lib/server/db';
import { exercises, workoutSets } from '$lib/server/db/schema';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

export async function listExercises(userId: number) {
	return db
		.select({
			id: exercises.id,
			name: exercises.name,
			brand: exercises.brand,
			muscleGroup: exercises.muscleGroup,
			setCount: sql<number>`count(${workoutSets.id})`.mapWith(Number)
		})
		.from(exercises)
		.leftJoin(workoutSets, eq(workoutSets.exerciseId, exercises.id))
		.where(eq(exercises.userId, userId))
		.groupBy(exercises.id)
		.orderBy(asc(exercises.name));
}

export async function getExercise(userId: number, id: number) {
	const [row] = await db
		.select()
		.from(exercises)
		.where(and(eq(exercises.id, id), eq(exercises.userId, userId)));
	return row ?? null;
}

export async function createExercise(
	userId: number,
	name: string,
	muscleGroup?: string | null,
	brand?: string | null
) {
	const trimmed = name.trim();
	if (!trimmed) throw new Error('Exercise name is required');
	const [row] = await db
		.insert(exercises)
		.values({
			userId,
			name: trimmed,
			brand: brand?.trim() || null,
			muscleGroup: muscleGroup?.trim() || null,
			createdAt: new Date()
		})
		.returning();
	return row;
}

export async function updateExercise(
	userId: number,
	id: number,
	name: string,
	muscleGroup?: string | null,
	brand?: string | null
) {
	await db
		.update(exercises)
		.set({ name: name.trim(), brand: brand?.trim() || null, muscleGroup: muscleGroup?.trim() || null })
		.where(and(eq(exercises.id, id), eq(exercises.userId, userId)));
}

export async function deleteExercise(userId: number, id: number) {
	await db.delete(exercises).where(and(eq(exercises.id, id), eq(exercises.userId, userId)));
}

/** Reuses `userId`'s existing exercise with this exact name+brand, or creates one — used when
 *  copying another user's plan into this user's own library (shared plans, or Train Together's
 *  session clone) so the copy's planExercises point at exercises this user actually owns. */
export async function findOrCreateExercise(
	userId: number,
	name: string,
	brand?: string | null,
	muscleGroup?: string | null
) {
	const trimmedBrand = brand?.trim() || null;
	const [existing] = await db
		.select()
		.from(exercises)
		.where(
			and(
				eq(exercises.userId, userId),
				eq(exercises.name, name),
				trimmedBrand ? eq(exercises.brand, trimmedBrand) : isNull(exercises.brand)
			)
		);
	if (existing) return existing;
	return createExercise(userId, name, muscleGroup, trimmedBrand);
}
