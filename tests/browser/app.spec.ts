import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, hkdfSync, createDecipheriv } from 'node:crypto';
import Database from 'better-sqlite3';
import sharp from 'sharp';
const base = 'http://127.0.0.1:5187';
let dir: string, server: ChildProcess, db: Database.Database, log: number;
let owner: { cookie: string; uid: number }, guest: typeof owner;
const key = randomBytes(32);
const date = '2026-10-09';
async function request(url: string, cookie = '', form?: Record<string, string> | FormData) {
	return fetch(base + url, { method: form ? 'POST' : 'GET', headers: { Origin: base, Accept: url === '/signup' || url === '/meals/new?/create' ? 'text/html' : 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: form instanceof FormData ? form : form ? new URLSearchParams(form) : undefined, redirect: 'manual' });
}
async function signup(username: string) {
	const password = randomBytes(16).toString('hex');
	const response = await request('/signup', '', { username, password, confirmPassword: password });
	expect(response.status).toBe(303);
	return { cookie: response.headers.get('set-cookie')!.split(';')[0], uid: (db.prepare('SELECT id FROM users WHERE username=?').get(username) as { id: number }).id };
}
function decoded(table: string, uid: number): any[] {
	return db.prepare(`SELECT * FROM ${table} WHERE user_id=?`).all(uid).map((row: any) => {
		const blob = Buffer.from(row.enc, 'base64'), aad = `${uid}:${table}`;
		const subkey = Buffer.from(hkdfSync('sha256', key, Buffer.from(aad), Buffer.from('peptide-field-v1'), 32));
		const cipher = createDecipheriv('aes-256-gcm', subkey, blob.subarray(0, 12));
		cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(blob.subarray(12, 28));
		return { ...row, ...JSON.parse(Buffer.concat([cipher.update(blob.subarray(28)), cipher.final()]).toString()) };
	});
}
test.beforeAll(async () => {
	dir = mkdtempSync(path.join(tmpdir(), 'fitness-browser-'));
	const env = { ...process.env, DATABASE_URL: path.join(dir, 'test.db'), PHOTO_ENCRYPTION_KEY: key.toString('hex'), ORIGIN: base, HOST: '127.0.0.1', PORT: '5187', BODY_SIZE_LIMIT: '16M' };
	execFileSync(process.execPath, ['scripts/migrate.js'], { env });
	db = new Database(env.DATABASE_URL); log = openSync(path.join(dir, 'server.log'), 'a');
	server = spawn(process.execPath, ['build'], { env, stdio: ['ignore', log, log] });
	for (let n = 0; n < 100; n++) {
		try { if ((await request('/login')).ok) break; } catch {}
		if (server.exitCode !== null) throw new Error('Test server exited; inspect ' + dir);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	owner = await signup('browser_owner'); guest = await signup('browser_guest');
	await request('/peptides', owner.cookie); await request('/peptides', guest.cookie);
});
test.afterAll(async () => {
	if (server?.exitCode === null) await new Promise<void>((resolve) => { server.once('exit', () => resolve()); server.kill('SIGTERM'); });
	db?.close(); if (log !== undefined) closeSync(log);
	if (dir) rmSync(dir, { recursive: true, force: true });
});
test.beforeEach(async ({ context }) => {
	await context.addCookies([{ name: 'session', value: owner.cookie.slice('session='.length), url: base }]);
});

test('first signup gets admin immediately and signup has no authenticated navigation', async ({ browser }) => {
	expect((db.prepare('SELECT is_admin FROM users WHERE id=?').get(owner.uid) as any).is_admin).toBe(1);
	expect((await request('/admin', owner.cookie)).status).toBe(200);
	expect((await request('/admin', guest.cookie)).status).toBe(303);
	const context = await browser.newContext(); const page = await context.newPage();
	await page.goto(base + '/signup'); await expect(page.locator('nav')).toHaveCount(0); await context.close();
});
test('quick-log refuses fractional sprays, opens Adjust and records exact units consistently', async ({ page }) => {
	const peptide = decoded('peptides', owner.uid).find((p) => p.name === 'Semax');
	await request('/peptides/manage?/saveVial', owner.cookie, { peptideId: String(peptide.id), form: 'nasal_spray', concentrationMgMl: '2', bacWaterMl: '5', actuationVolumeUl: '100' });
	await request('/peptides/manage?/saveProtocol', owner.cookie, { peptideId: String(peptide.id), doseMcg: '300', route: 'intranasal', frequency: 'daily', startDate: '2026-10-01' });
	const protocol = decoded('peptide_protocols', owner.uid).find((p) => p.peptide_id === peptide.id);
	const response = await request('/peptides?/quickLog', owner.cookie, { protocolId: String(protocol.id), clientDate: date });
	expect((await response.json()).type).toBe('failure');
	expect(decoded('peptide_doses', owner.uid)).toHaveLength(0);
	await page.goto('/peptides');
	await page.getByRole('button', { name: 'Log', exact: true }).first().click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.keyboard.press('Escape');
	await request('/peptides/manage?/saveProtocol', owner.cookie, { id: String(protocol.id), peptideId: String(peptide.id), doseMcg: '400', route: 'intranasal', frequency: 'daily', startDate: '2026-10-01' });
	expect((await (await request('/peptides?/quickLog', owner.cookie, { protocolId: String(protocol.id), clientDate: date })).json()).type).toBe('success');
	const dose = decoded('peptide_doses', owner.uid)[0];
	expect([dose.doseMcg, dose.measureCount, dose.measureUnit]).toEqual([400, 2, 'spray']);
});
test('modal traps keyboard focus and restores it after Escape', async ({ page }) => {
	await page.goto('/peptides/manage');
	const trigger = page.getByRole('button', { name: '+ Add', exact: true }).first();
	await trigger.click(); const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
	for (let n = 0; n < 35; n++) {
		expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
		await page.keyboard.press(n % 2 ? 'Shift+Tab' : 'Tab');
	}
	await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
});
test('mutable meal photo replacement is visible and access is checked on each request', async ({ page }) => {
	const mealResponse = await request('/meals/new?/create', owner.cookie, { name: 'Photo fixture', portions: '1' });
	const mealId = Number(mealResponse.headers.get('location')!.split('/').pop());
	for (const color of ['red', 'blue']) {
		const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: color } }).withMetadata().withExifMerge({ IFD0: { Artist: 'PRIVATE-METADATA' } }).png().toBuffer();
		const form = new FormData(); form.set('photo', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'fixture.png');
		expect((await (await request(`/meals/${mealId}?/uploadPhoto`, owner.cookie, form)).json()).type).toBe('success');
		await page.goto(`/meals/${mealId}`);
		const served = await page.evaluate(async (url) => { const r = await fetch(url); return { cache: r.headers.get('cache-control'), bytes: Array.from(new Uint8Array(await r.arrayBuffer())) }; }, `/meals/${mealId}/photo`);
		expect(served.cache).toContain('no-store');
		const bytes = Buffer.from(served.bytes); expect(bytes.includes(Buffer.from('PRIVATE-METADATA'))).toBe(false);
		const pixel = await sharp(bytes).raw().toBuffer(); expect(Array.from(pixel.subarray(0, 3))).toEqual(color === 'red' ? [255, 0, 0] : [0, 0, 255]);
	}
	expect((await request(`/meals/${mealId}/photo`, guest.cookie)).status).toBe(404);
});
test('sampled pages and dialogs meet contrast requirements across every theme and allow zoom', async ({ page }) => {
	for (const route of ['/', '/peptides/manage', '/body', '/workouts']) {
		await page.goto(route);
		expect(await page.locator('meta[name=viewport]').getAttribute('content')).not.toContain('maximum-scale');
		const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
		expect(results.violations, JSON.stringify(results.violations.map((v) => v.nodes.map((n) => ({ html: n.html, summary: n.failureSummary }))), null, 2)).toEqual([]);
	}
	for (const theme of ['light', 'dark', 'modern', 'retro', 'terminal', 'blossom', 'midnight', 'forest', 'ocean', 'rose', 'mono']) {
		await page.goto('/peptides/manage');
		await page.evaluate((theme) => document.documentElement.dataset.theme = theme, theme);
		await page.getByRole('button', { name: '+ Add', exact: true }).first().click();
		await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
		const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
		expect(results.violations, theme + JSON.stringify(results.violations.map((v) => v.nodes.map((n) => ({ html: n.html, summary: n.failureSummary }))), null, 2)).toEqual([]);
		await page.keyboard.press('Escape');
	}
});
