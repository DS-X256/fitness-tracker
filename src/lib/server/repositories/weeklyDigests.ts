import { db } from '$lib/server/db';
import { weeklyDigests } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';

// Cached AI-generated weekly recap, one row per (user, isoWeekStart) — mirrors barcodeCache's
// insert-then-select pattern so concurrent requests for the same week never double-call the API.

export type WeeklyDigest = {
	content: string;
	model: string;
	generatedAt: Date;
};

export async function getForWeek(userId: number, isoWeekStart: string): Promise<WeeklyDigest | null> {
	const [row] = await db
		.select({ content: weeklyDigests.content, model: weeklyDigests.model, generatedAt: weeklyDigests.generatedAt })
		.from(weeklyDigests)
		.where(and(eq(weeklyDigests.userId, userId), eq(weeklyDigests.isoWeekStart, isoWeekStart)));
	return row ?? null;
}

/** First write for a given (user, week) wins — a race between two requests just means the loser reads
 *  back the winner's row instead of double-billing an API call. */
export async function create(
	userId: number,
	isoWeekStart: string,
	content: string,
	model: string
): Promise<WeeklyDigest> {
	const generatedAt = new Date();
	await db
		.insert(weeklyDigests)
		.values({ userId, isoWeekStart, content, model, generatedAt })
		.onConflictDoNothing();
	return (await getForWeek(userId, isoWeekStart)) ?? { content, model, generatedAt };
}

/** Explicit regeneration of an existing week's digest — only called after the orchestrator's cooldown
 *  check passes. */
export async function regenerate(
	userId: number,
	isoWeekStart: string,
	content: string,
	model: string
): Promise<WeeklyDigest> {
	const generatedAt = new Date();
	await db
		.insert(weeklyDigests)
		.values({ userId, isoWeekStart, content, model, generatedAt })
		.onConflictDoUpdate({
			target: [weeklyDigests.userId, weeklyDigests.isoWeekStart],
			set: { content, model, generatedAt }
		});
	return { content, model, generatedAt };
}
