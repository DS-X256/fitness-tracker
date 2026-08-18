import { db } from '$lib/server/db';
import { peptideProtocols } from '$lib/server/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { decryptJson, encryptJson } from '$lib/server/crypto/fieldCrypto';
import { isValidIsoDate } from '$lib/utils/isoDate';
import { isAdminRoute, type AdminRoute } from '$lib/utils/peptides';
import { isFrequency, type Frequency, type ProtocolSchedule } from '$lib/utils/peptideSchedule';

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
};

function decode(row: typeof peptideProtocols.$inferSelect): Protocol {
	const enc = decryptJson<ProtocolEnc>(row.enc, aad(row.userId));
	return {
		id: row.id,
		peptideId: row.peptideId,
		startDate: row.startDate,
		active: row.active,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		...enc
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
		cycleWeeksOff: p.cycleWeeksOff
	};
}

function posIntOrNull(v: number | null | undefined, max: number, label: string): number | null {
	if (v == null) return null;
	if (!Number.isInteger(v) || v <= 0 || v > max) throw new Error(`${label} is out of range`);
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

	const on = posIntOrNull(input.cycleWeeksOn, 104, 'Weeks on');
	const off = posIntOrNull(input.cycleWeeksOff, 104, 'Weeks off');
	if ((on == null) !== (off == null)) throw new Error('Set both weeks-on and weeks-off, or neither');

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
			notes: input.notes?.trim() || null
		}
	};
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
	await db
		.update(peptideProtocols)
		.set({ enc: encryptJson(enc, aad(userId)), startDate, updatedAt: new Date() })
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
