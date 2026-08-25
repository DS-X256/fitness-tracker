import { db } from '$lib/server/db';
import { peptideVials, peptideDoses } from '$lib/server/db/schema';
import { and, asc, eq, sql } from 'drizzle-orm';
import { decryptJson, encryptJson } from '$lib/server/crypto/fieldCrypto';
import { isValidIsoDate } from '$lib/utils/isoDate';
import { isContainerForm, type ContainerForm } from '$lib/utils/peptides';

// Inventory: one container of peptide. `form` defaults to 'vial' (the original, and for a long time
// only, shape) — reconstituted powder drawn on a syringe. Everything else is additive: a nasal_spray/
// serum container reuses vialMg+bacWaterMl as an optional self-mix path (mg powder / mL diluent), or
// takes concentrationMgMl/percentWv directly for a pre-made liquid; capsules/patches use unitCount +
// unitMassMcg instead. Contents are encrypted in `enc`; only the depleted flag is cleartext.

const aad = (userId: number) => `${userId}:peptide_vials`;

type VialEnc = {
	vialMg: number | null;
	bacWaterMl: number | null;
	reconstitutedAt: string | null;
	expiresAt: string | null;
	notes: string | null;
	form: ContainerForm;
	concentrationMgMl: number | null;
	percentWv: number | null;
	actuationVolumeUl: number | null;
	primingActuations: number | null;
	unitCount: number | null;
	unitMassMcg: number | null;
};

export type Vial = {
	id: number;
	peptideId: number;
	depleted: boolean;
	createdAt: Date;
} & VialEnc;

export type VialWithUsage = Vial & { dosesLogged: number };

export type VialInput = {
	peptideId: number;
	form?: ContainerForm;
	vialMg?: number | null;
	bacWaterMl?: number | null;
	reconstitutedAt?: string | null;
	expiresAt?: string | null;
	notes?: string | null;
	concentrationMgMl?: number | null;
	percentWv?: number | null;
	actuationVolumeUl?: number | null;
	primingActuations?: number | null;
	unitCount?: number | null;
	unitMassMcg?: number | null;
};

function decode(row: typeof peptideVials.$inferSelect): Vial {
	const enc = decryptJson<Partial<VialEnc> & { vialMg?: number | null }>(row.enc, aad(row.userId));
	return {
		id: row.id,
		peptideId: row.peptideId,
		depleted: row.depleted,
		createdAt: row.createdAt,
		vialMg: enc.vialMg ?? null,
		bacWaterMl: enc.bacWaterMl ?? null,
		reconstitutedAt: enc.reconstitutedAt ?? null,
		expiresAt: enc.expiresAt ?? null,
		notes: enc.notes ?? null,
		form: enc.form ?? 'vial',
		concentrationMgMl: enc.concentrationMgMl ?? null,
		percentWv: enc.percentWv ?? null,
		actuationVolumeUl: enc.actuationVolumeUl ?? null,
		primingActuations: enc.primingActuations ?? null,
		unitCount: enc.unitCount ?? null,
		unitMassMcg: enc.unitMassMcg ?? null
	};
}

function positiveOrNull(v: number | null | undefined, max: number, label: string): number | null {
	if (v == null) return null;
	if (!Number.isFinite(v) || v <= 0 || v > max) throw new Error(`${label} is out of range`);
	return Math.round(v * 1000) / 1000;
}

function sanitize(input: VialInput): VialEnc {
	const form = isContainerForm(input.form) ? input.form : 'vial';

	let vialMg: number | null;
	if (form === 'vial') {
		// The original, hard requirement: a vial-form container is defined by its powder mass.
		if (!Number.isFinite(input.vialMg) || (input.vialMg as number) <= 0 || (input.vialMg as number) > 1000) {
			throw new Error('Vial size (mg) is out of range');
		}
		vialMg = Math.round((input.vialMg as number) * 1000) / 1000;
	} else {
		// Other forms don't require a powder mass at all — vialMg/bacWaterMl are only the optional
		// self-mix path here (see containerConcentrationMgMl in $lib/utils/delivery.ts).
		vialMg = positiveOrNull(input.vialMg, 1000, 'Powder amount (mg)');
	}

	let bacWaterMl: number | null = null;
	if (input.bacWaterMl != null) {
		if (!Number.isFinite(input.bacWaterMl) || input.bacWaterMl <= 0 || input.bacWaterMl > 100) {
			throw new Error('Volume (mL) is out of range');
		}
		bacWaterMl = Math.round(input.bacWaterMl * 100) / 100;
	}

	if (input.reconstitutedAt && !isValidIsoDate(input.reconstitutedAt)) throw new Error('Invalid reconstitution date');
	if (input.expiresAt && !isValidIsoDate(input.expiresAt)) throw new Error('Invalid expiry date');

	const concentrationMgMl = positiveOrNull(input.concentrationMgMl, 1000, 'Concentration (mg/mL)');
	const percentWv = positiveOrNull(input.percentWv, 100, 'Concentration (% w/v)');
	const actuationVolumeUl = positiveOrNull(input.actuationVolumeUl, 2000, 'Actuation volume (µL)');

	let primingActuations: number | null = null;
	if (input.primingActuations != null) {
		if (!Number.isInteger(input.primingActuations) || input.primingActuations < 0 || input.primingActuations > 50) {
			throw new Error('Priming actuations is out of range');
		}
		primingActuations = input.primingActuations;
	}

	let unitCount: number | null = null;
	if (input.unitCount != null) {
		if (!Number.isInteger(input.unitCount) || input.unitCount <= 0 || input.unitCount > 1000) {
			throw new Error('Unit count is out of range');
		}
		unitCount = input.unitCount;
	}

	const unitMassMcg = positiveOrNull(input.unitMassMcg, 100_000, 'Mass per unit (mcg)');

	return {
		vialMg,
		bacWaterMl,
		reconstitutedAt: input.reconstitutedAt || null,
		expiresAt: input.expiresAt || null,
		notes: input.notes?.trim() || null,
		form,
		concentrationMgMl,
		percentWv,
		actuationVolumeUl,
		primingActuations,
		unitCount,
		unitMassMcg
	};
}

export async function listVials(
	userId: number,
	opts: { includeDepleted?: boolean; peptideId?: number } = {}
): Promise<VialWithUsage[]> {
	const conds = [eq(peptideVials.userId, userId)];
	if (opts.peptideId) conds.push(eq(peptideVials.peptideId, opts.peptideId));
	const [rows, usage] = await Promise.all([
		db
			.select()
			.from(peptideVials)
			.where(and(...conds))
			.orderBy(asc(peptideVials.depleted), asc(peptideVials.id)),
		db
			.select({ vialId: peptideDoses.vialId, n: sql<number>`count(*)`.mapWith(Number) })
			.from(peptideDoses)
			.where(eq(peptideDoses.userId, userId))
			.groupBy(peptideDoses.vialId)
	]);
	const usageMap = new Map(usage.map((u) => [u.vialId, u.n]));
	return rows
		.map((r) => ({ ...decode(r), dosesLogged: usageMap.get(r.id) ?? 0 }))
		.filter((v) => opts.includeDepleted || !v.depleted);
}

export async function getVial(userId: number, id: number): Promise<Vial | null> {
	const [row] = await db.select().from(peptideVials).where(and(eq(peptideVials.id, id), eq(peptideVials.userId, userId)));
	return row ? decode(row) : null;
}

export async function createVial(userId: number, input: VialInput): Promise<Vial> {
	const data = sanitize(input);
	const [row] = await db
		.insert(peptideVials)
		.values({ userId, peptideId: input.peptideId, enc: encryptJson(data, aad(userId)), createdAt: new Date() })
		.returning();
	return decode(row);
}

/** Edits a container in place (fix a mistyped concentration, volume, etc.) — vials previously had no
 *  update path, only create/deplete/delete. */
export async function updateVial(userId: number, id: number, input: VialInput): Promise<Vial> {
	const data = sanitize(input);
	const [row] = await db
		.update(peptideVials)
		.set({ peptideId: input.peptideId, enc: encryptJson(data, aad(userId)) })
		.where(and(eq(peptideVials.id, id), eq(peptideVials.userId, userId)))
		.returning();
	if (!row) throw new Error('Vial not found');
	return decode(row);
}

export async function setVialDepleted(userId: number, id: number, depleted: boolean): Promise<void> {
	await db.update(peptideVials).set({ depleted }).where(and(eq(peptideVials.id, id), eq(peptideVials.userId, userId)));
}

export async function deleteVial(userId: number, id: number): Promise<void> {
	await db.delete(peptideVials).where(and(eq(peptideVials.id, id), eq(peptideVials.userId, userId)));
}
