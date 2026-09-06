// This file has to sit in the site root. A worker only ever controls pages
// under the directory it is served from, so from /assets/ it controlled
// nothing at all and the offline promise was empty.

// The deployed commit, written in by .github/workflows/deploy.yml. Nothing
// reads it — it is here to be different.
//
// A browser replaces a worker when the file's bytes differ from the installed
// one, and nothing else in here moves when a tool is corrected. Without this
// line the browser compared two identical files after every deploy and
// concluded there was nothing to do, which is how this site went a year
// serving code it had already fixed. Locally the placeholder stays put; the
// deploy refuses to run if it is ever missing.
const DEPLOY_SHA = '__DEPLOY_SHA__';

// The cache name, on the other hand, deliberately does NOT carry the commit.
//
// Naming it after the deploy sounded right — new deploy, new cache — but it
// would mean throwing the offline store away several times a day and copying
// it back across, on the phone, in front of the visitor. Nothing is gained
// by it either: what keeps the cache honest is the revalidation in the fetch
// handler below, not the name on the box. So the name changes when the shape
// of the cache changes, and at no other time. v3 is inherited once, below.
const CACHE_NAME = 'll-toolbox-v4';

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

// Third-party libraries, served with a year and `immutable` (see
// assets/vendor/.htaccess) on the promise that a new version of a library
// gets a new file name — tests/test-vendor-unveraendert.js keeps that
// promise. Because the name is the version, there is nothing to revalidate:
// asking the server about 3.1 MB of mermaid on every page load would cost a
// round trip and never find anything.
const UNVERAENDERLICH = '/assets/vendor/';

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(
            // `cache: 'reload'` because a plain addAll goes through the
            // browser's own cache, and the entries already sitting in there
            // were stored under the old header — a year out.
            PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' }))
        ))
    );

    // Still here, deliberately. The prompt that is meant to replace it does
    // not exist yet, and a worker that waits with nothing to wake it would
    // leave anyone with a long-lived tab on the old code indefinitely. This
    // line goes when the update prompt lands, not before.
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        try {
            const neu = await caches.open(CACHE_NAME);

            for (const name of await caches.keys()) {
                if (name === CACHE_NAME) continue;

                // Only our own. /sperrmuell/ ships a second worker of its
                // own with its own cache, on this same origin — and its
                // activate deletes every cache that is not its own, this one
                // included. Returning the favour would leave the two of them
                // wiping each other out; a cache that is not ours is not
                // ours to delete.
                if (!name.startsWith('ll-toolbox-')) continue;

                // Inherited rather than dropped. This runs once — v3 to v4 —
                // and never again, because from here on the name stays put.
                // Everything carried over is revalidated by the fetch handler
                // the first time it is asked for, so nothing stale survives
                // being used.
                const alt = await caches.open(name);
                const eintraege = await alt.keys();
                await Promise.all(eintraege.map(async (request) => {
                    if (await neu.match(request)) return;
                    const antwort = await alt.match(request);
                    if (antwort) await neu.put(request, antwort);
                }));
                await caches.delete(name);
            }
        } catch (err) {
            // A full quota makes put reject. Half a migration is survivable —
            // whatever is missing gets fetched again. Never claiming the open
            // pages is not: they would run uncontrolled until the next load.
        }

        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const request = event.request;

    // Only GET responses can go in a cache, and only http(s) ones at that.
    // Extension and blob requests used to reach cache.put and throw there.
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

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
                .then((response) => {
                    if (response && response.status === 200 &&
                        (response.type === 'basic' || response.type === 'cors')) {
                        const kopie = response.clone();
                        caches.open(CACHE_NAME)
                            .then((cache) => cache.put(request, kopie))
                            .catch(() => {});
                    }
                    return response;
                })
                .catch(() => caches.match(request)
                    .then((hit) => hit || caches.match('/index.html')))
        );
        return;
    }

    const gecacht = caches.match(request).catch(() => undefined);

    // The vendored libraries are answered from the cache and left alone.
    // Their name is their version, so a hit cannot be out of date.
    if (url.origin === self.location.origin && url.pathname.startsWith(UNVERAENDERLICH)) {
        event.respondWith(gecacht.then((hit) => hit || fetch(request).then((response) => {
            if (response && response.status === 200 && response.type === 'basic') {
                const kopie = response.clone();
                caches.open(CACHE_NAME)
                    .then((cache) => cache.put(request, kopie))
                    .catch(() => {});
            }
            return response;
        })));
        return;
    }

    // Everything else — the site's own stylesheets and scripts, the fonts —
    // is answered from the cache at once and checked against the server
    // afterwards. The page renders from what is already there; the check runs
    // behind it and replaces the entry for next time. A correction therefore
    // arrives one load late rather than next spring.
    //
    // `cache: 'no-cache'`, not 'reload': 'reload' would re-download all
    // 356 KB of app.js every time. 'no-cache' sends the conditional request
    // instead. It has to be one of the two, because a plain fetch would be
    // answered by the browser's own cache, where the year-long entries from
    // before this change are still sitting.
    const frisch = fetch(request, { cache: 'no-cache' }).then(async (response) => {
        // Cloned here and not a line later: at this point the body is
        // untouched for certain, because nothing downstream has been handed
        // the response yet.
        if (!response || response.status !== 200) return response;
        if (response.type !== 'basic' && response.type !== 'cors') return response;
        const kopie = response.clone();

        // A conditional request that comes back 304 is handed to us as a
        // full 200 with a body — the browser resolves the revalidation
        // internally. Writing that back would mean rewriting every asset of
        // every page on every single load: measured on the markdown editor,
        // 3.2 MB of it, to store what was already there. So: only when the
        // validator says it actually moved.
        const hit = await gecacht;
        if (hit && gleicherStand(hit, response)) return response;

        try {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, kopie);
        } catch (err) { /* volles Kontingent, nächstes Mal wieder */ }
        return response;
    });

    // Called here, while the event is still being dispatched. Calling
    // waitUntil later, from inside the cache lookup's .then, is legal only as
    // long as respondWith is still pending — there is no reason to lean on
    // that when the same thing can be said plainly.
    event.waitUntil(frisch.catch(() => {}));

    event.respondWith(gecacht.then((hit) => hit || frisch));
});

/* Zwei Antworten auf dieselbe Adresse: dieselbe Datei? ETag zuerst, weil er
   genau ist; Last-Modified als Rückfall, weil nicht jeder Server einen ETag
   schickt. Sagt keiner von beiden etwas, gilt sie als geändert — lieber
   einmal zu viel geschrieben als eine Korrektur verschluckt. */
function gleicherStand(a, b) {
    const etagA = a.headers.get('ETag');
    const etagB = b.headers.get('ETag');
    if (etagA && etagB) return etagA === etagB;
    const zeitA = a.headers.get('Last-Modified');
    const zeitB = b.headers.get('Last-Modified');
    return !!(zeitA && zeitB && zeitA === zeitB);
}
