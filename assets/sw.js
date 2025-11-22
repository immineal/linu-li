const CACHE_NAME = 'll-toolbox-v2';

// 1. Core Assets (Always cached immediately)
const PRECACHE_URLS = [
    './css/style.css',
    './js/layout.js',
    './favicon.svg',
    '../../index.html',
    '../../impressum.html',
    '../../privacy.html'
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
    // Skip cross-origin requests (optional, but safer for some CDNs) unless you want to cache them
    // For this toolbox, we DO want to cache CDNs (cdnjs, unpkg) so tools work offline.
    
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }

            return fetch(event.request).then((networkResponse) => {
                // Check if valid response
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic' && networkResponse.type !== 'cors') {
                    return networkResponse;
                }

                // Cache the new resource (Tools, CDN libraries, etc.)
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });

                return networkResponse;
            }).catch(() => {
                // Fallback for offline (optional: return a specific offline.html)
            });
        })
    );
});