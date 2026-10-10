import { db } from '$lib/server/db';
import { weightGoals } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { isValidIsoDate } from '$lib/utils/isoDate';
import { weightStats, type WeightStats } from './bodyMetrics';

export type WeightGoal = { targetWeightKg: number; targetDate: string | null };

export async function getWeightGoal(userId: number): Promise<WeightGoal | null> {
	const [row] = await db
		.select({ targetWeightKg: weightGoals.targetWeightKg, targetDate: weightGoals.targetDate })
		.from(weightGoals)
		.where(eq(weightGoals.userId, userId));
	return row ?? null;
}

export async function upsertWeightGoal(userId: number, targetWeightKg: number, targetDate: string | null) {
	if (!Number.isFinite(targetWeightKg) || targetWeightKg <= 0 || targetWeightKg > 700) {
		throw new Error('Target weight is out of range');
	}
	if (targetDate !== null && !isValidIsoDate(targetDate)) throw new Error('Invalid target date');
	const now = new Date();
	await db
		.insert(weightGoals)
		.values({ userId, targetWeightKg, targetDate, createdAt: now, updatedAt: now })
		.onConflictDoUpdate({ target: weightGoals.userId, set: { targetWeightKg, targetDate, updatedAt: now } });
}

export async function deleteWeightGoal(userId: number) {
	await db.delete(weightGoals).where(eq(weightGoals.userId, userId));
}

export type WeightGoalProgress = {
	targetWeightKg: number;
	targetDate: string | null;
	currentKg: number | null;
	/** Signed kg still to go (negative when the target is below current, i.e. a cut). */
	remainingKg: number | null;
	/** 0..1 completion from the current trend's implied start toward the target. Null without data. */
	progress: number | null;
	achieved: boolean;
	/** Weeks to reach the goal at the recent weekly rate, or null if the trend moves away from it. */
	etaWeeks: number | null;
};

/** Combines the goal with live weight stats to produce progress + an ETA projection.
 *  Callers that already loaded this user's stats can reuse them, including an empty history (null). */
export async function goalProgress(userId: number, knownStats?: WeightStats | null): Promise<WeightGoalProgress | null> {
	const goal = await getWeightGoal(userId);
	if (!goal) return null;
	const stats = knownStats === undefined ? await weightStats(userId) : knownStats;
	if (!stats) {
		return {
			targetWeightKg: goal.targetWeightKg,
			targetDate: goal.targetDate,
			currentKg: null,
			remainingKg: null,
			progress: null,
			achieved: false,
			etaWeeks: null
		};
	}

	const current = stats.weightKg;
	const remaining = Math.round((goal.targetWeightKg - current) * 100) / 100;
	const achieved = Math.abs(remaining) < 0.1;

	// ETA: only meaningful when the recent trend moves toward the target.
	let etaWeeks: number | null = null;
	if (!achieved && stats.weeklyRateKg && stats.weeklyRateKg !== 0) {
		const movingToward = Math.sign(stats.weeklyRateKg) === Math.sign(remaining);
		if (movingToward) etaWeeks = Math.round((Math.abs(remaining) / Math.abs(stats.weeklyRateKg)) * 10) / 10;
	}

	// Progress relative to the 30-day baseline start, so the bar reflects the current effort.
	let progress: number | null = null;
	if (stats.change30 !== null) {
		const startKg = current - stats.change30;
		const total = goal.targetWeightKg - startKg;
		if (Math.abs(total) > 0.01) progress = Math.max(0, Math.min(1, (current - startKg) / total));
	}

	return {
		targetWeightKg: goal.targetWeightKg,
		targetDate: goal.targetDate,
		currentKg: current,
		remainingKg: remaining,
		progress,
		achieved,
		etaWeeks
	};
}
