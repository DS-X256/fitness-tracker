import { mkdirSync, writeFileSync } from 'node:fs';
import { readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

const uploads = path.join(path.dirname(env.DATABASE_URL ?? '.'), 'uploads');
const queue = path.join(uploads, 'account-cleanup');
type Files = Record<'meal-photos' | 'progress-photos' | 'peptide-photos', string[]>;

/** Persist before deleting rows. A rolled-back deletion must never remove an active user's files. */
export function queueAccountPhotoCleanup(userId: number, files: Files): void {
	mkdirSync(queue, { recursive: true });
	writeFileSync(path.join(queue, `${userId}.json`), JSON.stringify({ userId, files }), { mode: 0o600 });
}

/** Failed file deletions remain queued and are retried on startup and subsequent account deletion. */
export async function retryAccountPhotoCleanup(): Promise<void> {
	let manifests: string[];
	try { manifests = await readdir(queue); } catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
		throw e;
	}
	for (const manifest of manifests) {
		if (!/^\d+\.json$/.test(manifest)) continue;
		try {
			const { userId, files } = JSON.parse(await readFile(path.join(queue, manifest), 'utf8')) as { userId: number; files: Files };
			if (!Number.isSafeInteger(userId) || String(userId) + '.json' !== manifest) throw new Error('Invalid cleanup manifest');
			if (db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get()) continue;
			for (const directory of ['meal-photos', 'progress-photos', 'peptide-photos'] as const) {
				for (const filename of files[directory]) {
					if (path.basename(filename) !== filename) throw new Error('Invalid photo filename');
					try { await unlink(path.join(uploads, directory, filename)); } catch (e) {
						if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
					}
				}
			}
			await unlink(path.join(queue, manifest));
		} catch (e) {
			console.error('Account photo cleanup failed; queued for retry:', manifest, e);
		}
	}
}
