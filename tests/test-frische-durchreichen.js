/**
 * Does a corrected file actually reach someone who was here before? (Puppeteer)
 *
 * This is the bug the whole cache rework exists for, and it was invisible
 * from the outside: the site worked, it just served last spring's code.
 * Scripts and stylesheets went out with `max-age=31536000` and no version in
 * their URL, and the service worker answered them from its own cache first
 * and never asked again. A fix pushed on Monday reached a returning visitor
 * at some point the following year.
 *
 * The test walks the actual path a visitor takes:
 *
 *   1. ask for a file, so the worker caches it
 *   2. change that file on the server, the way a deploy does
 *   3. ask again
 *
 * Stale-while-revalidate is the promise, so step 3 may legitimately still
 * answer with the old copy — it is served from the cache while the check
 * runs behind it. What must not happen is that the new bytes never arrive at
 * all. Two asks are allowed; after that the file has to be the new one.
 *
 * Run against the cache-first worker this file replaced, it fails on exactly
 * that line: the old copy came back for good.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

/* Liegt in tests/, weil der Deploy dieses Verzeichnis ohnehin entfernt — die
   Datei kann also nie versehentlich auf der Seite landen, auch wenn dieser
   Lauf mittendrin abbricht. */
const PROBE_DATEI = path.join(__dirname, 'frische-probe.js');
const PROBE_URL = '/tests/frische-probe.js';

function fail(msg) {
    console.error('FAIL: ' + msg);
    process.exitCode = 1;
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    fs.writeFileSync(PROBE_DATEI, 'window.__probe = "alt";\n');

    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
        const page = await browser.newPage();
        await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
        await page.evaluate(() => navigator.serviceWorker.ready).catch(() => {});
        await settle(1200);

        /* Ohne Controller läuft die Anfrage am Worker vorbei und der Test
           prüfte nichts. */
        await page.reload({ waitUntil: 'networkidle2' });
        await settle(800);
        if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
            fail('no worker is controlling the page — nothing under test');
            return;
        }

        const hol = () => page.evaluate(async (url) =>
            (await fetch(url)).text(), PROBE_URL);

        const zuerst = await hol();
        if (!/alt/.test(zuerst)) {
            fail(`the probe did not come back as written: ${JSON.stringify(zuerst)}`);
            return;
        }

        // Der Deploy: dieselbe Adresse, anderer Inhalt.
        fs.writeFileSync(PROBE_DATEI, 'window.__probe = "neu";\n');
        await settle(300);

        const zweitens = await hol();
        await settle(1200);   // dem Nachfassen im Hintergrund Zeit lassen
        const drittens = await hol();

        if (/neu/.test(zweitens) || /neu/.test(drittens)) {
            console.log('PASS: a changed file reaches a visitor who had it cached' +
                (/neu/.test(zweitens) ? ' (straight away)' : ' (on the next ask)'));
        } else {
            fail('the old copy came back twice after the file changed — a returning ' +
                'visitor would keep it. This is what the year-long cache and the ' +
                "worker's cache-first answer did together.");
        }
    } finally {
        await browser.close();
        fs.rmSync(PROBE_DATEI, { force: true });
    }
})().catch((err) => {
    fs.rmSync(PROBE_DATEI, { force: true });
    console.error('FAIL: ' + err.message);
    process.exit(1);
});
