import { db } from '$lib/server/db';
import { peptidePhotos } from '$lib/server/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { isValidIsoDate } from '$lib/utils/isoDate';
import { deletePeptidePhotoFile, savePeptidePhoto } from '$lib/server/storage/peptidePhotos';

export type PeptidePhotoRow = {
	id: number;
	peptideId: number | null;
	date: string;
	mime: string;
	caption: string | null;
	createdAt: Date;
};

const listColumns = {
	id: peptidePhotos.id,
	peptideId: peptidePhotos.peptideId,
	date: peptidePhotos.date,
	mime: peptidePhotos.mime,
	caption: peptidePhotos.caption,
	createdAt: peptidePhotos.createdAt
};

/** All of the user's peptide photos, newest first. `filename` is deliberately never selected here — it
 *  only leaves the DB inside the ownership-checked serve path (getPhotoForOwner). */
export async function listPhotos(userId: number, opts: { peptideId?: number } = {}): Promise<PeptidePhotoRow[]> {
	const conds = [eq(peptidePhotos.userId, userId)];
	if (opts.peptideId) conds.push(eq(peptidePhotos.peptideId, opts.peptideId));
	const rows = await db
		.select(listColumns)
		.from(peptidePhotos)
		.where(and(...conds))
		.orderBy(desc(peptidePhotos.date), desc(peptidePhotos.id));
	return rows as PeptidePhotoRow[];
}

/** The 404-gate for the serve route: returns the on-disk filename + mime ONLY if this user owns the row. */
export async function getPhotoForOwner(userId: number, id: number): Promise<{ filename: string; mime: string } | null> {
	const [row] = await db
		.select({ filename: peptidePhotos.filename, mime: peptidePhotos.mime })
		.from(peptidePhotos)
		.where(and(eq(peptidePhotos.id, id), eq(peptidePhotos.userId, userId)));
	return row ?? null;
}

export async function savePhoto(
	userId: number,
	meta: { peptideId: number | null; date: string; caption: string | null },
	file: File
): Promise<void> {
	if (!isValidIsoDate(meta.date)) throw new Error('Invalid date');
	const caption = meta.caption ? meta.caption.trim().slice(0, 280) || null : null;

	const saved = await savePeptidePhoto(userId, file); // validates + strips metadata + encrypts
	try {
		await db.insert(peptidePhotos).values({
			userId,
			peptideId: meta.peptideId,
			date: meta.date,
			filename: saved.filename,
			mime: saved.mime,
			byteSize: saved.byteSize,
			caption,
			createdAt: new Date()
		});
	} catch (e) {
		// Don't leak an orphaned ciphertext if the row insert fails.
		await deletePeptidePhotoFile(saved.filename);
		throw e;
	}
}

export async function deletePhoto(userId: number, id: number): Promise<void> {
	const [row] = await db
		.select({ filename: peptidePhotos.filename })
		.from(peptidePhotos)
		.where(and(eq(peptidePhotos.id, id), eq(peptidePhotos.userId, userId)));
	if (!row) return;
	await db.delete(peptidePhotos).where(and(eq(peptidePhotos.id, id), eq(peptidePhotos.userId, userId)));
	await deletePeptidePhotoFile(row.filename);
}
