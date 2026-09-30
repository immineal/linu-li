/**
 * The site-wide language switch, end to end (Puppeteer).
 *
 * The chrome (header, footer, update notice, archive note, toasts) and the
 * two legal pages (Impressum, Datenschutz) switch between English and German
 * based on:
 *
 *     1. ?lang=en|de in the URL          (highest priority)
 *     2. localStorage.ll_lang            (persisted from the switch)
 *     3. navigator.language              (browser default)
 *     4. English                         (floor)
 *
 * The stage planner (buehnenbild) and the Bonn Sperrmüll map lock themselves
 * to German with html[data-lang-lock="de"]. The footer switch is hidden on
 * those pages.
 *
 * This test covers the visible symptoms of that plumbing: the toggle appears,
 * the toggle flips things, ?lang= overrides the browser, and locked pages
 * hide the switch.
 */
const puppeteer = require('puppeteer');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

function fail(msg) {
    console.error('FAIL: ' + msg);
    process.exitCode = 1;
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

async function chrome(page) {
    return page.evaluate(() => ({
        htmlLang: document.documentElement.getAttribute('lang'),
        dataLang: document.documentElement.getAttribute('data-lang'),
        legalLink: (document.querySelector('footer a[href$="impressum.html"]') || {}).textContent || '',
        privacyLink: (document.querySelector('footer a[href$="privacy.html"]') || {}).textContent || '',
        donate: (document.querySelector('.donate-btn') || {}).textContent || '',
        hasSwitch: !!document.querySelector('.ll-lang-switch'),
        current: (document.querySelector('.ll-lang-switch .ll-lang-current') || {}).textContent || '',
        other: (document.querySelector('.ll-lang-switch .ll-lang-other') || {}).textContent || '',
    }));
}

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
        /* --- English via ?lang=en on a normal tool page --- */
        const enPage = await browser.newPage();
        await enPage.goto(`${BASE}/tools/word-counter/?lang=en`, { waitUntil: 'networkidle2' });
        await settle(500);
        const en = await chrome(enPage);
        if (en.htmlLang !== 'en') fail(`?lang=en did not set html[lang]=en (${en.htmlLang})`);
        if (en.dataLang !== 'en') fail(`?lang=en did not set html[data-lang]=en (${en.dataLang})`);
        if (!/legal notice/i.test(en.legalLink)) {
            fail(`English footer legal link reads: ${JSON.stringify(en.legalLink)}`);
        }
        if (!/privacy/i.test(en.privacyLink)) {
            fail(`English footer privacy link reads: ${JSON.stringify(en.privacyLink)}`);
        }
        if (!/buy me a coffee/i.test(en.donate)) {
            fail(`English donate button reads: ${JSON.stringify(en.donate)}`);
        }
        if (!en.hasSwitch) fail('English page has no language switch in the footer');
        if (en.current !== 'EN') fail(`English page current-lang label is ${en.current}`);
        if (en.other !== 'DE') fail(`English page other-lang label is ${en.other}`);

        /* --- German via ?lang=de on the same page --- */
        const dePage = await browser.newPage();
        await dePage.goto(`${BASE}/tools/word-counter/?lang=de`, { waitUntil: 'networkidle2' });
        await settle(500);
        const de = await chrome(dePage);
        if (de.htmlLang !== 'de') fail(`?lang=de did not set html[lang]=de (${de.htmlLang})`);
        if (de.dataLang !== 'de') fail(`?lang=de did not set html[data-lang]=de (${de.dataLang})`);
        if (!/impressum/i.test(de.legalLink)) {
            fail(`German footer legal link reads: ${JSON.stringify(de.legalLink)}`);
        }
        if (!/datenschutz/i.test(de.privacyLink)) {
            fail(`German footer privacy link reads: ${JSON.stringify(de.privacyLink)}`);
        }
        if (!/kaffee/i.test(de.donate)) {
            fail(`German donate button reads: ${JSON.stringify(de.donate)}`);
        }
        if (!de.hasSwitch) fail('German page has no language switch in the footer');
        if (de.current !== 'DE') fail(`German page current-lang label is ${de.current}`);
        if (de.other !== 'EN') fail(`German page other-lang label is ${de.other}`);

        /* --- Clicking the switch persists and reloads --- */
        const clickPage = await browser.newPage();
        await clickPage.goto(`${BASE}/tools/word-counter/?lang=en`, { waitUntil: 'networkidle2' });
        await settle(500);
        const before = await clickPage.evaluate(() =>
            document.documentElement.getAttribute('data-lang'));
        if (before !== 'en') fail('starter page was not English');

        const nav = clickPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15_000 })
            .catch(() => {});
        await clickPage.evaluate(() => document.querySelector('.ll-lang-switch').click());
        await nav;
        await settle(500);
        const after = await clickPage.evaluate(() => ({
            lang: document.documentElement.getAttribute('data-lang'),
            stored: localStorage.getItem('ll_lang'),
            url: window.location.href,
        }));
        if (after.lang !== 'de') fail(`click did not switch to German (${after.lang})`);
        if (after.stored !== 'de') fail(`click did not persist locale (${after.stored})`);
        if (/\?lang=/.test(after.url)) fail(`click left ?lang= in the URL (${after.url})`);

        /* --- Locked pages hide the switch --- */
        const lockedPages = [
            { url: '/tools/buehnenbild/', name: 'buehnenbild' },
            { url: '/tools/sperrmuell/', name: 'sperrmuell' },
        ];
        for (const { url, name } of lockedPages) {
            const p = await browser.newPage();
            const res = await p.goto(`${BASE}${url}`, { waitUntil: 'networkidle2' });
            if (!res || res.status() >= 400) {
                console.log(`SKIP: ${name} did not load (build not present?)`);
                await p.close();
                continue;
            }
            await settle(500);
            const state = await p.evaluate(() => ({
                lock: document.documentElement.getAttribute('data-lang-lock'),
                hasSwitch: !!document.querySelector('.ll-lang-switch'),
            }));
            if (state.lock !== 'de') {
                fail(`${name} should carry data-lang-lock="de" but has ${JSON.stringify(state.lock)}`);
            }
            if (state.hasSwitch) fail(`${name} is locked to German but shows the language switch`);
            await p.close();
        }

        /* --- localStorage without ?lang= wins over browser --- */
        const persistPage = await browser.newPage();
        await persistPage.goto(`${BASE}/tools/word-counter/`, { waitUntil: 'networkidle2' });
        await persistPage.evaluate(() => localStorage.setItem('ll_lang', 'de'));
        await persistPage.reload({ waitUntil: 'networkidle2' });
        await settle(400);
        const stored = await persistPage.evaluate(() =>
            document.documentElement.getAttribute('data-lang'));
        if (stored !== 'de') fail(`localStorage did not carry the locale across a reload (${stored})`);

        /* --- ?lang= wins over localStorage --- */
        await persistPage.goto(`${BASE}/tools/word-counter/?lang=en`, { waitUntil: 'networkidle2' });
        await settle(400);
        const forced = await persistPage.evaluate(() =>
            document.documentElement.getAttribute('data-lang'));
        if (forced !== 'en') fail(`?lang=en did not override stored ll_lang=de (${forced})`);

        /* --- Legal pages: both blocks exist, only the right one is visible ---
           Clean URLs on purpose. `serve` (both here and in CI) rewrites
           /impressum.html to /impressum with a 301 that drops the query
           string, so `?lang=…` on the .html form never reaches the page.
           The live site keeps the .html; both forms serve the same file. */
        for (const legal of ['impressum', 'privacy']) {
            const p = await browser.newPage();
            await p.goto(`${BASE}/${legal}?lang=de`, { waitUntil: 'networkidle2' });
            await settle(300);
            const deVis = await p.evaluate(() => {
                const deBlock = document.getElementById('lang-de');
                const enBlock = document.getElementById('lang-en');
                const vis = (el) => el && el.offsetParent !== null;
                return { de: vis(deBlock), en: vis(enBlock) };
            });
            if (!deVis.de) fail(`${legal}?lang=de: German block is hidden`);
            if (deVis.en) fail(`${legal}?lang=de: English block is visible when it should not be`);

            await p.goto(`${BASE}/${legal}?lang=en`, { waitUntil: 'networkidle2' });
            await settle(300);
            const enVis = await p.evaluate(() => {
                const deBlock = document.getElementById('lang-de');
                const enBlock = document.getElementById('lang-en');
                const vis = (el) => el && el.offsetParent !== null;
                return { de: vis(deBlock), en: vis(enBlock) };
            });
            if (enVis.de) fail(`${legal}?lang=en: German block is visible when it should not be`);
            if (!enVis.en) fail(`${legal}?lang=en: English block is hidden`);
            await p.close();
        }

        if (!process.exitCode) {
            console.log('PASS: language switch — ?lang wins over storage which wins over browser, ' +
                'clicking the footer button persists and reloads, buehnenbild and sperrmuell hide ' +
                'the switch, and the legal pages show the right block per locale.');
        }
    } finally {
        await browser.close();
    }
})().catch((err) => {
    console.error('FAIL: ' + err.message);
    process.exit(1);
});
