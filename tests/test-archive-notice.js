/**
 * An archived tool says so on its own page, in both languages (Puppeteer).
 *
 * A tool marked `<html data-status="archiv">` stays reachable but leaves the
 * front page and the sitemap. From that moment the only ways in are a
 * bookmark and a search result, and both land straight on the tool — so the
 * page itself is the only place left that can say nobody is working on it
 * any more. tests/test-sitemap.js holds the other half of the rule, that an
 * archived tool is not advertised.
 *
 * The note is built in layout.js, not written into the pages, which is what
 * makes this worth a test: it hangs off one selector (`main .container`) and
 * one attribute. Change either and the note stops appearing on every
 * archived page at once, silently. The pages go on working, they just stop
 * saying the one thing they were left behind to say.
 *
 * Checked in a browser rather than by reading the HTML, because reading the
 * HTML would only prove the attribute is set. That the note is built, lands
 * in the document and is actually visible is the part that breaks.
 *
 * Two locale runs: one with ?lang=en (English wording), one with ?lang=de
 * (German wording). The site-wide language switch has to reach here too.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

function fail(msg) {
    console.error('FAIL: ' + msg);
    process.exitCode = 1;
}

/* The tools that mark themselves as archived. */
const tools = fs.readdirSync(path.join(ROOT, 'tools')).sort()
    .map((name) => ({ name, page: path.join(ROOT, 'tools', name, 'index.html') }))
    .filter(({ page }) => fs.existsSync(page));

const archived = tools.filter(({ page }) =>
    /<html[^>]*\sdata-status="archiv"/.test(fs.readFileSync(page, 'utf8')));
const live = tools.filter((w) => !archived.includes(w));

(async () => {
    if (archived.length === 0) {
        // Not an error: it may be that nothing is archived. Then there is
        // also nothing to check, and that should stand plainly.
        console.log('PASS: no archived tools — nothing to check');
        return;
    }

    /* The other half of the rule, and it needs no browser: anything archived
       must not sit on the front page any more. */
    const start = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    for (const { name } of archived) {
        if (new RegExp(`href="\\./tools/${name}/?"`).test(start)) {
            fail(`tools/${name}/ is archived but still has a card on the front page`);
        }
    }

    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
        const page = await browser.newPage();

        for (const { name } of archived) {
            /* English side. */
            await page.goto(`${BASE}/tools/${name}/?lang=en`, { waitUntil: 'networkidle2' });
            const enNote = await page.evaluate(() => {
                const el = document.querySelector('.archive-note');
                if (!el) return null;
                return {
                    visible: el.offsetParent !== null && el.getBoundingClientRect().height > 0,
                    text: el.innerText.replace(/\s+/g, ' ').trim(),
                };
            });
            if (!enNote) {
                fail(`tools/${name}/ carries data-status="archiv" but shows no note in ` +
                     'English. layout.js anchors it on `main .container`');
                continue;
            }
            if (!enNote.visible) fail(`tools/${name}/ builds the note but it is hidden (en)`);
            if (!/working on/i.test(enNote.text) && !/off the front page/i.test(enNote.text)) {
                fail(`tools/${name}/ English note reads: ${JSON.stringify(enNote.text)}`);
            }

            /* German side. */
            await page.goto(`${BASE}/tools/${name}/?lang=de`, { waitUntil: 'networkidle2' });
            const deNote = await page.evaluate(() => {
                const el = document.querySelector('.archive-note');
                if (!el) return null;
                return {
                    visible: el.offsetParent !== null && el.getBoundingClientRect().height > 0,
                    text: el.innerText.replace(/\s+/g, ' ').trim(),
                };
            });
            if (!deNote) {
                fail(`tools/${name}/ shows no archive note in German`);
                continue;
            }
            if (!deNote.visible) fail(`tools/${name}/ builds the note but it is hidden (de)`);
            if (!/weiterentwickelt/.test(deNote.text) && !/nicht mehr/.test(deNote.text)) {
                fail(`tools/${name}/ German note reads: ${JSON.stringify(deNote.text)}`);
            }
        }

        /* And the other way round: a live tool must not carry it, otherwise
           the note would one day sit on every page. */
        const sample = live[0];
        if (sample) {
            await page.goto(`${BASE}/tools/${sample.name}/`, { waitUntil: 'networkidle2' });
            const there = await page.evaluate(() => !!document.querySelector('.archive-note'));
            if (there) fail(`tools/${sample.name}/ is not archived but shows the note anyway`);
        }
    } finally {
        await browser.close();
    }

    if (!process.exitCode) {
        console.log(`PASS: archive note — ${archived.length} archived tools all say so in ` +
                    'English and in German, and none of them is on the front page');
    }
})();
