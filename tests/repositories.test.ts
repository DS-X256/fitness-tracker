import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import sharp from 'sharp';
const dir = mkdtempSync(path.join(tmpdir(), 'fitness-repo-test-'));
process.env.DATABASE_URL = path.join(dir, 'test.db');
process.env.PHOTO_ENCRYPTION_KEY = randomBytes(32).toString('hex');
let sqlite: Database.Database;
let owner: number, guest: number, peptideId: number;
let auth: typeof import('../src/lib/server/auth');
let photos: typeof import('../src/lib/server/repositories/peptidePhotos');
let workouts: typeof import('../src/lib/server/repositories/workouts');
let admin: typeof import('../src/lib/server/repositories/admin');
let file: File;
beforeAll(async () => {
	execFileSync(process.execPath, ['scripts/migrate.js'], { env: process.env });
	// Migrations are idempotent, and repositories must work against the actual migration schema.
	execFileSync(process.execPath, ['scripts/migrate.js'], { env: process.env });
	sqlite = new Database(process.env.DATABASE_URL!);
	sqlite.pragma('foreign_keys=ON');
	auth = await import('../src/lib/server/auth');
	photos = await import('../src/lib/server/repositories/peptidePhotos');
	workouts = await import('../src/lib/server/repositories/workouts');
	admin = await import('../src/lib/server/repositories/admin');
	const users = await Promise.all([auth.createUser('first', 'test-password'), auth.createUser('second', 'test-password')]);
	owner = users.find((u) => u.isAdmin)!.id;
	guest = users.find((u) => !u.isAdmin)!.id;
	const peptides = await import('../src/lib/server/repositories/peptides');
	peptideId = (await peptides.createPeptide(owner, { name: 'Test compound' })).id;
	const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
	file = new File([new Uint8Array(png)], 'test.png', { type: 'image/png' });
});
afterAll(async () => {
	sqlite?.close();
	const { db } = await import('../src/lib/server/db');
	db.$client.close();
	rmSync(dir, { recursive: true, force: true });
});
it('makes exactly one concurrent first signup admin immediately', () => {
	expect(sqlite.prepare('SELECT count(*) AS n FROM users WHERE is_admin=1').get()).toEqual({ n: 1 });
});
it('checks compound ownership before photo creation and update', async () => {
	await expect(photos.savePhoto(guest, { peptideId, date: '2026-10-09', caption: null }, file)).rejects.toThrow('not found');
	expect(sqlite.prepare('SELECT count(*) AS n FROM peptide_photos').get()).toEqual({ n: 0 });
	await photos.savePhoto(guest, { peptideId: null, date: '2026-10-09', caption: null }, file);
	const row = sqlite.prepare('SELECT id FROM peptide_photos WHERE user_id=?').get(guest) as { id: number };
	await expect(photos.updatePhoto(guest, row.id, { peptideId, date: '2026-10-09', caption: null })).rejects.toThrow('not found');
	expect(await photos.getPhotoForOwner(owner, row.id)).toBeNull();
});
it('invalid workout writes leave data unchanged and preserve tenant boundaries', async () => {
	await expect(workouts.createSession(owner, '2026-02-30')).rejects.toThrow('Invalid date');
	const session = await workouts.createSession(owner, '2026-10-09');
	const exercise = sqlite.prepare('INSERT INTO exercises(user_id,name) VALUES (?,?) RETURNING id').get(owner, 'Bodyweight') as { id: number };
	await expect(workouts.addSet(owner, session.id, exercise.id, { reps: -5, weight: -20 })).rejects.toThrow();
	await expect(workouts.addSet(guest, session.id, exercise.id, { reps: 5, weight: 0 })).rejects.toThrow();
	const set = await workouts.addSet(owner, session.id, exercise.id, { reps: 5, weight: 0 });
	await expect(workouts.updateSet(owner, set.id, { reps: 5, weight: 0, rpe: NaN })).rejects.toThrow();
	await expect(workouts.updateSession(owner, session.id, 'not-a-date')).rejects.toThrow();
	expect(sqlite.prepare('SELECT reps,weight,rpe FROM workout_sets WHERE id=?').get(set.id)).toEqual({ reps: 5, weight: 0, rpe: null });
});
it('AI summaries exclude future administrations and side-effect check-ins', async () => {
	const { createProtocol } = await import('../src/lib/server/repositories/peptideProtocols');
	const { logDose } = await import('../src/lib/server/repositories/peptideDoses');
	const protocol = await createProtocol(owner, { peptideId, doseMcg: 100, frequency: 'daily', startDate: '2026-10-01' });
	await logDose(owner, { peptideId, protocolId: protocol.id, doseMcg: 100, date: '2026-10-10', kind: 'dose', effects: [{ tag: 'nausea', severity: 1 }] });
	const { loadPeptideContext } = await import('../src/lib/server/peptideContext');
	const { buildPeptideFacts } = await import('../src/lib/server/ai/peptideFacts');
	const facts = buildPeptideFacts(await loadPeptideContext(owner, '2026-10-09'));
	expect(facts.intake).toEqual([]);
	expect(facts.sideEffects).toEqual([]);
	expect(facts.protocols[0].loggedInWindow).toEqual([]);
});
it('account deletion cleans every photo type; failed cleanup is durable and retryable', async () => {
	const peptide = sqlite.prepare('SELECT filename FROM peptide_photos WHERE user_id=?').get(guest) as { filename: string };
	for (const folder of ['meal-photos', 'progress-photos']) mkdirSync(path.join(dir, 'uploads', folder), { recursive: true });
	writeFileSync(path.join(dir, 'uploads/meal-photos/test.png'), 'fixture');
	// A directory where a file should be forces an unlink error without relying on Unix permissions.
	mkdirSync(path.join(dir, 'uploads/progress-photos/test.enc'));
	sqlite.prepare('INSERT INTO meals(user_id,name,photo_filename) VALUES (?,?,?)').run(guest, 'Fixture', 'test.png');
	sqlite.prepare('INSERT INTO progress_photos(user_id,date,filename,mime,byte_size) VALUES (?,?,?,?,?)').run(guest, '2026-10-09', 'test.enc', 'image/png', 1);
	const log = vi.spyOn(console, 'error').mockImplementation(() => {});
	await admin.deleteUser(owner, guest);
	expect(log).toHaveBeenCalled(); log.mockRestore();
	expect(sqlite.prepare('SELECT id FROM users WHERE id=?').get(guest)).toBeUndefined();
	expect(existsSync(path.join(dir, 'uploads/account-cleanup', `${guest}.json`))).toBe(true);
	rmSync(path.join(dir, 'uploads/progress-photos/test.enc'), { recursive: true });
	const { retryAccountPhotoCleanup } = await import('../src/lib/server/storage/accountCleanup');
	await retryAccountPhotoCleanup();
	for (const filename of ['meal-photos/test.png', `peptide-photos/${peptide.filename}`, `account-cleanup/${guest}.json`]) expect(existsSync(path.join(dir, 'uploads', filename))).toBe(false);
	expect(sqlite.pragma('foreign_key_check')).toEqual([]);
});
it('prevents removal of the last admin', async () => {
	await expect(admin.setAdmin(owner, false)).rejects.toThrow('last admin');
});
