import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { eq, and, gt, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users, sessions } from '$lib/server/db/schema';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const SESSION_COOKIE = 'session';
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 365; // 1 year

export type SessionUser = { id: number; username: string; isAdmin: boolean };

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
	return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [scheme, saltHex, hashHex] = stored.split(':');
	if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
	const salt = Buffer.from(saltHex, 'hex');
	const expected = Buffer.from(hashHex, 'hex');
	const derived = (await scrypt(password, salt, expected.length)) as Buffer;
	return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export async function createUser(username: string, password: string) {
	const passwordHash = await hashPassword(password);
	return db.transaction((tx) => {
		const firstAccount = !tx.select({ id: users.id }).from(users).limit(1).get();
		return tx.insert(users).values({ username, passwordHash, isAdmin: firstAccount }).returning().get();
	}, { behavior: 'immediate' });
}

export async function findUserByUsername(username: string): Promise<(SessionUser & { passwordHash: string }) | null> {
	const [row] = await db
		.select()
		.from(users)
		.where(sql`lower(${users.username}) = lower(${username})`);
	return row ?? null;
}

export async function createSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
	const token = randomBytes(32).toString('hex');
	const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
	await db.insert(sessions).values({ id: token, userId, expiresAt });
	return { token, expiresAt };
}

export async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
	if (!token) return null;
	const [row] = await db
		.select({ id: users.id, username: users.username, isAdmin: users.isAdmin })
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(and(eq(sessions.id, token), gt(sessions.expiresAt, new Date())));
	return row ?? null;
}

export async function deleteSession(token: string) {
	await db.delete(sessions).where(eq(sessions.id, token));
}

export function setSessionCookie(
	cookies: { set: (name: string, value: string, opts: any) => void },
	token: string,
	expiresAt: Date,
	secure: boolean
) {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		expires: expiresAt
	});
}

export function clearSessionCookie(cookies: { delete: (name: string, opts: any) => void }) {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

export { SESSION_COOKIE };
