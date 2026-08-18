import { db } from '$lib/server/db';
import { peptides } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { decryptJson, encryptJson, fieldEncryptionAvailable } from '$lib/server/crypto/fieldCrypto';
import type { PeptideCategory } from '$lib/utils/peptides';

// Starter catalog: compound NAMES + CATEGORIES only. These are identity facts to speed data entry —
// there is deliberately no dose, schedule or usage guidance anywhere here. The user fills in vial size
// and builds their own protocol.

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
		enc: encryptJson({ name: p.name, category: p.category, vialMg: null, notes: null }, aad),
		sortOrder: i,
		createdAt: now
	}));
	if (toInsert.length) await db.insert(peptides).values(toInsert);
	return toInsert.length;
}
