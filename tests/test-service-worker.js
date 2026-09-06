/**
 * Service worker — the offline promise in the README (Puppeteer).
 *
 * The README leads with "Also works offline as a PWA" and the badge says
 * so too. That only holds if the worker's scope covers the whole site: a
 * worker registered from a subdirectory controls that subdirectory and
 * nothing else, and then it never runs at all.
 *
 * So: the worker must control the home page and a tool page, and with the
 * network switched off both must still come up.
 */
const puppeteer = require('puppeteer');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const TOOL = '/tools/pdf-splitter/';

function fail(msg) {
    console.error('FAIL: ' + msg);
    process.exitCode = 1;
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();

    await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
    await page.evaluate(() => navigator.serviceWorker.ready).catch(() => {});
    await settle(1500);

    const scopes = await page.evaluate(async () =>
        (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope)
    );
    const origin = new URL(BASE).origin + '/';
    if (!scopes.includes(origin)) {
        fail(`no worker covers the whole site — registered scopes: ${JSON.stringify(scopes)}, expected ${origin}`);
    }

    // A worker claims existing pages on activate, but give the first load a
    // reload's grace before insisting.
    await page.reload({ waitUntil: 'networkidle2' });
    await settle(800);
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
        fail('the home page is not controlled by a service worker');
    }

    await page.goto(BASE + TOOL, { waitUntil: 'networkidle2' });
    await settle(800);
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
        fail(`${TOOL} is not controlled by a service worker`);
    }

    // With the network there, a page must still come from the network. A
    // worker that answers pages from its cache first would keep serving
    // yesterday's HTML after a deploy, for as long as the entry survives.
    // A cached answer transfers no bytes; a network one does.
    await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
    await settle(400);
    await page.reload({ waitUntil: 'networkidle2' });
    await settle(400);
    const transferred = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        return nav ? nav.transferSize : null;
    });
    if (!(transferred > 0)) {
        fail(`online, the home page was answered without touching the network (transferSize ${transferred}) — pages would go stale after a deploy`);
    }

    // Everything visited so far is in the cache. Pull the plug.
    await page.goto(BASE + TOOL, { waitUntil: 'networkidle2' });
    await settle(400);
    await page.setOfflineMode(true);

    for (const path of [TOOL, '/']) {
        try {
            await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const heading = await page.evaluate(() => {
                const h = document.querySelector('h1');
                return h ? (h.textContent || '').trim() : null;
            });
            if (!heading) fail(`offline, ${path} came up without a heading — it did not come from the cache`);
        } catch (err) {
            fail(`offline, ${path} did not load at all: ${err.message.split('\n')[0]}`);
        }
    }

    await page.setOfflineMode(false);
    await browser.close();

    if (process.exitCode) {
        console.error('Service worker test failed.');
    } else {
        console.log('PASS: service worker — controls the whole site, serves pages fresh online, still comes up offline');
    }
})().catch((err) => {
    console.error('FAIL: ' + err.message);
    process.exit(1);
});
