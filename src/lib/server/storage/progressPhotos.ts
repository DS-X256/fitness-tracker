import { randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { mimeForExt, sniffImageExt, stripImageMetadata } from './images';
import { decryptPhoto, encryptPhoto, photoEncryptionAvailable } from '$lib/server/crypto/photoCrypto';

// Progress photos live next to the SQLite file (DATABASE_URL) so they land on the same persisted Docker
// volume in production, and in a sibling ./uploads folder during local dev — same as meal photos, but in
// their own subdirectory and encrypted at rest.
const UPLOADS_DIR = path.join(path.dirname(env.DATABASE_URL ?? '.'), 'uploads', 'progress-photos');

const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

export function progressPhotoPath(filename: string): string {
	return path.join(UPLOADS_DIR, filename);
}

export type SavedProgressPhoto = { filename: string; mime: string; byteSize: number };

/** Validates, strips metadata from, and encrypts an uploaded photo to disk. Returns the row fields to
 *  persist. The filename is fully random (no id prefix) so on-disk names reveal nothing and can't be
 *  enumerated. aad binds the ciphertext to this owner + file. */
export async function saveProgressPhoto(userId: number, file: File): Promise<SavedProgressPhoto> {
	if (!photoEncryptionAvailable()) {
		throw new Error('Photo storage is not configured on this server (missing PHOTO_ENCRYPTION_KEY)');
	}
	if (file.size > MAX_PHOTO_BYTES) throw new Error('Photo must be under 12 MB');

	const raw = Buffer.from(await file.arrayBuffer());
	const ext = sniffImageExt(raw);
	if (!ext) throw new Error('Photo must be a JPEG, PNG, or WebP image');

	const stripped = await stripImageMetadata(raw, ext);
	if (!sniffImageExt(stripped)) throw new Error('Photo could not be processed'); // strip must not corrupt it

	const filename = `${randomBytes(16).toString('hex')}.enc`;
	const blob = encryptPhoto(stripped, aad(userId, filename));

	await mkdir(UPLOADS_DIR, { recursive: true });
	await writeFile(progressPhotoPath(filename), blob);
	return { filename, mime: mimeForExt(ext), byteSize: stripped.length };
}

/** Reads and decrypts a stored photo. userId + filename must match what it was encrypted under. */
export async function readProgressPhoto(userId: number, filename: string): Promise<Buffer> {
	const blob = await readFile(progressPhotoPath(filename));
	return decryptPhoto(blob, aad(userId, filename));
}

export async function deleteProgressPhotoFile(filename: string | null | undefined): Promise<void> {
	if (!filename) return;
	try {
		await unlink(progressPhotoPath(filename));
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
	}
}

function aad(userId: number, filename: string): string {
	return `${userId}:${filename}`;
}
