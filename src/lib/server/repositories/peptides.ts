import { db } from '$lib/server/db';
import { peptides, peptideDoses } from '$lib/server/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { decryptJson, encryptJson } from '$lib/server/crypto/fieldCrypto';
import {
	blendPercentTotal,
	isPeptideCategory,
	isValidBlendTotal,
	MAX_BLEND_COMPONENTS,
	normalizeCompoundName,
	suggestHalfLifeHours,
	usesLabelMg,
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
	/** Set once the standard half-life has been offered (seeded/backfilled) or the compound was saved by the
	 *  user — tells backfillStandardHalfLives (peptidePresets.ts) never to refill a half-life the user cleared. */
	halfLifeSeeded?: boolean;
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
		components: enc.components
			? enc.components.map((c) => ({
					name: c.name,
					percent: c.percent,
					peptideId: c.peptideId ?? null,
					labelMg: c.labelMg ?? null
				}))
			: null,
		halfLifeHours: enc.halfLifeHours ?? null
	};
}

/** Validates a blend's component rows (shared by the compound itself and a protocol's per-protocol mix
 *  override). Rows can be entered as label mg (every row has one → percent is derived from them) or as
 *  percentages that must total ~100%. Link ids are passed through untouched; linkComponents() below
 *  resolves them against the user's actual compounds. */
export function sanitizeComponents(input: BlendComponent[] | null | undefined): BlendComponent[] {
	const raw = (input ?? []).map((c) => ({
		name: (c.name ?? '').trim(),
		percent: c.percent,
		peptideId: c.peptideId ?? null,
		labelMg: c.labelMg != null && Number.isFinite(c.labelMg) && c.labelMg > 0 ? c.labelMg : null
	}));
	const cleaned = raw.filter((c) => c.name !== '' || Number.isFinite(c.percent) || c.labelMg != null);
	if (cleaned.length < 2) throw new Error('A blend needs at least 2 components');
	if (cleaned.length > MAX_BLEND_COMPONENTS) throw new Error(`A blend can have at most ${MAX_BLEND_COMPONENTS} components`);
	for (const c of cleaned) {
		if (!c.name) throw new Error('Each blend component needs a name');
		if (c.name.length > 100) throw new Error('Component name is too long');
	}
	const names = new Set<string>();
	for (const c of cleaned) {
		const key = normalizeCompoundName(c.name);
		if (names.has(key)) throw new Error(`${c.name} is listed twice`);
		names.add(key);
	}
	if (usesLabelMg(cleaned)) {
		const total = cleaned.reduce((sum, c) => sum + (c.labelMg as number), 0);
		for (const c of cleaned) {
			if ((c.labelMg as number) > 1000) throw new Error(`${c.name}'s amount is out of range`);
		}
		return cleaned.map((c) => ({
			name: c.name,
			labelMg: Math.round((c.labelMg as number) * 1000) / 1000,
			percent: Math.round(((c.labelMg as number) / total) * 10000) / 100,
			peptideId: c.peptideId
		}));
	}
	const components = cleaned.map((c) => {
		if (!Number.isFinite(c.percent) || c.percent <= 0 || c.percent > 100) {
			throw new Error(`${c.name}'s share must be a percentage between 0 and 100 (or enter every row in mg)`);
		}
		return { name: c.name, percent: Math.round(c.percent * 100) / 100, peptideId: c.peptideId, labelMg: null };
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
	const components = input.isBlend ? sanitizeComponents(input.components) : null;
	let halfLifeHours: number | null = null;
	if (input.halfLifeHours != null) {
		if (!Number.isFinite(input.halfLifeHours) || input.halfLifeHours <= 0 || input.halfLifeHours > 5000) {
			throw new Error('Half-life (hours) is out of range');
		}
		halfLifeHours = Math.round(input.halfLifeHours * 100) / 100;
	}
	return { name, category, vialMg, notes, components, halfLifeHours, halfLifeSeeded: true };
}

export async function listPeptides(
	userId: number,
	opts: { includeInactive?: boolean } = {}
): Promise<PeptideWithStats[]> {
	const [rows, doseRows] = await Promise.all([
		db.select().from(peptides).where(eq(peptides.userId, userId)).orderBy(asc(peptides.sortOrder), asc(peptides.id)),
		db
			.select({ peptideId: peptideDoses.peptideId, date: peptideDoses.date, enc: peptideDoses.enc })
			.from(peptideDoses)
			.where(eq(peptideDoses.userId, userId))
	]);
	// Stats count real doses only — a priming spray, patch removal or deliberate skip isn't "a dose", and
	// telling them apart needs `kind`, which lives in the encrypted payload (volumes are small; see schema).
	const statMap = new Map<number, { doseCount: number; lastDoseDate: string | null }>();
	const doseAad = `${userId}:peptide_doses`;
	for (const r of doseRows) {
		if ((decryptJson<{ kind?: string }>(r.enc, doseAad).kind ?? 'dose') !== 'dose') continue;
		const cur = statMap.get(r.peptideId) ?? { doseCount: 0, lastDoseDate: null };
		cur.doseCount++;
		if (!cur.lastDoseDate || r.date > cur.lastDoseDate) cur.lastDoseDate = r.date;
		statMap.set(r.peptideId, cur);
	}
	return rows
		.map((r) => {
			const p = decode(r);
			const st = statMap.get(p.id);
			return { ...p, doseCount: st?.doseCount ?? 0, lastDoseDate: st?.lastDoseDate ?? null };
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

/** Resolves each blend component to one of the user's own (non-blend) compounds — by its existing link
 *  if still valid, else by normalized name — creating the compound when none exists yet (category copied
 *  from the blend, half-life prefilled from the standard table). This link is what lets a logged blend
 *  dose count as GHK-Cu/BPC-157/… intake everywhere. Rejects a component that is itself a blend (splits
 *  are one level deep) or the blend itself. */
export async function linkComponents(
	userId: number,
	blendId: number | null,
	components: BlendComponent[],
	category: PeptideCategory | null
): Promise<BlendComponent[]> {
	const all = (await db.select().from(peptides).where(eq(peptides.userId, userId))).map(decode);
	const byId = new Map(all.map((p) => [p.id, p]));
	const byName = new Map(all.map((p) => [normalizeCompoundName(p.name), p]));
	const out: BlendComponent[] = [];
	for (const c of components) {
		let target = c.peptideId != null ? byId.get(c.peptideId) : undefined;
		if (!target || normalizeCompoundName(target.name) !== normalizeCompoundName(c.name)) {
			target = byName.get(normalizeCompoundName(c.name));
		}
		if (target && blendId != null && target.id === blendId) throw new Error("A blend can't contain itself");
		if (target && target.isBlend) throw new Error(`${target.name} is itself a blend — list its components instead`);
		if (!target) {
			const data: PeptideEnc = {
				name: c.name,
				category,
				vialMg: null,
				notes: null,
				components: null,
				halfLifeHours: suggestHalfLifeHours(c.name),
				halfLifeSeeded: true
			};
			const [row] = await db
				.insert(peptides)
				.values({ userId, enc: encryptJson(data, aad(userId)), isBlend: false, createdAt: new Date() })
				.returning();
			target = decode(row);
			byId.set(target.id, target);
			byName.set(normalizeCompoundName(target.name), target);
		}
		out.push({ ...c, peptideId: target.id });
	}
	const ids = out.map((c) => c.peptideId);
	if (new Set(ids).size !== ids.length) throw new Error('Two components point at the same compound');
	return out;
}

/** Throws when `id` is listed as a component of some other blend — it can't become a blend itself then. */
async function assertNotAComponent(userId: number, id: number, name: string) {
	const rows = await db.select().from(peptides).where(and(eq(peptides.userId, userId), eq(peptides.isBlend, true)));
	const key = normalizeCompoundName(name);
	const parent = rows
		.map(decode)
		.find((b) => b.id !== id && (b.components ?? []).some((c) => c.peptideId === id || normalizeCompoundName(c.name) === key));
	if (parent) throw new Error(`${name} is a component of ${parent.name}, so it can't be a blend itself`);
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
	if (isBlend) {
		await assertNotAComponent(userId, -1, data.name);
		data.components = await linkComponents(userId, null, data.components ?? [], data.category);
	}
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
	if (isBlend) {
		await assertNotAComponent(userId, id, merged.name);
		merged.components = await linkComponents(userId, id, merged.components ?? [], merged.category);
	}
	await db
		.update(peptides)
		.set({ enc: encryptJson(merged, aad(userId)), isBlend })
		.where(and(eq(peptides.id, id), eq(peptides.userId, userId)));
}

export async function setPeptideActive(userId: number, id: number, active: boolean): Promise<void> {
	await db.update(peptides).set({ active }).where(and(eq(peptides.id, id), eq(peptides.userId, userId)));
}

/** Deletes a peptide. Its protocols/vials cascade and its doses cascade via the FKs (generated fresh,
 *  so the cascade is real here — unlike the older tables noted in CLAUDE.md's FK caveat). The UI must
 *  confirm first (deleteImpact below) — this wipes the compound's whole dose history. */
export async function deletePeptide(userId: number, id: number): Promise<void> {
	await db.delete(peptides).where(and(eq(peptides.id, id), eq(peptides.userId, userId)));
}

/** What deleting a compound would take with it, for the confirmation dialog. Blend doses that merely
 *  CONTAIN this compound aren't deleted (they belong to the blend) — they're reported separately so the
 *  dialog can say the via-blend history stays. */
export async function deleteImpact(userId: number, id: number): Promise<{ doses: number }> {
	const rows = await db
		.select({ id: peptideDoses.id })
		.from(peptideDoses)
		.where(and(eq(peptideDoses.userId, userId), eq(peptideDoses.peptideId, id)));
	return { doses: rows.length };
}

/** Map of peptideId → display name, for labeling doses/protocols without re-decrypting per row. */
export async function peptideNameMap(userId: number): Promise<Map<number, Peptide>> {
	const rows = await db.select().from(peptides).where(eq(peptides.userId, userId));
	return new Map(rows.map((r) => [r.id, decode(r)]));
}
