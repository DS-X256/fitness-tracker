import { randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { mimeForExt, sniffImageExt, stripImageMetadata } from './images';
import { decryptPhoto, encryptPhoto, photoEncryptionAvailable } from '$lib/server/crypto/photoCrypto';

// Peptide progress photos — same encrypted-at-rest story as body progress photos (see
// $lib/server/storage/progressPhotos, which this file otherwise duplicates verbatim): own subdirectory,
// own random on-disk filenames, same PHOTO_ENCRYPTION_KEY.
const UPLOADS_DIR = path.join(path.dirname(env.DATABASE_URL ?? '.'), 'uploads', 'peptide-photos');

const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

export function peptidePhotoPath(filename: string): string {
	return path.join(UPLOADS_DIR, filename);
}

export type SavedPeptidePhoto = { filename: string; mime: string; byteSize: number };

/** Validates, strips metadata from, and encrypts an uploaded photo to disk. Returns the row fields to
 *  persist. The filename is fully random (no id prefix) so on-disk names reveal nothing and can't be
 *  enumerated. aad binds the ciphertext to this owner + file. */
export async function savePeptidePhoto(userId: number, file: File): Promise<SavedPeptidePhoto> {
	if (!photoEncryptionAvailable()) {
		throw new Error('Photo storage is not configured on this server (missing PHOTO_ENCRYPTION_KEY)');
	}
	if (file.size > MAX_PHOTO_BYTES) throw new Error('Photo must be under 12 MB');

	const raw = Buffer.from(await file.arrayBuffer());
	const ext = sniffImageExt(raw);
	if (!ext) throw new Error('Photo must be a JPEG, PNG, or WebP image');

	const stripped = stripImageMetadata(raw, ext);
	if (!sniffImageExt(stripped)) throw new Error('Photo could not be processed'); // strip must not corrupt it

	const filename = `${randomBytes(16).toString('hex')}.enc`;
	const blob = encryptPhoto(stripped, aad(userId, filename));

	await mkdir(UPLOADS_DIR, { recursive: true });
	await writeFile(peptidePhotoPath(filename), blob);
	return { filename, mime: mimeForExt(ext), byteSize: stripped.length };
}

/** Reads and decrypts a stored photo. userId + filename must match what it was encrypted under. */
export async function readPeptidePhoto(userId: number, filename: string): Promise<Buffer> {
	const blob = await readFile(peptidePhotoPath(filename));
	return decryptPhoto(blob, aad(userId, filename));
}

export async function deletePeptidePhotoFile(filename: string | null | undefined): Promise<void> {
	if (!filename) return;
	try {
		await unlink(peptidePhotoPath(filename));
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
	}
}

function aad(userId: number, filename: string): string {
	return `${userId}:${filename}`;
}
