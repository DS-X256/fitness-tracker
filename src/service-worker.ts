/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

declare const self: ServiceWorkerGlobalScope;

const CACHE = `app-shell-${version}`;
// Keep the shell available offline. Fonts are cached on demand, so installing the PWA
// doesn't download every weight, alphabet and unused theme font.
const ASSETS = new Set([...build, ...files]);
const PRECACHE = [...ASSETS].filter((path) => !/\.woff2?$/.test(path));

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
			.then(() => self.clients.claim())
	);
});

// Versioned shell assets can be served immediately from this build's cache. Live pages
// stay network-first; API responses and private photos never enter the asset cache.
self.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;
	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin) return;
	const isAsset = ASSETS.has(url.pathname);
	if (!isAsset && event.request.mode !== 'navigate') return;

	event.respondWith(
		(async () => {
			if (isAsset) {
				const cache = await caches.open(CACHE);
				const cached = await cache.match(event.request);
				if (cached) return cached;
				const response = await fetch(event.request);
				if (response.ok) event.waitUntil(cache.put(event.request, response.clone()));
				return response;
			}

			try {
				return await fetch(event.request);
			} catch {
				const cache = await caches.open(CACHE);
				const offline = await cache.match('/offline.html');
				if (offline) return offline;
				throw new Error('offline and not cached');
			}
		})()
	);
});
