// CACHE_NAME is the stable family anchor retained by the static artifact
// contract. The production build replaces the source generation and build-asset
// markers below after Svelte has emitted its final client bundle. That makes a
// cache generation change whenever the worker, shell, or compiled assets change.
const CACHE_NAME = 'projects-webmcp-v2';
const CACHE_GENERATION = 'source-dev'; // __PROJECTS_SW_CACHE_GENERATION__
const ACTIVE_CACHE_NAME = `${CACHE_NAME}-${CACHE_GENERATION}`;
const OWNED_CACHE_PREFIX = `${CACHE_NAME}-`;
const BUILD_ASSETS = Object.freeze([]); // __PROJECTS_SW_BUILD_ASSETS__

const PRECACHE = Object.freeze([
	...BUILD_ASSETS,
	'/',
	'/landing.html',
	'/webmcp-challenge',
	'/priority',
	'/work',
	'/review',
	'/next',
	'/manifest.json',
	'/data/demo-packs.json',
	'/assets/demo.css',
	'/assets/landing.css',
	'/assets/landing.js',
	'/assets/favicon.png',
	'/assets/favicon.svg',
	'/assets/icon-192.svg',
	'/assets/icon-512.svg'
]);

// These URLs are intentionally unversioned. Prefer the network while online so
// a newly deployed landing proof, manifest, or sample seed cannot be hidden by
// an older cache entry. The active cache remains the offline fallback.
const NETWORK_FIRST_PATHS = new Set([
	'/',
	'/landing.html',
	'/manifest.json',
	'/data/demo-packs.json',
	'/assets/demo.css',
	'/assets/landing.css',
	'/assets/landing.js'
]);

function isCacheable(response) {
	return response.ok && response.status === 200;
}

function isOwnedCache(key) {
	return key === CACHE_NAME || key.startsWith(OWNED_CACHE_PREFIX);
}

async function activeCache() {
	return caches.open(ACTIVE_CACHE_NAME);
}

async function fetchAndCache(request) {
	const response = await fetch(request);
	if (isCacheable(response)) {
		try {
			const cache = await activeCache();
			await cache.put(request, response.clone());
		} catch {}
	}
	return response;
}

async function cachedOrOfflineFallback(request) {
	const cache = await activeCache();
	const cached = await cache.match(request);
	if (cached) return cached;
	if (request.mode === 'navigate') {
		// Static route shells do not vary by query; the hydrated page reads the
		// current URL to select work. A fresh task link must load its own shell.
		const routeUrl = new URL(request.url);
		routeUrl.search = '';
		const routeShell = await cache.match(routeUrl.href);
		if (routeShell) return routeShell;
		const guide = await cache.match('/webmcp-challenge');
		if (guide) return guide;
	}
	return Response.error();
}

async function precacheRequiredAssets() {
	// A production generation is content-derived, so clearing it cannot disturb
	// the cache owned by the currently controlling worker. Cache.addAll is the
	// browser's batch install path and rejects the install if any request fails.
	await caches.delete(ACTIVE_CACHE_NAME);
	const cache = await activeCache();
	try {
		await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
	} catch (error) {
		await caches.delete(ACTIVE_CACHE_NAME);
		throw error;
	}
}

self.addEventListener('install', (event) => {
	event.waitUntil(precacheRequiredAssets());
});

self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		const keys = await caches.keys();
		await Promise.all(keys
			.filter((key) => isOwnedCache(key) && key !== ACTIVE_CACHE_NAME)
			.map((key) => caches.delete(key)));
		await self.clients.claim();
	})());
});

self.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', (event) => {
	const requestUrl = new URL(event.request.url);
	if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin || requestUrl.pathname === '/sw.js' || requestUrl.pathname.startsWith('/api/nebius/')) return;

	if (event.request.mode === 'navigate' || NETWORK_FIRST_PATHS.has(requestUrl.pathname)) {
		event.respondWith(fetchAndCache(event.request).catch(() => cachedOrOfflineFallback(event.request)));
		return;
	}

	event.respondWith(activeCache().then((cache) => cache.match(event.request)).then((cached) => cached || fetchAndCache(event.request)
		.catch(() => cachedOrOfflineFallback(event.request))));
});
