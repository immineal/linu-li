/**
 * Two service workers on one origin, not clearing each other out (Puppeteer).
 *
 * linu.li serves two of them: `/sw.js` for the toolbox, and
 * `/sperrmuell/sw.js` for the Bonn bulky-waste map, which is a separate app
 * with its own build and its own cache. Cache Storage is per origin, not per
 * worker, so both of them see both caches — and both of them used to open
 * their activate with the same tidy-looking line:
 *
 *     caches.keys() -> delete everything that is not mine
 *
 * Which meant: opening the map threw away whatever the toolbox had stored
 * for offline use, and the next visit to a tool threw away the map's. Two
 * workers taking turns undoing each other, and nothing anywhere to say so —
 * offline simply did not work as often as it should have, depending on which
 * page you had opened last.
 *
 * Both now delete only their own prefix. This test walks the round trip that
 * used to lose one of them.
 *
 * What it catches: the map's worker clearing the toolbox cache. Run against
 * the old sperrmuell/sw.js it fails, which is the point.
 *
 * What it does not catch, and why: the same mistake in the other direction,
 * /sw.js clearing the map's cache. A worker's activate only runs when a new
 * worker takes over, so the root one would have to change its own bytes in
 * the middle of this test to be provoked into it — which in real life is
 * what a deploy does, and here would mean editing sw.js on disk while the
 * test runs. That direction is held by the static check in
 * tests/test-deploy-frische.js instead ("the worker deletes only its own
 * caches"), which reads the line straight out of sw.js.
 */
const puppeteer = require('puppeteer');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

function fail(msg) {
    console.error('FAIL: ' + msg);
    process.exitCode = 1;
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/* Ein Worker meldet sich erst nach einem Neuladen als zuständig; danach
   braucht sein activate noch einen Moment. */
async function besuchen(page, pfad) {
    await page.goto(BASE + pfad, { waitUntil: 'networkidle2' });
    await page.evaluate(() => navigator.serviceWorker.ready).catch(() => {});
    await settle(1200);
    await page.reload({ waitUntil: 'networkidle2' });
    await settle(1500);
}

/* Zwei Fassungen dieses Tests haben nichts gefangen, bevor diese hier stand:
   erst eine, die nur `caches.keys()` ansah — der Wurzel-Worker legt seinen
   Cache beim nächsten Seitenaufruf sofort wieder an, der Name ist also immer
   da. Dann eine, die die Einträge zählte — nach dem Löschen füllt sich der
   Cache beim Weiterklicken wieder, im kaputten Lauf auf 27 statt 39, was
   über der Schwelle lag.
   Was das Löschen nicht überlebt, ist eine ganz bestimmte Adresse, die die
   andere Seite nie anfragt. Also legen wir eine hinein und sehen nach, ob
   sie noch da ist. */
const MURMEL = '/tests/zwei-worker-murmel.txt';

const murmelLegen = (page, cacheName) => page.evaluate(async (name, url) => {
    const cache = await caches.open(name);
    await cache.put(url, new Response('murmel'));
}, cacheName, MURMEL);

const murmelDa = (page, cacheName) => page.evaluate(async (name, url) => {
    if (!(await caches.keys()).includes(name)) return false;
    return !!(await (await caches.open(name)).match(url));
}, cacheName, MURMEL);

const bestand = (page) => page.evaluate(async () => {
    const raus = {};
    for (const name of await caches.keys()) {
        raus[name] = (await (await caches.open(name)).keys()).length;
    }
    return raus;
});

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
        const page = await browser.newPage();

        await besuchen(page, '/tools/pdf-splitter/');
        const toolboxCache = (await page.evaluate(() => caches.keys()))
            .find((n) => n.startsWith('ll-toolbox-'));
        if (!toolboxCache) {
            fail('the toolbox worker made no cache at all — nothing under test');
            return;
        }
        await murmelLegen(page, toolboxCache);

        await besuchen(page, '/sperrmuell/');
        const karteCache = (await page.evaluate(() => caches.keys()))
            .find((n) => n.startsWith('sperrmuell-'));
        if (!karteCache) {
            fail('the map worker made no cache at all — nothing under test');
            return;
        }
        if (!(await murmelDa(page, toolboxCache))) {
            fail('opening the map cleared the toolbox cache — offline use of every ' +
                'tool is gone until each one is visited again. What comes back ' +
                'afterwards is a fresh cache, not the one that was there: ' +
                JSON.stringify(await bestand(page)));
            return;
        }
        await murmelLegen(page, karteCache);

        // Und zurück: die Karte darf ihren Bestand ebenso behalten.
        await besuchen(page, '/tools/pdf-splitter/');
        if (!(await murmelDa(page, karteCache))) {
            fail('going back to a tool cleared the map cache — the map would not come ' +
                'up offline any more: ' + JSON.stringify(await bestand(page)));
            return;
        }

        console.log('PASS: both workers keep their own cache and leave the other alone ' +
            `(${JSON.stringify(await bestand(page))})`);
    } finally {
        await browser.close();
    }
})().catch((err) => {
    console.error('FAIL: ' + err.message);
    process.exit(1);
});
