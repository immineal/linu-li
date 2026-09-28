/**
 * Offline support for the map. The page, its scripts and the collection
 * data come out of the cache first and are refreshed from the network
 * behind that, so the map opens on a phone with no signal and shows the
 * dates it loaded last. OSM tiles go the other way: network first, and the
 * cache only when there is no connection.
 */

const CACHE_NAME = "sperrmuell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // Only this app's own caches. linu.li serves a second worker from the
      // site root (/sw.js) with its own cache, on this same origin, and this
      // line used to delete it, so opening the map wiped whatever the
      // toolbox had stored for offline use. The root worker has the matching
      // restriction; without both, the two of them take turns clearing each
      // other out.
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key.startsWith("sperrmuell-"))
          .map((key) => caches.delete(key)),
      ))
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
