import { it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

function worker() {
	const listeners = new Map<string, (event: any) => void>();
	const stored = new Map<string, Response>();
	const key = (request: string | { url: string }) => typeof request === 'string' ? request : new URL(request.url).pathname;
	const cache = {
		addAll: vi.fn(async (paths: string[]) => { for (const path of paths) stored.set(path, new Response(path)); }),
		match: vi.fn(async (request: string | { url: string }) => stored.get(key(request))),
		put: vi.fn(async (request: { url: string }, response: Response) => { stored.set(key(request), response); })
	};
	const fetch = vi.fn(async () => new Response('fresh'));
	const source = readFileSync(new URL('../src/service-worker.ts', import.meta.url), 'utf8')
		.replace("import { build, files, version } from '$service-worker';", 'const { build, files, version } = assets;');
	const js = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
	runInNewContext(js, {
		exports: {}, URL, fetch,
		assets: { build: ['/_app/immutable/app.js', '/_app/immutable/theme.woff2'], files: ['/offline.html'], version: 'test' },
		caches: { open: async () => cache },
		self: { location: { origin: 'https://fitness.test' }, addEventListener: (type: string, handler: (event: any) => void) => listeners.set(type, handler), skipWaiting: async () => {} }
	});
	async function install() {
		let done: Promise<void>;
		listeners.get('install')!({ waitUntil: (promise: Promise<void>) => { done = promise; } });
		await done!;
	}
	async function request(path: string, mode = 'cors', method = 'GET') {
		let response: Promise<Response> | undefined;
		const writes: Promise<void>[] = [];
		listeners.get('fetch')!({
			request: { url: new URL(path, 'https://fitness.test').href, mode, method },
			respondWith: (promise: Promise<Response>) => { response = promise; },
			waitUntil: (promise: Promise<void>) => { writes.push(promise); }
		});
		const result = await response;
		await Promise.all(writes);
		return result;
	}
	return { cache, fetch, install, request };
}

it('precaches the shell without fetching unused fonts and serves cached assets without network requests', async () => {
	const w = worker();
	await w.install();
	expect(w.cache.addAll).toHaveBeenCalledWith(['/_app/immutable/app.js', '/offline.html']);
	expect(await (await w.request('/_app/immutable/app.js'))!.text()).toBe('/_app/immutable/app.js');
	expect(w.fetch).not.toHaveBeenCalled();
});
it('fetches a font once on demand and keeps it available offline', async () => {
	const w = worker();
	await w.install();
	expect(await (await w.request('/_app/immutable/theme.woff2'))!.text()).toBe('fresh');
	w.fetch.mockRejectedValue(new Error('offline'));
	expect(await (await w.request('/_app/immutable/theme.woff2'))!.text()).toBe('fresh');
	expect(w.fetch).toHaveBeenCalledTimes(1);
});
it('keeps navigation live and falls back to the offline page', async () => {
	const w = worker();
	await w.install();
	expect(await (await w.request('/body', 'navigate'))!.text()).toBe('fresh');
	expect(w.cache.put).not.toHaveBeenCalled();
	w.fetch.mockRejectedValue(new Error('offline'));
	expect(await (await w.request('/body', 'navigate'))!.text()).toBe('/offline.html');
});
it('leaves API requests, mutable and private photos, external assets and writes to the browser', async () => {
	const w = worker();
	for (const path of ['/api/catalog/search', '/meals/1/photo', '/body/photos/1/file', '/peptides/photos/1/file', 'https://other.test/_app/immutable/app.js']) {
		expect(await w.request(path)).toBeUndefined();
	}
	expect(await w.request('/body', 'navigate', 'POST')).toBeUndefined();
	expect(w.cache.match).not.toHaveBeenCalled();
	expect(w.cache.put).not.toHaveBeenCalled();
});
