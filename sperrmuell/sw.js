/**
 * Minimal offline support: cache the app shell and ETL data so the map and
 * the currently loaded dates keep working without a network connection.
 * Same-origin requests (HTML/JS/CSS/data) use stale-while-revalidate so the
 * app responds instantly from cache while refreshing in the background.
 * OSM basemap tiles use network-first with a cache fallback.
 */

const CACHE_NAME = "sperrmuell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(event.request);
  const networkPromise = fetch(event.request)
    .then((response) => {
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    })
    .catch(() => undefined);
  event.waitUntil(networkPromise);
  return cached ?? (await networkPromise) ?? Response.error();
}

async function networkFirst(event) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(event.request);
    if (response.ok) event.waitUntil(cache.put(event.request, response.clone()));
    return response;
  } catch {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    throw new Error("offline and tile not cached");
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(event));
    return;
  }

  if (url.hostname.endsWith("tile.openstreetmap.org")) {
    event.respondWith(networkFirst(event));
  }
});
