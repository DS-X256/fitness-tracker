import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes, hkdfSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { createBackup, verifyDatabase } from '../scripts/backup.js';

it('backs up uncheckpointed WAL commits and restores both encrypted photo types with the original key', async () => {
	const dir = mkdtempSync(path.join(tmpdir(), 'fitness-backup-test-'));
	const source = path.join(dir, 'source'); mkdirSync(source);
	const databaseUrl = path.join(source, 'fitness.db');
	execFileSync(process.execPath, ['scripts/migrate.js'], { env: { ...process.env, DATABASE_URL: databaseUrl } });
	const live = new Database(databaseUrl);
	live.pragma('journal_mode=WAL'); live.pragma('wal_autocheckpoint=0');
	const master = randomBytes(32);
	const aad = '1:test.enc';
	const subkey = Buffer.from(hkdfSync('sha256', master, Buffer.from(aad), Buffer.from('progress-photo-v1'), 32));
	const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', subkey, iv);
	cipher.setAAD(Buffer.from(aad));
	const ciphertext = Buffer.concat([cipher.update('private test image'), cipher.final()]);
	const encrypted = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
	try {
		live.prepare('INSERT INTO users(username,password_hash,is_admin) VALUES (?,?,1)').run('restore-test', 'fixture');
		for (const folder of ['progress-photos', 'peptide-photos']) {
			mkdirSync(path.join(source, 'uploads', folder), { recursive: true });
			writeFileSync(path.join(source, 'uploads', folder, 'test.enc'), encrypted);
			live.prepare(`INSERT INTO ${folder.replace('-', '_')}(user_id,date,filename,mime,byte_size) VALUES (1,?,?,?,?)`).run('2026-10-09', 'test.enc', 'image/png', encrypted.length);
		}
		const backup = path.join(dir, 'backup');
		await expect(createBackup(databaseUrl, backup)).rejects.toThrow('Stop app writers');
		// Connection remains open with committed WAL frames; no writes occur during the snapshot.
		await createBackup(databaseUrl, backup, { quiesced: true });
		const restore = path.join(dir, 'restored'); cpSync(backup, restore, { recursive: true });
		verifyDatabase(path.join(restore, 'fitness.db'));
		const restored = new Database(path.join(restore, 'fitness.db'));
		expect(restored.prepare('SELECT username FROM users').get()).toEqual({ username: 'restore-test' });
		for (const folder of ['progress-photos', 'peptide-photos']) {
			const blob = readFileSync(path.join(restore, 'uploads', folder, 'test.enc'));
			const decipher = createDecipheriv('aes-256-gcm', subkey, blob.subarray(0, 12));
			decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(blob.subarray(12, 28));
			expect(Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString()).toBe('private test image');
		}
		restored.close();
		await expect(createBackup(databaseUrl, backup, { quiesced: true })).rejects.toThrow();
	} finally { live.close(); rmSync(dir, { recursive: true, force: true }); }
});
