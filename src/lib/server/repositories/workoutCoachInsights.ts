import { db } from '$lib/server/db';
import { workoutCoachInsights } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';

// Cached AI coaching suggestion, one row per workout session — overwritten on regenerate (a session can
// gain more sets mid-workout, so unlike the weekly digest this is meant to be refreshed, not append-only).

export type CoachInsight = {
	content: string;
	model: string;
	generatedAt: Date;
};

export async function getCached(userId: number, sessionId: number): Promise<CoachInsight | null> {
	const [row] = await db
		.select({
			content: workoutCoachInsights.content,
			model: workoutCoachInsights.model,
			generatedAt: workoutCoachInsights.generatedAt
		})
		.from(workoutCoachInsights)
		.where(and(eq(workoutCoachInsights.userId, userId), eq(workoutCoachInsights.sessionId, sessionId)));
	return row ?? null;
}

export async function save(
	userId: number,
	sessionId: number,
	content: string,
	model: string
): Promise<CoachInsight> {
	const generatedAt = new Date();
	await db
		.insert(workoutCoachInsights)
		.values({ userId, sessionId, content, model, generatedAt })
		.onConflictDoUpdate({ target: workoutCoachInsights.sessionId, set: { content, model, generatedAt } });
	return { content, model, generatedAt };
}
