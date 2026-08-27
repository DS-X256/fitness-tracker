// Admin-only, deliberately UN-SCOPED queries — the one place in the app that reads across all users
// instead of filtering by a single userId. Everything here must only ever be reached behind the admin
// gate (requireAdmin in routes/admin/*). It never exposes another user's private *content* (e.g. a
// progress photo is only ever served by the owner-only route); it manages accounts and shows aggregates.

import { readFileSync, statSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, count, eq, isNotNull, max, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import {
	barcodeCache,
	catalogProducts,
	meals,
	products,
	progressPhotos,
	sessions,
	users,
	workoutSessions
} from '$lib/server/db/schema';
import { createUser, hashPassword } from '$lib/server/auth';
import { validatePassword, validateUsername } from '$lib/server/validation';
import { seedCatalog, seedPresetsForAllUsers, seedPresetsForUser } from '$lib/server/presets';
import { photoEncryptionAvailable } from '$lib/server/crypto/photoCrypto';
import { deleteProgressPhotoFile } from '$lib/server/storage/progressPhotos';
import { deleteMealPhotoFile } from '$lib/server/storage/mealPhotos';

/** Promotes the earliest-created account to admin if no admin exists yet. Idempotent — a no-op once
 *  any admin is present. Runs fire-and-forget on server startup (hooks.server.ts). */
export async function ensureAdminExists(): Promise<void> {
	const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.isAdmin, true)).limit(1);
	if (existing) return;
	const [first] = await db.select({ id: users.id }).from(users).orderBy(asc(users.createdAt), asc(users.id)).limit(1);
	if (first) await db.update(users).set({ isAdmin: true }).where(eq(users.id, first.id));
}

async function countAdmins(): Promise<number> {
	const [r] = await db.select({ c: count() }).from(users).where(eq(users.isAdmin, true));
	return Number(r.c);
}

// table/col are passed loosely (each table's userId column has a distinct type) — internal helper.
async function countsByUser(table: any, col: any): Promise<Map<number, number>> {
	const rows = await db.select({ uid: col, c: count() }).from(table).groupBy(col);
	const m = new Map<number, number>();
	for (const r of rows) m.set(Number(r.uid), Number(r.c));
	return m;
}

export type AdminUser = {
	id: number;
	username: string;
	isAdmin: boolean;
	createdAt: Date;
	meals: number;
	workouts: number;
	photos: number;
	lastActive: Date | null;
};

/** All accounts with per-user counts + last login. Un-scoped by design (admin-only). */
export async function listUsers(): Promise<AdminUser[]> {
	const [rows, mealC, workoutC, photoC, lastLogin] = await Promise.all([
		db.select({ id: users.id, username: users.username, isAdmin: users.isAdmin, createdAt: users.createdAt }).from(users).orderBy(asc(users.id)),
		countsByUser(meals, meals.userId),
		countsByUser(workoutSessions, workoutSessions.userId),
		countsByUser(progressPhotos, progressPhotos.userId),
		db.select({ uid: sessions.userId, last: max(sessions.createdAt) }).from(sessions).groupBy(sessions.userId)
	]);
	const lastByUser = new Map<number, Date>();
	for (const r of lastLogin) if (r.last) lastByUser.set(r.uid, r.last as Date);

	return rows.map((u) => ({
		id: u.id,
		username: u.username,
		isAdmin: u.isAdmin,
		createdAt: u.createdAt,
		meals: mealC.get(u.id) ?? 0,
		workouts: workoutC.get(u.id) ?? 0,
		photos: photoC.get(u.id) ?? 0,
		lastActive: lastByUser.get(u.id) ?? null
	}));
}

export type InstanceStats = {
	users: number;
	meals: number;
	products: number;
	workouts: number;
	sessions: number;
	photos: number;
	catalogProducts: number;
	barcodeCache: number;
	dbBytes: number;
	uploadsBytes: number;
	photoEncryption: boolean;
	appVersion: string;
};

export async function getInstanceStats(): Promise<InstanceStats> {
	const [[u], [m], [p], [w], [s], [ph], [cat], [bc]] = await Promise.all([
		db.select({ c: count() }).from(users),
		db.select({ c: count() }).from(meals),
		db.select({ c: count() }).from(products),
		db.select({ c: count() }).from(workoutSessions),
		db.select({ c: count() }).from(sessions),
		db.select({ c: count() }).from(progressPhotos),
		db.select({ c: count() }).from(catalogProducts),
		db.select({ c: count() }).from(barcodeCache)
	]);

	const dbPath = env.DATABASE_URL ?? 'local.db';
	const dbBytes = fileSize(dbPath) + fileSize(`${dbPath}-wal`) + fileSize(`${dbPath}-shm`);
	const uploadsBytes = await dirSize(path.join(path.dirname(dbPath), 'uploads'));

	return {
		users: Number(u.c),
		meals: Number(m.c),
		products: Number(p.c),
		workouts: Number(w.c),
		sessions: Number(s.c),
		photos: Number(ph.c),
		catalogProducts: Number(cat.c),
		barcodeCache: Number(bc.c),
		dbBytes,
		uploadsBytes,
		photoEncryption: photoEncryptionAvailable(),
		appVersion: readAppVersion()
	};
}

export async function createUserAsAdmin(usernameRaw: string, password: string) {
	const username = usernameRaw.trim();
	const ue = validateUsername(username);
	if (ue) throw new Error(ue);
	const pe = validatePassword(password);
	if (pe) throw new Error(pe);
	const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = lower(${username})`);
	if (existing) throw new Error('That username is already taken');
	const user = await createUser(username, password);
	await seedPresetsForUser(user.id);
	return user;
}

export async function setPassword(userId: number, newPassword: string) {
	const pe = validatePassword(newPassword);
	if (pe) throw new Error(pe);
	const passwordHash = await hashPassword(newPassword);
	await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
	// Force re-login everywhere — a reset should immediately cut off any existing sessions.
	await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function setAdmin(userId: number, value: boolean) {
	if (!value) {
		const [target] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId));
		if (target?.isAdmin && (await countAdmins()) <= 1) throw new Error('Cannot remove the last admin');
	}
	await db.update(users).set({ isAdmin: value }).where(eq(users.id, userId));
}

export async function deleteUser(actingId: number, userId: number) {
	if (userId === actingId) throw new Error("You can't delete your own account from here");
	const [target] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId));
	if (!target) return;
	if (target.isAdmin && (await countAdmins()) <= 1) throw new Error('Cannot delete the last admin');

	// Collect on-disk files before the rows are gone (deletion doesn't touch disk).
	const photos = await db.select({ filename: progressPhotos.filename }).from(progressPhotos).where(eq(progressPhotos.userId, userId));
	const mealPhotos = await db
		.select({ filename: meals.photoFilename })
		.from(meals)
		.where(and(eq(meals.userId, userId), isNotNull(meals.photoFilename)));

	// Delete all of the user's data explicitly, in child→parent order, inside one transaction. We do NOT
	// rely on ON DELETE cascade: categories/exercises/meals/workout_sessions still reference users with
	// NO ACTION in the migration-built schema (schema.ts says cascade, but the migrations never applied
	// it), so `delete users` alone throws a FOREIGN KEY constraint. Explicit deletion is correct on any
	// schema and guarantees complete removal.
	const u = userId;
	db.transaction((tx) => {
		// AI-feature caches (real ON DELETE cascade on these newly-generated tables, but deleted
		// explicitly anyway for consistency with every other user-owned table here — see the FK caveat
		// above). workout_coach_insights references workout_sessions, so it goes first.
		tx.run(sql`delete from workout_coach_insights where user_id = ${u}`);
		tx.run(sql`delete from weekly_digests where user_id = ${u}`);
		tx.run(sql`delete from peptide_insights where user_id = ${u}`);
		// leaf rows that hang off the user's exercises / sessions / plans
		tx.run(sql`delete from workout_sets where session_id in (select id from workout_sessions where user_id = ${u}) or exercise_id in (select id from exercises where user_id = ${u})`);
		tx.run(sql`delete from exercise_goals where exercise_id in (select id from exercises where user_id = ${u})`);
		tx.run(sql`delete from plan_exercises where plan_id in (select id from workout_plans where user_id = ${u}) or exercise_id in (select id from exercises where user_id = ${u})`);
		// training-together links: this user's own membership rows, plus every member of any group they started
		tx.run(sql`delete from workout_group_members where user_id = ${u} or group_id in (select id from workout_groups where created_by = ${u})`);
		tx.run(sql`delete from workout_groups where created_by = ${u}`);
		// leaf rows that hang off the user's meals / products / items / categories
		tx.run(sql`delete from shopping_list_item_sources where item_id in (select id from shopping_list_items where user_id = ${u}) or meal_id in (select id from meals where user_id = ${u})`);
		tx.run(sql`delete from meal_ingredients where meal_id in (select id from meals where user_id = ${u}) or product_id in (select id from products where user_id = ${u}) or sub_meal_id in (select id from meals where user_id = ${u})`);
		tx.run(sql`delete from meal_categories where meal_id in (select id from meals where user_id = ${u}) or category_id in (select id from categories where user_id = ${u})`);
		// the user's own top-level rows
		tx.run(sql`delete from workout_sessions where user_id = ${u}`);
		tx.run(sql`delete from workout_plans where user_id = ${u}`);
		tx.run(sql`delete from exercises where user_id = ${u}`);
		tx.run(sql`delete from shopping_list_items where user_id = ${u}`);
		tx.run(sql`delete from shopping_list_shares where owner_id = ${u} or shared_with_user_id = ${u}`);
		tx.run(sql`delete from meal_shares where owner_id = ${u} or shared_with_user_id = ${u}`);
		tx.run(sql`delete from meals where user_id = ${u}`);
		tx.run(sql`delete from categories where user_id = ${u}`);
		tx.run(sql`delete from products where user_id = ${u}`);
		tx.run(sql`delete from meal_logs where user_id = ${u}`);
		tx.run(sql`delete from nutrition_targets where user_id = ${u}`);
		tx.run(sql`delete from user_settings where user_id = ${u}`);
		tx.run(sql`delete from body_metrics where user_id = ${u}`);
		tx.run(sql`delete from weight_goals where user_id = ${u}`);
		tx.run(sql`delete from progress_photos where user_id = ${u}`);
		// peptides: doses reference protocols/vials/peptides, so delete child→parent.
		tx.run(sql`delete from peptide_doses where user_id = ${u}`);
		tx.run(sql`delete from peptide_protocols where user_id = ${u}`);
		tx.run(sql`delete from peptide_vials where user_id = ${u}`);
		tx.run(sql`delete from peptides where user_id = ${u}`);
		tx.run(sql`delete from sessions where user_id = ${u}`);
		tx.run(sql`delete from users where id = ${u}`);
	});

	for (const p of photos) await deleteProgressPhotoFile(p.filename);
	for (const mp of mealPhotos) await deleteMealPhotoFile(mp.filename);
}

export async function reseedCatalog() {
	await seedCatalog();
}

export async function reseedPresets() {
	await seedPresetsForAllUsers();
}

/** Empties the Open Food Facts barcode-lookup cache; returns how many rows were cleared. */
export async function clearBarcodeCache(): Promise<number> {
	const [before] = await db.select({ c: count() }).from(barcodeCache);
	await db.delete(barcodeCache);
	return Number(before.c);
}

// --- helpers ----------------------------------------------------------------
function fileSize(p: string): number {
	try {
		return statSync(p).size;
	} catch {
		return 0;
	}
}

async function dirSize(dir: string): Promise<number> {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return 0;
	}
	let total = 0;
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) total += await dirSize(full);
		else {
			try {
				total += (await stat(full)).size;
			} catch {
				// ignore files that vanish mid-walk
			}
		}
	}
	return total;
}

function readAppVersion(): string {
	try {
		return JSON.parse(readFileSync('package.json', 'utf8')).version ?? 'unknown';
	} catch {
		return 'unknown';
	}
}
