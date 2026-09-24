import { db } from '$lib/server/db';
import { peptides, users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { decryptJson, encryptJson, fieldEncryptionAvailable } from '$lib/server/crypto/fieldCrypto';
import { createPeptide } from '$lib/server/repositories/peptides';
import { BLEND_PRESETS, presetComponents, suggestHalfLifeHours, type PeptideCategory } from '$lib/utils/peptides';

// Starter catalog: compound NAMES + CATEGORIES (+ the published reference half-life where one exists, which
// powers the "active in body" graphs). These are identity/reference facts to speed data entry — there is
// deliberately no dose, schedule or usage guidance anywhere here. The user fills in vial size and builds
// their own protocol; every field stays editable.

export const PRESET_PEPTIDES: { name: string; category: PeptideCategory }[] = [
	{ name: 'Semaglutide', category: 'glp1' },
	{ name: 'Tirzepatide', category: 'glp1' },
	{ name: 'Retatrutide', category: 'glp1' },
	{ name: 'Liraglutide', category: 'glp1' },
	{ name: 'BPC-157', category: 'healing' },
	{ name: 'TB-500', category: 'healing' },
	{ name: 'GHK-Cu', category: 'healing' },
	{ name: 'KPV', category: 'healing' },
	{ name: 'Ipamorelin', category: 'gh_secretagogue' },
	{ name: 'CJC-1295', category: 'gh_secretagogue' },
	{ name: 'Sermorelin', category: 'gh_secretagogue' },
	{ name: 'Tesamorelin', category: 'gh_secretagogue' },
	{ name: 'PT-141', category: 'other' },
	{ name: 'AOD-9604', category: 'other' },
	{ name: 'Melanotan 1', category: 'other' },
	{ name: 'Melanotan 2', category: 'other' }
];

/** Inserts any preset compounds the user doesn't already have (matched by name, case-insensitive).
 *  No-op when encryption isn't configured (the feature is gated on that anyway). Returns how many
 *  were added, so a caller can seed lazily on first visit. Idempotent. */
export async function seedPeptidesForUser(userId: number): Promise<number> {
	if (!fieldEncryptionAvailable()) return 0;
	const aad = `${userId}:peptides`;
	const existing = await db.select({ enc: peptides.enc }).from(peptides).where(eq(peptides.userId, userId));
	const have = new Set(existing.map((r) => decryptJson<{ name: string }>(r.enc, aad).name.toLowerCase()));
	const now = new Date();
	const toInsert = PRESET_PEPTIDES.filter((p) => !have.has(p.name.toLowerCase())).map((p, i) => ({
		userId,
		enc: encryptJson(
			{
				name: p.name,
				category: p.category,
				vialMg: null,
				notes: null,
				halfLifeHours: suggestHalfLifeHours(p.name),
				halfLifeSeeded: true
			},
			aad
		),
		sortOrder: i,
		createdAt: now
	}));
	if (toInsert.length) await db.insert(peptides).values(toInsert);
	return toInsert.length;
}

/** Inserts any of the common blend presets (BLEND_PRESETS — KLOW, GLOW, CJC-1295/Ipamorelin, …) the user
 *  doesn't already have as a compound, matched by name case-insensitively, same as seedPeptidesForUser.
 *  Each is created as a real blend compound (isBlend + the preset's label-mg mix), so it shows up
 *  pre-filled in the compound picker (e.g. "Add protocol") immediately — no manual "mark as blend, pick a
 *  preset, save" round trip first. Components link to the user's existing compounds by name (creating one,
 *  e.g. Cagrilintide, when it isn't in PRESET_PEPTIDES) via createPeptide's usual linkComponents path. The
 *  mix stays fully editable afterward, same as any blend. No-op when encryption isn't configured. Returns
 *  how many were added. Idempotent. */
export async function seedBlendPresetsForUser(userId: number): Promise<number> {
	if (!fieldEncryptionAvailable()) return 0;
	const aad = `${userId}:peptides`;
	const existing = await db.select({ enc: peptides.enc }).from(peptides).where(eq(peptides.userId, userId));
	const have = new Set(existing.map((r) => decryptJson<{ name: string }>(r.enc, aad).name.toLowerCase()));
	let added = 0;
	for (const preset of BLEND_PRESETS) {
		if (have.has(preset.name.toLowerCase())) continue;
		await createPeptide(userId, {
			name: preset.name,
			category: preset.category,
			vialMg: preset.vialMg,
			isBlend: true,
			components: presetComponents(preset)
		});
		have.add(preset.name.toLowerCase());
		added++;
	}
	return added;
}

/** Fills in the standard reference half-life (STANDARD_HALF_LIVES_HOURS) on compounds that have none and
 *  have never had one offered — preset compounds used to be seeded without it, which silently hid every
 *  "active in body" graph for e.g. Retatrutide. Runs once per compound: the `halfLifeSeeded` marker is set
 *  here and on every save through the repository, so a half-life the user deliberately cleared stays
 *  cleared. Blends are skipped (their components carry the half-lives). Returns how many were filled. */
export async function backfillStandardHalfLives(userId: number): Promise<number> {
	if (!fieldEncryptionAvailable()) return 0;
	const aad = `${userId}:peptides`;
	const rows = await db
		.select({ id: peptides.id, enc: peptides.enc, isBlend: peptides.isBlend })
		.from(peptides)
		.where(eq(peptides.userId, userId));
	let filled = 0;
	for (const row of rows) {
		const enc = decryptJson<{ name: string; halfLifeHours?: number | null; halfLifeSeeded?: boolean }>(row.enc, aad);
		if (row.isBlend || enc.halfLifeSeeded || enc.halfLifeHours != null) continue;
		const standard = suggestHalfLifeHours(enc.name);
		const next = { ...enc, halfLifeHours: standard ?? null, halfLifeSeeded: true };
		await db.update(peptides).set({ enc: encryptJson(next, aad) }).where(eq(peptides.id, row.id));
		if (standard != null) filled++;
	}
	return filled;
}

/** Backfills any new preset compounds (e.g. Melanotan), the common blend presets, and standard half-lives
 *  for every existing account, not just on an empty catalog. Mirrors seedPresetsForAllUsers() in
 *  presets.ts. No-op per user when encryption isn't configured. Safe to run on every boot — all three
 *  steps are idempotent. Blends run after the plain compounds so their components link to those rows
 *  instead of creating duplicates. */
export async function seedPeptidePresetsForAllUsers(): Promise<void> {
	if (!fieldEncryptionAvailable()) return;
	const allUsers = await db.select({ id: users.id }).from(users);
	for (const user of allUsers) {
		await seedPeptidesForUser(user.id);
		await seedBlendPresetsForUser(user.id);
		await backfillStandardHalfLives(user.id);
	}
}
