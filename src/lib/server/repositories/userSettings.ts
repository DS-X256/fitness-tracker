import { db } from '$lib/server/db';
import { userSettings } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { LengthUnit, WeightUnit } from '$lib/utils/units';

export type UserSettings = {
	weightUnit: WeightUnit;
	lengthUnit: LengthUnit;
	heightCm: number | null;
	/** Opt-in, default off — see repositories/peptideInsights.ts. */
	aiPeptideInsightsEnabled: boolean;
};

const DEFAULTS: UserSettings = { weightUnit: 'kg', lengthUnit: 'cm', heightCm: null, aiPeptideInsightsEnabled: false };

/** One row per user, created lazily. Absent row = defaults (metric, no height, AI insights off). */
export async function getSettings(userId: number): Promise<UserSettings> {
	const [row] = await db
		.select({
			weightUnit: userSettings.weightUnit,
			lengthUnit: userSettings.lengthUnit,
			heightCm: userSettings.heightCm,
			aiPeptideInsightsEnabled: userSettings.aiPeptideInsightsEnabled
		})
		.from(userSettings)
		.where(eq(userSettings.userId, userId));
	if (!row) return { ...DEFAULTS };
	return {
		weightUnit: row.weightUnit as WeightUnit,
		lengthUnit: row.lengthUnit as LengthUnit,
		heightCm: row.heightCm,
		aiPeptideInsightsEnabled: row.aiPeptideInsightsEnabled
	};
}

export async function updateSettings(userId: number, patch: Partial<UserSettings>): Promise<UserSettings> {
	const current = await getSettings(userId);
	const next: UserSettings = {
		weightUnit: patch.weightUnit ?? current.weightUnit,
		lengthUnit: patch.lengthUnit ?? current.lengthUnit,
		heightCm: patch.heightCm !== undefined ? patch.heightCm : current.heightCm,
		aiPeptideInsightsEnabled: patch.aiPeptideInsightsEnabled ?? current.aiPeptideInsightsEnabled
	};

	if (next.weightUnit !== 'kg' && next.weightUnit !== 'lb') throw new Error('Invalid weight unit');
	if (next.lengthUnit !== 'cm' && next.lengthUnit !== 'in') throw new Error('Invalid length unit');
	if (next.heightCm !== null && (!Number.isFinite(next.heightCm) || next.heightCm <= 0 || next.heightCm > 300)) {
		throw new Error('Height must be between 1 and 300 cm');
	}

	const now = new Date();
	await db
		.insert(userSettings)
		.values({ userId, ...next, updatedAt: now })
		.onConflictDoUpdate({ target: userSettings.userId, set: { ...next, updatedAt: now } });
	return next;
}
