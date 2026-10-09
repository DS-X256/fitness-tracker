// Stop all app writers first: SQLite backup is WAL-aware, but DB and files need one quiesced boundary.
import Database from 'better-sqlite3';
import { cp, mkdir, access, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @param {string} filename */
export function verifyDatabase(filename) {
	const db = new Database(filename, { readonly: true, fileMustExist: true });
	try {
		const foreignKeys = /** @type {unknown[]} */ (db.pragma('foreign_key_check'));
		if (db.pragma('integrity_check', { simple: true }) !== 'ok' || foreignKeys.length) {
			throw new Error('Backup database integrity check failed');
		}
	} finally { db.close(); }
}

/** @param {string | undefined} databaseUrl @param {string} destination */
export async function createBackup(databaseUrl, destination, { quiesced = false } = {}) {
	if (!quiesced) throw new Error('Stop app writers first and pass --quiesced to confirm DB and uploads are idle');
	if (!databaseUrl) throw new Error('DATABASE_URL is not set');
	const source = path.resolve(databaseUrl);
	const target = path.resolve(destination);
	const uploads = path.join(path.dirname(source), 'uploads');
	if (target === path.dirname(source) || target === uploads || target.startsWith(uploads + path.sep)) {
		throw new Error('Backup destination must be separate from the database and uploads');
	}
	await access(source);
	await mkdir(target, { mode: 0o700 }); // refuse an existing destination
	let db;
	try {
		db = new Database(source, { readonly: true, fileMustExist: true });
		await db.backup(path.join(target, 'fitness.db'));
		db.close(); db = undefined;
		let hasUploads = true;
		try { await stat(uploads); } catch (e) {
			if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'ENOENT') throw e;
			hasUploads = false;
		}
		if (hasUploads) await cp(uploads, path.join(target, 'uploads'), { recursive: true });
		verifyDatabase(path.join(target, 'fitness.db'));
		await writeFile(path.join(target, 'backup.json'), JSON.stringify({ version: 1, createdAt: new Date().toISOString(), encryptionKey: 'Store the original PHOTO_ENCRYPTION_KEY separately in secure storage; never generate a replacement for a restore.' }, null, 2), { mode: 0o600 });
	} catch (e) {
		db?.close();
		await rm(target, { recursive: true, force: true });
		throw e;
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const destination = args.find((arg) => !arg.startsWith('--'));
	try {
		if (!destination) throw new Error('Usage: node scripts/backup.js --quiesced <new-backup-directory>');
		await createBackup(process.env.DATABASE_URL, destination, { quiesced: args.includes('--quiesced') });
		console.log('Verified database and uploads backup created. Keep the original encryption key in secure storage.');
	} catch (e) { console.error(e instanceof Error ? e.message : 'Backup failed'); process.exitCode = 1; }
}
