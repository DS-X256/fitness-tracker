import { db } from '$lib/server/db';
import { aiUsageDaily } from '$lib/server/db/schema';
import { and, eq, sql } from 'drizzle-orm';

// Backs the shared daily AI quota (see $lib/server/ai/client.ts). One row per user per calendar date.

export async function getUsageToday(userId: number, date: string): Promise<number> {
	const [row] = await db
		.select({ count: aiUsageDaily.count })
		.from(aiUsageDaily)
		.where(and(eq(aiUsageDaily.userId, userId), eq(aiUsageDaily.date, date)));
	return row?.count ?? 0;
}

/** Increments today's count, creating the row on first use. Not run inside a transaction with the
 *  read in generateText's quota check — a race between two concurrent requests could both pass the
 *  check and each increment, letting a user go one request over on a rare overlap. Acceptable for a
 *  handful of trusted household users; not worth the complexity of a stricter atomic guard here. */
export async function incrementUsage(userId: number, date: string): Promise<void> {
	await db
		.insert(aiUsageDaily)
		.values({ userId, date, count: 1 })
		.onConflictDoUpdate({
			target: [aiUsageDaily.userId, aiUsageDaily.date],
			set: { count: sql`${aiUsageDaily.count} + 1` }
		});
}
