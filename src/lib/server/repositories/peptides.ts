import { db } from '$lib/server/db';
import { peptides, peptideDoses } from '$lib/server/db/schema';
import { and, asc, eq, sql } from 'drizzle-orm';
import { decryptJson, encryptJson } from '$lib/server/crypto/fieldCrypto';
import {
	blendPercentTotal,
	isPeptideCategory,
	isValidBlendTotal,
	MAX_BLEND_COMPONENTS,
	type BlendComponent,
	type PeptideCategory
} from '$lib/utils/peptides';

// The compound catalog. Sensitive fields (name, category, vial size, notes) live encrypted in `enc`;
// only lifecycle flags are cleartext. Name-uniqueness is enforced here in TypeScript because the plaintext
// name never reaches a column a UNIQUE index could cover.

const aad = (userId: number) => `${userId}:peptides`;

/** Decrypted payload stored in peptides.enc. */
type PeptideEnc = {
	name: string;
	category: PeptideCategory | null;
	vialMg: number | null;
	notes: string | null;
	components: BlendComponent[] | null;
	/** Reference elimination half-life in hours, for the "active in body" estimate (see activeAmountMcg
	 *  in $lib/utils/peptides). Display-only reference metadata, same as vialMg — never used to compute
	 *  a dose, only to decay logged ones. Seeded from STANDARD_HALF_LIVES_HOURS, always user-editable. */
	halfLifeHours: number | null;
};

export type Peptide = {
	id: number;
	active: boolean;
	isBlend: boolean;
	sortOrder: number;
	createdAt: Date;
} & PeptideEnc;

export type PeptideWithStats = Peptide & { doseCount: number; lastDoseDate: string | null };

export type PeptideInput = {
	name?: string;
	category?: PeptideCategory | null;
	vialMg?: number | null;
	notes?: string | null;
	isBlend?: boolean;
	components?: BlendComponent[] | null;
	halfLifeHours?: number | null;
};

function decode(row: typeof peptides.$inferSelect): Peptide {
	const enc = decryptJson<PeptideEnc>(row.enc, aad(row.userId));
	return {
		id: row.id,
		active: row.active,
		isBlend: row.isBlend,
		sortOrder: row.sortOrder,
		createdAt: row.createdAt,
		name: enc.name,
		category: enc.category ?? null,
		vialMg: enc.vialMg ?? null,
		notes: enc.notes ?? null,
		components: enc.components ?? null,
		halfLifeHours: enc.halfLifeHours ?? null
	};
}

function sanitizeComponents(isBlend: boolean, input: BlendComponent[] | null | undefined): BlendComponent[] | null {
	if (!isBlend) return null;
	const raw = (input ?? []).map((c) => ({ name: (c.name ?? '').trim(), percent: c.percent }));
	const cleaned = raw.filter((c) => c.name !== '' || Number.isFinite(c.percent));
	if (cleaned.length < 2) throw new Error('A blend needs at least 2 components');
	if (cleaned.length > MAX_BLEND_COMPONENTS) throw new Error(`A blend can have at most ${MAX_BLEND_COMPONENTS} components`);
	const components = cleaned.map((c) => {
		if (!c.name) throw new Error('Each blend component needs a name');
		if (c.name.length > 100) throw new Error('Component name is too long');
		if (!Number.isFinite(c.percent) || c.percent <= 0 || c.percent > 100) {
			throw new Error(`${c.name}'s share must be a percentage between 0 and 100`);
		}
		return { name: c.name, percent: Math.round(c.percent * 100) / 100 };
	});
	if (!isValidBlendTotal(components)) {
		throw new Error(`Component percentages should add up to 100% (currently ${blendPercentTotal(components)}%)`);
	}
	return components;
}

function sanitize(input: Required<Pick<PeptideInput, 'name' | 'category' | 'vialMg' | 'notes'>> & PeptideInput): PeptideEnc {
	const name = (input.name ?? '').trim();
	if (!name) throw new Error('Peptide name is required');
	if (name.length > 100) throw new Error('Name is too long');
	const category = isPeptideCategory(input.category) ? input.category : null;
	let vialMg: number | null = null;
	if (input.vialMg != null) {
		if (!Number.isFinite(input.vialMg) || input.vialMg <= 0 || input.vialMg > 1000) {
			throw new Error('Vial size (mg) is out of range');
		}
		vialMg = Math.round(input.vialMg * 1000) / 1000;
	}
	const notes = input.notes?.trim() || null;
	const components = sanitizeComponents(input.isBlend ?? false, input.components);
	let halfLifeHours: number | null = null;
	if (input.halfLifeHours != null) {
		if (!Number.isFinite(input.halfLifeHours) || input.halfLifeHours <= 0 || input.halfLifeHours > 5000) {
			throw new Error('Half-life (hours) is out of range');
		}
		halfLifeHours = Math.round(input.halfLifeHours * 100) / 100;
	}
	return { name, category, vialMg, notes, components, halfLifeHours };
}

export async function listPeptides(
	userId: number,
	opts: { includeInactive?: boolean } = {}
): Promise<PeptideWithStats[]> {
	const [rows, stats] = await Promise.all([
		db.select().from(peptides).where(eq(peptides.userId, userId)).orderBy(asc(peptides.sortOrder), asc(peptides.id)),
		db
			.select({
				peptideId: peptideDoses.peptideId,
				doseCount: sql<number>`count(*)`.mapWith(Number),
				lastDoseDate: sql<string | null>`max(${peptideDoses.date})`
			})
			.from(peptideDoses)
			.where(eq(peptideDoses.userId, userId))
			.groupBy(peptideDoses.peptideId)
	]);
	const statMap = new Map(stats.map((s) => [s.peptideId, s]));
	return rows
		.map((r) => {
			const p = decode(r);
			const s = statMap.get(p.id);
			return { ...p, doseCount: s?.doseCount ?? 0, lastDoseDate: s?.lastDoseDate ?? null };
		})
		.filter((p) => opts.includeInactive || p.active);
}

export async function getPeptide(userId: number, id: number): Promise<Peptide | null> {
	const [row] = await db.select().from(peptides).where(and(eq(peptides.id, id), eq(peptides.userId, userId)));
	return row ? decode(row) : null;
}

/** Throws if a peptide with the same name (case-insensitive) already exists, ignoring `exceptId`. */
async function assertNameFree(userId: number, name: string, exceptId?: number) {
	const rows = await db.select().from(peptides).where(eq(peptides.userId, userId));
	const clash = rows.some((r) => r.id !== exceptId && decode(r).name.toLowerCase() === name.toLowerCase());
	if (clash) throw new Error('You already have a peptide with that name');
}

export async function createPeptide(userId: number, input: PeptideInput): Promise<Peptide> {
	const isBlend = input.isBlend ?? false;
	const data = sanitize({
		name: input.name ?? '',
		category: input.category ?? null,
		vialMg: input.vialMg ?? null,
		notes: input.notes ?? null,
		isBlend,
		components: input.components ?? null,
		halfLifeHours: input.halfLifeHours ?? null
	});
	await assertNameFree(userId, data.name);
	const [row] = await db
		.insert(peptides)
		.values({ userId, enc: encryptJson(data, aad(userId)), isBlend, createdAt: new Date() })
		.returning();
	return decode(row);
}

export async function updatePeptide(userId: number, id: number, input: PeptideInput): Promise<void> {
	const current = await getPeptide(userId, id);
	if (!current) throw new Error('Peptide not found');
	const isBlend = input.isBlend === undefined ? current.isBlend : input.isBlend;
	const merged = sanitize({
		name: input.name ?? current.name,
		category: input.category === undefined ? current.category : input.category,
		vialMg: input.vialMg === undefined ? current.vialMg : input.vialMg,
		notes: input.notes === undefined ? current.notes : input.notes,
		isBlend,
		components: input.components === undefined ? current.components : input.components,
		halfLifeHours: input.halfLifeHours === undefined ? current.halfLifeHours : input.halfLifeHours
	});
	await assertNameFree(userId, merged.name, id);
	await db
		.update(peptides)
		.set({ enc: encryptJson(merged, aad(userId)), isBlend })
		.where(and(eq(peptides.id, id), eq(peptides.userId, userId)));
}

export async function setPeptideActive(userId: number, id: number, active: boolean): Promise<void> {
	await db.update(peptides).set({ active }).where(and(eq(peptides.id, id), eq(peptides.userId, userId)));
}

/** Deletes a peptide. Its protocols/vials cascade and its doses cascade via the FKs (generated fresh,
 *  so the cascade is real here — unlike the older tables noted in CLAUDE.md's FK caveat). */
export async function deletePeptide(userId: number, id: number): Promise<void> {
	await db.delete(peptides).where(and(eq(peptides.id, id), eq(peptides.userId, userId)));
}

/** Map of peptideId → display name, for labeling doses/protocols without re-decrypting per row. */
export async function peptideNameMap(userId: number): Promise<Map<number, Peptide>> {
	const rows = await db.select().from(peptides).where(eq(peptides.userId, userId));
	return new Map(rows.map((r) => [r.id, decode(r)]));
}
