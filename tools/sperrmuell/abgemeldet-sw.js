/**
 * The worker that retires the old one. Served at /sperrmuell/sw.js.
 *
 * The map used to live at /sperrmuell/ and registered a service worker from
 * that address, with that directory as its scope. It answered *every*
 * same-origin GET inside the scope out of its own cache, navigations
 * included, and it is still installed in the browser of everyone who has
 * ever opened the map.
 *
 * The app now sits at /tools/sperrmuell/ and the old address answers 301 —
 * except this one file, which .htaccess rewrites internally so the address
 * keeps answering 200 with a real script. That exception is the whole point.
 * A service worker script is never fetched through a redirect: the browser
 * treats a redirected update as a failed one, keeps the worker it has and
 * tries again another day. The old worker would have gone on serving the old
 * app from cache forever, and the redirect underneath it would never have
 * been reached. Worse, its background revalidation would have followed the
 * 301 and cached a redirected response, which a browser refuses to hand to a
 * navigation at all.
 *
 * So the old address goes on answering with a script, and the script takes
 * the worker apart: drop the caches, unregister, then send any open tab
 * through the redirect. After that the registration is gone and every later
 * visit is a plain request the 301 can act on.
 *
 * The file lives here rather than in a directory of its own at the site
 * root, where it stood for half a day and put back exactly the clutter that
 * moving the map was meant to clear. A worker's scope comes from the address
 * it was requested from, not from where the file sits, so the rewrite keeps
 * the scope at /sperrmuell/ without a second sperrmuell/ beside tools/.
 *
 * Nothing has to be remembered about it. Once the visitors from before the
 * move have been back once, nothing registers it any more and it is dead
 * weight of about a kilobyte, inside the tool it belongs to. Deleting it
 * early is the only way to get this wrong, so it stays.
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
