/**
 * A gravestone, not a worker.
 *
 * The Sperrmüll map used to live at /sperrmuell/ and registered a service
 * worker from this exact address, with this directory as its scope. That
 * worker answered *every* same-origin GET inside the scope out of its own
 * cache, navigations included. It is still installed in the browser of
 * everyone who has ever opened the map.
 *
 * The app has moved to /tools/sperrmuell/ and /sperrmuell/ now answers 301,
 * with this one file excepted — and the exception is the whole point. A
 * service worker script is never fetched through a redirect: the browser
 * treats a redirected update as a failed one, keeps the worker it has, and
 * tries again another day. The old worker would have gone on serving the old
 * app from cache forever, and the redirect underneath it would never have
 * been reached. Worse, its background revalidation would have followed the
 * 301 and cached a redirected response, which a browser refuses to hand to a
 * navigation at all.
 *
 * So the old address keeps answering with a real script, and the script
 * takes the worker apart: drop the caches, unregister, then send any open
 * tab through the redirect. After that the registration is gone and every
 * later visit is a plain request that the 301 can act on.
 *
 * Removable once the visitors from before the move have been back — the
 * registration cannot outlive one visit. Deleting it earlier strands exactly
 * the people it is here for.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Only this app's caches. The toolbox worker at the site root keeps its
      // own on the same origin, and clearing that here would empty the
      // offline store of every other tool on the way past.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("sperrmuell-"))
          .map((key) => caches.delete(key)),
      );

      await self.registration.unregister();

      // Tabs sitting on the old address are still showing the old app. They
      // are no longer controlled, but nothing has told them to look again.
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) client.navigate(client.url);
    })(),
  );
});

/* No fetch handler on purpose. Without one the browser goes to the network
   for everything in this scope, which is how the 301 gets its chance. */
