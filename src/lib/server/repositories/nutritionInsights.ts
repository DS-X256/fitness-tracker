import { db } from '$lib/server/db';
import { nutritionInsights } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

// Cached AI-generated nutrition-trend summary — one row per user, overwritten on regenerate. Not
// encrypted: nutrition data has no encryption precedent (same as the workout coach / weekly digest).

export type NutritionInsight = {
	content: string;
	model: string;
	generatedAt: Date;
};

export async function getCached(userId: number): Promise<NutritionInsight | null> {
	const [row] = await db
		.select({ content: nutritionInsights.content, model: nutritionInsights.model, generatedAt: nutritionInsights.generatedAt })
		.from(nutritionInsights)
		.where(eq(nutritionInsights.userId, userId));
	return row ?? null;
}

export async function save(userId: number, content: string, model: string): Promise<NutritionInsight> {
	const generatedAt = new Date();
	await db
		.insert(nutritionInsights)
		.values({ userId, content, model, generatedAt })
		.onConflictDoUpdate({ target: nutritionInsights.userId, set: { content, model, generatedAt } });
	return { content, model, generatedAt };
}
