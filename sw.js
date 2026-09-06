// This file has to sit in the site root. A worker only ever controls pages
// under the directory it is served from, so from /assets/ it controlled
// nothing at all and the offline promise was empty.
const CACHE_NAME = 'll-toolbox-v3';

// 1. Core Assets (Always cached immediately)
// Absolute paths: the worker runs at the root, not next to these files.
const PRECACHE_URLS = [
    '/',
    '/index.html',
    '/impressum.html',
    '/privacy.html',
    '/assets/css/style.css',
    '/assets/js/layout.js',
    '/assets/favicon.svg'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Cleanup old caches
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const request = event.request;

    // Only GET responses can go in a cache, and only http(s) ones at that.
    // Extension and blob requests used to reach cache.put and throw there.
    if (request.method !== 'GET') return;
    const scheme = new URL(request.url).protocol;
    if (scheme !== 'http:' && scheme !== 'https:') return;

    const putInCache = (response) => {
        if (!response || response.status !== 200) return response;
        if (response.type !== 'basic' && response.type !== 'cors') return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
    };

    // Pages come from the network first. The site redeploys on every push,
    // and answering a page from the cache first would hand a returning
    // visitor yesterday's HTML for as long as the entry survives — the same
    // reason .htaccess tells browsers not to cache text/html at all. The
    // cache is the fallback for when the network is not there.
    const isPage = request.mode === 'navigate' ||
        (request.headers.get('accept') || '').includes('text/html');

    if (isPage) {
        event.respondWith(
            fetch(request)
                .then(putInCache)
                .catch(() => caches.match(request)
                    .then((hit) => hit || caches.match('/index.html')))
        );
        return;
    }

    // Everything else — stylesheets, scripts, the vendored libraries, the
    // fonts — is served from the cache and fetched once on a miss. Those
    // carry a year-long cache header on the server anyway.
    event.respondWith(
        caches.match(request).then((hit) => hit || fetch(request).then(putInCache).catch(() => hit))
    );
});
