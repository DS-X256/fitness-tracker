import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { sniffImageExt, stripImageMetadata } from './images';

// Photos live next to the SQLite file itself (DATABASE_URL) so they land on the same persisted
// Docker volume in production without any extra configuration, and in a sibling ./uploads folder
// during local dev.
const UPLOADS_DIR = path.join(path.dirname(env.DATABASE_URL ?? '.'), 'uploads', 'meal-photos');

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export function mealPhotoPath(filename: string): string {
	return path.join(UPLOADS_DIR, filename);
}

/** Validates and writes an uploaded photo to disk, returning the filename to store on the meal row. */
export async function saveMealPhoto(mealId: number, file: File): Promise<string> {
	if (file.size > MAX_PHOTO_BYTES) throw new Error('Photo must be under 8 MB');

	const buffer = Buffer.from(await file.arrayBuffer());
	const ext = sniffImageExt(buffer);
	if (!ext) throw new Error('Photo must be a JPEG, PNG, or WebP image');

	await mkdir(UPLOADS_DIR, { recursive: true });
	const filename = `${mealId}-${randomBytes(8).toString('hex')}.${ext}`;
	await writeFile(mealPhotoPath(filename), await stripImageMetadata(buffer, ext));
	return filename;
}

export async function deleteMealPhotoFile(filename: string | null | undefined): Promise<void> {
	if (!filename) return;
	try {
		await unlink(mealPhotoPath(filename));
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
	}
}
