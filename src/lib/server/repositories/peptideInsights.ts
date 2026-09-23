import { db } from '$lib/server/db';
import { peptideInsights } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { decryptJson, encryptJson } from '$lib/server/crypto/fieldCrypto';

// Cached AI-generated peptide adherence summary — one row per user, overwritten on regenerate.
// Encrypted at rest like every other peptide table (see repositories/peptideDoses.ts for the pattern
// this mirrors): the summary itself names compounds and doses, so it's exactly as sensitive as the
// data it was built from.

const aad = (userId: number) => `${userId}:peptide_insights`;

/** `fingerprint` is a hash of the exact facts the summary was generated from (see ai/peptideFacts.ts),
 *  so the page can tell a summary is out of date the moment a dose is logged — rather than serving a
 *  stale one for its whole cooldown, which is how it used to "forget" doses. Absent on older rows. */
type InsightEnc = { content: string; model: string; fingerprint?: string | null };

export type PeptideInsight = {
	content: string;
	model: string;
	generatedAt: Date;
	fingerprint: string | null;
};

function decode(row: typeof peptideInsights.$inferSelect): PeptideInsight {
	const enc = decryptJson<InsightEnc>(row.enc, aad(row.userId));
	return { content: enc.content, model: enc.model, generatedAt: row.generatedAt, fingerprint: enc.fingerprint ?? null };
}

export async function getCached(userId: number): Promise<PeptideInsight | null> {
	const [row] = await db.select().from(peptideInsights).where(eq(peptideInsights.userId, userId));
	return row ? decode(row) : null;
}

export async function save(userId: number, content: string, model: string, fingerprint: string): Promise<PeptideInsight> {
	const generatedAt = new Date();
	const enc = encryptJson({ content, model, fingerprint } satisfies InsightEnc, aad(userId));
	await db
		.insert(peptideInsights)
		.values({ userId, enc, generatedAt })
		.onConflictDoUpdate({ target: peptideInsights.userId, set: { enc, generatedAt } });
	return { content, model, generatedAt, fingerprint };
}
