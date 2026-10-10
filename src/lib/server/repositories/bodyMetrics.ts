import { db } from '$lib/server/db';
import { bodyMetrics } from '$lib/server/db/schema';
import { and, asc, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { isValidIsoDate, shiftIsoDate } from '$lib/utils/isoDate';
import { todayIso } from '$lib/utils/todayIso';

/** Canonical units: weightKg in kg, all *Cm circumferences in cm, bodyFatPct as a percentage. */
export type BodyMetricInput = {
	weightKg?: number | null;
	bodyFatPct?: number | null;
	neckCm?: number | null;
	chestCm?: number | null;
	waistCm?: number | null;
	hipsCm?: number | null;
	thighCm?: number | null;
	armCm?: number | null;
	calfCm?: number | null;
	notes?: string | null;
};

// [max] plausibility ceilings — reject nonsense while staying generous. Used both to validate and to
// enumerate the numeric metric columns.
const NUMERIC_FIELDS: Record<keyof Omit<BodyMetricInput, 'notes'>, number> = {
	weightKg: 700,
	bodyFatPct: 100,
	neckCm: 500,
	chestCm: 500,
	waistCm: 500,
	hipsCm: 500,
	thighCm: 500,
	armCm: 500,
	calfCm: 500
};

/** Builds the column subset to write: `undefined` fields are left untouched, `null` clears, and numbers
 *  are range-checked. Throws on an out-of-range value so bad input never reaches the DB. */
function sanitize(input: BodyMetricInput): Partial<BodyMetricInput> {
	const out: Partial<BodyMetricInput> = {};
	for (const key of Object.keys(NUMERIC_FIELDS) as (keyof typeof NUMERIC_FIELDS)[]) {
		if (!(key in input)) continue;
		const v = input[key];
		if (v === null || v === undefined) {
			if (key in input) out[key] = null;
			continue;
		}
		if (!Number.isFinite(v) || v <= 0 || v > NUMERIC_FIELDS[key]) {
			throw new Error(`Invalid value for ${key}`);
		}
		out[key] = Math.round(v * 100) / 100;
	}
	if ('notes' in input) {
		const n = input.notes == null ? null : String(input.notes).trim();
		out.notes = n ? n : null;
	}
	return out;
}

/** Upsert/merge one day's metrics: only the provided fields are written, so logging weight now and a
 *  waist measurement later the same day accumulate on the single (userId, date) row. */
export async function logBodyMetrics(userId: number, date: string, input: BodyMetricInput) {
	if (!isValidIsoDate(date)) throw new Error('Invalid date');
	const clean = sanitize(input);
	if (Object.keys(clean).length === 0) throw new Error('Nothing to log');
	const now = new Date();
	await db
		.insert(bodyMetrics)
		.values({ userId, date, ...clean, createdAt: now, updatedAt: now })
		.onConflictDoUpdate({ target: [bodyMetrics.userId, bodyMetrics.date], set: { ...clean, updatedAt: now } });
}

export async function getBodyMetric(userId: number, date: string) {
	const [row] = await db
		.select()
		.from(bodyMetrics)
		.where(and(eq(bodyMetrics.userId, userId), eq(bodyMetrics.date, date)));
	return row ?? null;
}

export async function listBodyMetrics(userId: number, opts: { limit?: number } = {}) {
	const q = db
		.select()
		.from(bodyMetrics)
		.where(eq(bodyMetrics.userId, userId))
		.orderBy(desc(bodyMetrics.date));
	return opts.limit ? q.limit(opts.limit) : q;
}

/** The most recent row that has at least one measurement — for a "latest measurements" summary. */
export async function latestBodyMetric(userId: number) {
	const [row] = await db
		.select()
		.from(bodyMetrics)
		.where(eq(bodyMetrics.userId, userId))
		.orderBy(desc(bodyMetrics.date))
		.limit(1);
	return row ?? null;
}

export async function deleteBodyMetric(userId: number, id: number) {
	await db.delete(bodyMetrics).where(and(eq(bodyMetrics.id, id), eq(bodyMetrics.userId, userId)));
}

export type WeightPoint = { date: string; weightKg: number; avgKg: number };

const TREND_WINDOW = 7; // trailing points averaged for the smoothed line

type WeightReading = { date: string; weightKg: number };

async function loadWeights(userId: number, opts: { days?: number } = {}): Promise<WeightReading[]> {
	const conds = [eq(bodyMetrics.userId, userId), isNotNull(bodyMetrics.weightKg)];
	if (opts.days) conds.push(gte(bodyMetrics.date, shiftIsoDate(todayIso(), -opts.days)));

	const rows = await db
		.select({ date: bodyMetrics.date, weightKg: bodyMetrics.weightKg })
		.from(bodyMetrics)
		.where(and(...conds))
		.orderBy(asc(bodyMetrics.date));

	return rows.map((r) => ({ date: r.date, weightKg: r.weightKg as number }));
}

function smoothWeights(points: WeightReading[]): WeightPoint[] {
	return points.map((p, i) => {
		const slice = points.slice(Math.max(0, i - TREND_WINDOW + 1), i + 1);
		const avg = slice.reduce((s, x) => s + x.weightKg, 0) / slice.length;
		return { date: p.date, weightKg: p.weightKg, avgKg: Math.round(avg * 100) / 100 };
	});
}

/** Body-weight series (ascending) with a trailing moving-average column for the trend line. */
export async function weightTrend(userId: number, opts: { days?: number } = {}): Promise<WeightPoint[]> {
	return smoothWeights(await loadWeights(userId, opts));
}

/** One history read for both lifetime statistics and a bounded chart. Smoothing starts
 *  at the chart boundary, matching weightTrend's existing behavior. */
export async function weightOverview(userId: number, opts: { days?: number } = {}) {
	const points = await loadWeights(userId);
	const from = opts.days ? shiftIsoDate(todayIso(), -opts.days) : null;
	return {
		stats: statsFromWeights(points),
		trend: smoothWeights(from ? points.filter((p) => p.date >= from) : points)
	};
}

export type WeightStats = {
	weightKg: number;
	date: string;
	change7: number | null;
	change30: number | null;
	/** kg/week over the last 30 days (positive = gaining). Null until there's enough history. */
	weeklyRateKg: number | null;
	count: number;
};

export async function weightStats(userId: number): Promise<WeightStats | null> {
	return statsFromWeights(await loadWeights(userId));
}

function statsFromWeights(points: WeightReading[]): WeightStats | null {
	if (points.length === 0) return null;
	const latest = points[points.length - 1];

	const baselineOnOrBefore = (targetDate: string) => {
		let found: WeightReading | null = null;
		for (const p of points) {
			if (p.date <= targetDate) found = p;
			else break;
		}
		return found;
	};

	const change = (days: number): number | null => {
		const base = baselineOnOrBefore(shiftIsoDate(latest.date, -days));
		if (!base || base.date === latest.date) return null;
		return Math.round((latest.weightKg - base.weightKg) * 100) / 100;
	};

	const base30 = baselineOnOrBefore(shiftIsoDate(latest.date, -30)) ?? points[0];
	let weeklyRateKg: number | null = null;
	if (base30 && base30.date !== latest.date) {
		const spanDays = daysBetween(base30.date, latest.date);
		if (spanDays > 0) weeklyRateKg = Math.round(((latest.weightKg - base30.weightKg) / (spanDays / 7)) * 100) / 100;
	}

	return {
		weightKg: latest.weightKg,
		date: latest.date,
		change7: change(7),
		change30: change(30),
		weeklyRateKg,
		count: points.length
	};
}

function daysBetween(fromIso: string, toIso: string): number {
	const [ay, am, ad] = fromIso.split('-').map(Number);
	const [by, bm, bd] = toIso.split('-').map(Number);
	const a = Date.UTC(ay, am - 1, ad);
	const b = Date.UTC(by, bm - 1, bd);
	return Math.round((b - a) / 86_400_000);
}
