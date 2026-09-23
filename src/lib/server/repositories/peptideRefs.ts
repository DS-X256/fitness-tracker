import { db } from '$lib/server/db';
import { peptides, peptideProtocols, peptideVials } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';

// Ownership checks for the cleartext FK ids a peptide write carries (peptideId / protocolId / vialId).
// Those ids arrive from form posts, and SQLite's FKs only prove the referenced row EXISTS — not that it
// belongs to the same account — so without these a crafted post could hang one user's dose off another
// user's vial. Kept separate from the per-table repos so every writer shares one definition.

export async function assertPeptideOwned(userId: number, peptideId: number): Promise<void> {
	if (!Number.isInteger(peptideId) || peptideId <= 0) throw new Error('Pick a peptide');
	const [row] = await db
		.select({ id: peptides.id })
		.from(peptides)
		.where(and(eq(peptides.id, peptideId), eq(peptides.userId, userId)));
	if (!row) throw new Error('Peptide not found');
}

/** Validates a dose's references: the compound is the user's, and any protocol/container given is the
 *  user's AND belongs to that same compound (a KLOW dose can't be drawn from a BPC-157 vial). */
export async function assertDoseRefs(
	userId: number,
	refs: { peptideId: number; protocolId?: number | null; vialId?: number | null }
): Promise<void> {
	await assertPeptideOwned(userId, refs.peptideId);
	if (refs.protocolId != null) {
		const [p] = await db
			.select({ peptideId: peptideProtocols.peptideId })
			.from(peptideProtocols)
			.where(and(eq(peptideProtocols.id, refs.protocolId), eq(peptideProtocols.userId, userId)));
		if (!p) throw new Error('Protocol not found');
		if (p.peptideId !== refs.peptideId) throw new Error("That protocol is for a different compound");
	}
	if (refs.vialId != null) {
		const [v] = await db
			.select({ peptideId: peptideVials.peptideId })
			.from(peptideVials)
			.where(and(eq(peptideVials.id, refs.vialId), eq(peptideVials.userId, userId)));
		if (!v) throw new Error('Container not found');
		if (v.peptideId !== refs.peptideId) throw new Error('That container holds a different compound');
	}
}
