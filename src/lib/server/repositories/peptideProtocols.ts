import { db } from '$lib/server/db';
import { peptideProtocols } from '$lib/server/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { decryptJson, encryptJson } from '$lib/server/crypto/fieldCrypto';
import { assertPeptideOwned } from './peptideRefs';
import { getPeptide, linkComponents, sanitizeComponents } from './peptides';
import { isValidIsoDate } from '$lib/utils/isoDate';
import { isAdminRoute, type AdminRoute, type BlendComponent } from '$lib/utils/peptides';
import {
	isFrequency,
	MAX_INTERVAL_DAYS,
	MAX_TIMES_PER_DAY,
	MIN_INTERVAL_DAYS,
	taperStartDate,
	type Frequency,
	type LoadingPhase,
	type ProtocolSchedule,
	type TaperPhase
} from '$lib/utils/peptideSchedule';

// Protocol templates (the "plan" side). Schedule/dose detail is encrypted in `enc`; startDate + active
// are cleartext so the list can be ordered/filtered without decrypting.

const aad = (userId: number) => `${userId}:peptide_protocols`;

type ProtocolEnc = {
	doseMcg: number;
	route: AdminRoute | null;
	frequency: Frequency;
	weekdayMask: number | null;
	perWeek: number | null;
	timeOfDay: string | null;
	cycleWeeksOn: number | null;
	cycleWeeksOff: number | null;
	endDate: string | null;
	rotateSites: boolean;
	notes: string | null;
	/** Optional front-loaded stretch at the start of the protocol — same schedule, different dose, for
	 *  the first loadingDurationDays days. Both null together mean "no loading phase". */
	loadingDoseMcg: number | null;
	loadingDurationDays: number | null;
	/** Optional third dose tier — the "advanced" mirror of loading, but forward-anchored and open-ended:
	 *  after taperAfterDays days at the regular dose (counted from when loading ends, or startDate if
	 *  there's no loading phase), the dose steps to taperDoseMcg and just stays there — through endDate if
	 *  one is set, or forever if not. Both null together mean "no taper phase". */
	taperDoseMcg: number | null;
	taperAfterDays: number | null;
	/** Doses per scheduled day (1-4). Absent on protocols written before multi-dose days → 1. */
	timesPerDay: number;
	/** Days between doses for frequency 'every_n_days' (2-30), null otherwise. */
	intervalDays: number | null;
	/** Per-protocol blend mix, overriding the blend compound's default ratio — vendors' mixes vary, and
	 *  this is the one the user's current vials actually hold. Only ever set for a blend compound. Each
	 *  logged dose snapshots whichever mix applied (see repositories/peptideDoses.ts). */
	components: BlendComponent[] | null;
};

export type Protocol = {
	id: number;
	peptideId: number;
	startDate: string;
	active: boolean;
	createdAt: Date;
	updatedAt: Date;
} & ProtocolEnc;

export type ProtocolInput = {
	peptideId: number;
	doseMcg: number;
	route?: AdminRoute | null;
	frequency: Frequency;
	weekdayMask?: number | null;
	perWeek?: number | null;
	timeOfDay?: string | null;
	startDate: string;
	endDate?: string | null;
	cycleWeeksOn?: number | null;
	cycleWeeksOff?: number | null;
	rotateSites?: boolean;
	notes?: string | null;
	loadingDoseMcg?: number | null;
	loadingDurationDays?: number | null;
	taperDoseMcg?: number | null;
	taperAfterDays?: number | null;
	timesPerDay?: number | null;
	intervalDays?: number | null;
	components?: BlendComponent[] | null;
};

function decode(row: typeof peptideProtocols.$inferSelect): Protocol {
	const enc = decryptJson<Partial<ProtocolEnc> & Pick<ProtocolEnc, 'doseMcg' | 'frequency'>>(row.enc, aad(row.userId));
	// Explicit defaults rather than spreading `enc`: rows written before a field existed simply lack it.
	return {
		id: row.id,
		peptideId: row.peptideId,
		startDate: row.startDate,
		active: row.active,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		doseMcg: enc.doseMcg,
		route: enc.route ?? null,
		frequency: enc.frequency,
		weekdayMask: enc.weekdayMask ?? null,
		perWeek: enc.perWeek ?? null,
		timeOfDay: enc.timeOfDay ?? null,
		cycleWeeksOn: enc.cycleWeeksOn ?? null,
		cycleWeeksOff: enc.cycleWeeksOff ?? null,
		endDate: enc.endDate ?? null,
		rotateSites: enc.rotateSites ?? true,
		notes: enc.notes ?? null,
		loadingDoseMcg: enc.loadingDoseMcg ?? null,
		loadingDurationDays: enc.loadingDurationDays ?? null,
		taperDoseMcg: enc.taperDoseMcg ?? null,
		taperAfterDays: enc.taperAfterDays ?? null,
		timesPerDay: enc.timesPerDay ?? 1,
		intervalDays: enc.intervalDays ?? null,
		components: enc.components
			? enc.components.map((c) => ({ name: c.name, percent: c.percent, peptideId: c.peptideId ?? null, labelMg: c.labelMg ?? null }))
			: null
	};
}

/** The subset the schedule engine needs. */
export function toSchedule(p: Protocol): ProtocolSchedule {
	return {
		frequency: p.frequency,
		weekdayMask: p.weekdayMask,
		perWeek: p.perWeek,
		startDate: p.startDate,
		endDate: p.endDate,
		cycleWeeksOn: p.cycleWeeksOn,
		cycleWeeksOff: p.cycleWeeksOff,
		intervalDays: p.intervalDays,
		timesPerDay: p.timesPerDay
	};
}

/** The loading-phase subset for peptideSchedule's effectiveDoseMcg/isLoadingPhaseOn/loadingEndDate.
 *  Null when the protocol has no loading phase configured. */
export function toLoadingPhase(p: Protocol): LoadingPhase | null {
	if (p.loadingDoseMcg == null || p.loadingDurationDays == null) return null;
	return { doseMcg: p.loadingDoseMcg, durationDays: p.loadingDurationDays };
}

/** The taper-phase subset for peptideSchedule's effectiveDoseMcg/isTaperPhaseOn/taperStartDate. Null
 *  when the protocol has no taper phase configured. */
export function toTaperPhase(p: Protocol): TaperPhase | null {
	if (p.taperDoseMcg == null || p.taperAfterDays == null) return null;
	return { doseMcg: p.taperDoseMcg, afterDays: p.taperAfterDays };
}

function posIntOrNull(v: number | null | undefined, max: number, label: string): number | null {
	if (v == null) return null;
	if (!Number.isInteger(v) || v <= 0 || v > max) throw new Error(`${label} is out of range`);
	return v;
}

/** Like posIntOrNull but allows 0 (taperAfterDays: 0 means "start the taper immediately"). */
function nonNegIntOrNull(v: number | null | undefined, max: number, label: string): number | null {
	if (v == null) return null;
	if (!Number.isInteger(v) || v < 0 || v > max) throw new Error(`${label} is out of range`);
	return v;
}

function sanitize(input: ProtocolInput): { enc: ProtocolEnc; startDate: string } {
	if (!Number.isFinite(input.doseMcg) || input.doseMcg <= 0 || input.doseMcg > 100_000) {
		throw new Error('Dose (mcg) is out of range');
	}
	if (!isFrequency(input.frequency)) throw new Error('Invalid frequency');
	if (!isValidIsoDate(input.startDate)) throw new Error('Invalid start date');
	if (input.endDate && !isValidIsoDate(input.endDate)) throw new Error('Invalid end date');
	if (input.endDate && input.endDate < input.startDate) throw new Error('End date is before the start date');

	let weekdayMask: number | null = null;
	if (input.frequency === 'weekly') {
		weekdayMask = input.weekdayMask ?? 0;
		if (!Number.isInteger(weekdayMask) || weekdayMask <= 0 || weekdayMask > 0b1111111) {
			throw new Error('Pick at least one weekday');
		}
	}
	let perWeek: number | null = null;
	if (input.frequency === 'x_per_week') {
		perWeek = posIntOrNull(input.perWeek, 21, 'Doses per week');
		if (perWeek == null) throw new Error('Enter how many doses per week');
	}
	let intervalDays: number | null = null;
	if (input.frequency === 'every_n_days') {
		intervalDays = posIntOrNull(input.intervalDays, MAX_INTERVAL_DAYS, 'Days between doses');
		if (intervalDays == null || intervalDays < MIN_INTERVAL_DAYS) {
			throw new Error(`Enter how many days between doses (${MIN_INTERVAL_DAYS}-${MAX_INTERVAL_DAYS})`);
		}
	}
	// A flexible weekly target has no per-day slots to multiply.
	const timesPerDay =
		input.frequency === 'x_per_week' ? 1 : (posIntOrNull(input.timesPerDay ?? 1, MAX_TIMES_PER_DAY, 'Doses per day') ?? 1);

	const on = posIntOrNull(input.cycleWeeksOn, 104, 'Weeks on');
	const off = posIntOrNull(input.cycleWeeksOff, 104, 'Weeks off');
	if ((on == null) !== (off == null)) throw new Error('Set both weeks-on and weeks-off, or neither');

	const loadingDurationDays = posIntOrNull(input.loadingDurationDays, 365, 'Loading phase length');
	let loadingDoseMcg: number | null = null;
	if (loadingDurationDays != null) {
		if (input.loadingDoseMcg == null || !Number.isFinite(input.loadingDoseMcg) || input.loadingDoseMcg <= 0 || input.loadingDoseMcg > 100_000) {
			throw new Error('Enter a loading-phase dose (mcg)');
		}
		loadingDoseMcg = Math.round(input.loadingDoseMcg * 1000) / 1000;
	} else if (input.loadingDoseMcg != null) {
		throw new Error('Set a loading-phase length, or clear the loading dose');
	}

	const taperAfterDays = nonNegIntOrNull(input.taperAfterDays, 3650, 'Taper start');
	let taperDoseMcg: number | null = null;
	if (taperAfterDays != null) {
		if (input.taperDoseMcg == null || !Number.isFinite(input.taperDoseMcg) || input.taperDoseMcg <= 0 || input.taperDoseMcg > 100_000) {
			throw new Error('Enter a taper-phase dose (mcg)');
		}
		// Not required to be reachable before endDate ends the protocol outright — that's a plausible
		// "I changed my mind, wind this down early" edit — but a taper that can never start at all
		// (misconfigured to begin after a protocol that already has a fixed end) is worth catching.
		const loadingPhase =
			loadingDurationDays != null && loadingDoseMcg != null ? { doseMcg: loadingDoseMcg, durationDays: loadingDurationDays } : null;
		const taperStart = taperStartDate(input.startDate, loadingPhase, { doseMcg: input.taperDoseMcg, afterDays: taperAfterDays });
		if (input.endDate && taperStart && taperStart > input.endDate) {
			throw new Error("Taper phase starts after the protocol's end date — shorten it or move the end date out");
		}
		taperDoseMcg = Math.round(input.taperDoseMcg * 1000) / 1000;
	} else if (input.taperDoseMcg != null) {
		throw new Error('Set when the taper phase starts, or clear the taper dose');
	}

	return {
		startDate: input.startDate,
		enc: {
			doseMcg: Math.round(input.doseMcg * 1000) / 1000,
			// Broad validator (any AdminRoute) — isInjectionRoute here previously silently dropped every
			// non-injection route on write, the same bug fixed in repositories/peptideDoses.ts.
			route: isAdminRoute(input.route) ? input.route : null,
			frequency: input.frequency,
			weekdayMask,
			perWeek,
			timeOfDay: input.timeOfDay?.trim() || null,
			cycleWeeksOn: on,
			cycleWeeksOff: off,
			endDate: input.endDate || null,
			rotateSites: input.rotateSites ?? true,
			notes: input.notes?.trim() || null,
			loadingDoseMcg,
			loadingDurationDays,
			taperDoseMcg,
			taperAfterDays,
			timesPerDay,
			intervalDays,
			components: null // resolved against the compound in resolveMix() — needs a DB read
		}
	};
}

/** The per-protocol blend mix, validated and linked to the same component compounds as the blend's own
 *  default. Null (use the compound's default) when the compound isn't a blend or no override was given. */
async function resolveMix(userId: number, peptideId: number, input: BlendComponent[] | null | undefined): Promise<BlendComponent[] | null> {
	if (!input || input.length === 0) return null;
	const compound = await getPeptide(userId, peptideId);
	if (!compound?.isBlend) return null;
	return linkComponents(userId, compound.id, sanitizeComponents(input), compound.category);
}

export async function listProtocols(
	userId: number,
	opts: { activeOnly?: boolean; peptideId?: number } = {}
): Promise<Protocol[]> {
	const conds = [eq(peptideProtocols.userId, userId)];
	if (opts.activeOnly) conds.push(eq(peptideProtocols.active, true));
	if (opts.peptideId) conds.push(eq(peptideProtocols.peptideId, opts.peptideId));
	const rows = await db
		.select()
		.from(peptideProtocols)
		.where(and(...conds))
		.orderBy(asc(peptideProtocols.active), asc(peptideProtocols.startDate));
	return rows.map(decode);
}

export async function getProtocol(userId: number, id: number): Promise<Protocol | null> {
	const [row] = await db
		.select()
		.from(peptideProtocols)
		.where(and(eq(peptideProtocols.id, id), eq(peptideProtocols.userId, userId)));
	return row ? decode(row) : null;
}

export async function createProtocol(userId: number, input: ProtocolInput): Promise<Protocol> {
	const { enc, startDate } = sanitize(input);
	await assertPeptideOwned(userId, input.peptideId);
	enc.components = await resolveMix(userId, input.peptideId, input.components);
	const now = new Date();
	const [row] = await db
		.insert(peptideProtocols)
		.values({
			userId,
			peptideId: input.peptideId,
			enc: encryptJson(enc, aad(userId)),
			startDate,
			createdAt: now,
			updatedAt: now
		})
		.returning();
	return decode(row);
}

export async function updateProtocol(userId: number, id: number, input: ProtocolInput): Promise<void> {
	const { enc, startDate } = sanitize(input);
	await assertPeptideOwned(userId, input.peptideId);
	enc.components = await resolveMix(userId, input.peptideId, input.components);
	await db
		.update(peptideProtocols)
		// peptideId included: switching a protocol to a different compound used to be silently dropped.
		.set({ peptideId: input.peptideId, enc: encryptJson(enc, aad(userId)), startDate, updatedAt: new Date() })
		.where(and(eq(peptideProtocols.id, id), eq(peptideProtocols.userId, userId)));
}

export async function setProtocolActive(userId: number, id: number, active: boolean): Promise<void> {
	await db
		.update(peptideProtocols)
		.set({ active, updatedAt: new Date() })
		.where(and(eq(peptideProtocols.id, id), eq(peptideProtocols.userId, userId)));
}

export async function deleteProtocol(userId: number, id: number): Promise<void> {
	await db.delete(peptideProtocols).where(and(eq(peptideProtocols.id, id), eq(peptideProtocols.userId, userId)));
}
