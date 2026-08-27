import { db } from '$lib/server/db';
import { peptideInsights } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { decryptJson, encryptJson } from '$lib/server/crypto/fieldCrypto';

// Cached AI-generated peptide adherence summary — one row per user, overwritten on regenerate.
// Encrypted at rest like every other peptide table (see repositories/peptideDoses.ts for the pattern
// this mirrors): the summary itself names compounds and doses, so it's exactly as sensitive as the
// data it was built from.

const aad = (userId: number) => `${userId}:peptide_insights`;

type InsightEnc = { content: string; model: string };

export type PeptideInsight = {
	content: string;
	model: string;
	generatedAt: Date;
};

function decode(row: typeof peptideInsights.$inferSelect): PeptideInsight {
	const enc = decryptJson<InsightEnc>(row.enc, aad(row.userId));
	return { content: enc.content, model: enc.model, generatedAt: row.generatedAt };
}

export async function getCached(userId: number): Promise<PeptideInsight | null> {
	const [row] = await db.select().from(peptideInsights).where(eq(peptideInsights.userId, userId));
	return row ? decode(row) : null;
}

export async function save(userId: number, content: string, model: string): Promise<PeptideInsight> {
	const generatedAt = new Date();
	const enc = encryptJson({ content, model } satisfies InsightEnc, aad(userId));
	await db
		.insert(peptideInsights)
		.values({ userId, enc, generatedAt })
		.onConflictDoUpdate({ target: peptideInsights.userId, set: { enc, generatedAt } });
	return { content, model, generatedAt };
}
