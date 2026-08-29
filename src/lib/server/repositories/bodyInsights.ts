import { db } from '$lib/server/db';
import { bodyInsights } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

// Cached AI-generated body-trend summary — one row per user, overwritten on regenerate. Not encrypted:
// body data has no encryption precedent (same as nutrition / workout data).

export type BodyInsight = {
	content: string;
	model: string;
	generatedAt: Date;
};

export async function getCached(userId: number): Promise<BodyInsight | null> {
	const [row] = await db
		.select({ content: bodyInsights.content, model: bodyInsights.model, generatedAt: bodyInsights.generatedAt })
		.from(bodyInsights)
		.where(eq(bodyInsights.userId, userId));
	return row ?? null;
}

export async function save(userId: number, content: string, model: string): Promise<BodyInsight> {
	const generatedAt = new Date();
	await db
		.insert(bodyInsights)
		.values({ userId, content, model, generatedAt })
		.onConflictDoUpdate({ target: bodyInsights.userId, set: { content, model, generatedAt } });
	return { content, model, generatedAt };
}
