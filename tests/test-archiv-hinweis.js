/**
 * That a stillgelegtes Werkzeug says so on its own page (Puppeteer).
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
 * archived page at once, silently — the pages go on working, they just stop
 * saying the one thing they were left behind to say.
 *
 * Checked in a browser rather than by reading the HTML, because reading the
 * HTML would only prove the attribute is set. That the note is built,
 * lands in the document and is actually visible is the part that breaks.
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

/* Die Werkzeuge, die sich selbst als stillgelegt melden. */
const werkzeuge = fs.readdirSync(path.join(ROOT, 'tools')).sort()
    .map((name) => ({ name, seite: path.join(ROOT, 'tools', name, 'index.html') }))
    .filter(({ seite }) => fs.existsSync(seite));

const archiviert = werkzeuge.filter(({ seite }) =>
    /<html[^>]*\sdata-status="archiv"/.test(fs.readFileSync(seite, 'utf8')));
const gepflegt = werkzeuge.filter((w) => !archiviert.includes(w));

(async () => {
    if (archiviert.length === 0) {
        // Kein Fehler: es kann sein, dass keines stillgelegt ist. Dann gibt es
        // aber auch nichts zu pruefen, und das soll dastehen.
        console.log('PASS: no archived tools — nothing to check');
        return;
    }

    /* Die andere Haelfte der Regel, und die braucht keinen Browser: was
       stillgelegt ist, darf auf der Startseite nicht mehr stehen. */
    const start = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    for (const { name } of archiviert) {
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

        for (const { name } of archiviert) {
            await page.goto(`${BASE}/tools/${name}/`, { waitUntil: 'networkidle2' });
            const hinweis = await page.evaluate(() => {
                const el = document.querySelector('.archive-note');
                if (!el) return null;
                return {
                    sichtbar: el.offsetParent !== null && el.getBoundingClientRect().height > 0,
                    text: el.innerText.replace(/\s+/g, ' ').trim(),
                };
            });
            if (!hinweis) {
                fail(`tools/${name}/ carries data-status="archiv" but shows no note — ` +
                     'layout.js did not build one. Its anchor is `main .container`');
                continue;
            }
            if (!hinweis.sichtbar) {
                fail(`tools/${name}/ builds the note but it is not visible`);
                continue;
            }
            if (hinweis.text.length < 20) {
                fail(`tools/${name}/ shows an empty-looking note: ${JSON.stringify(hinweis.text)}`);
            }
        }

        /* Und andersherum: ein gepflegtes Werkzeug darf ihn nicht tragen.
           Sonst stuende der Hinweis eines Tages ueberall. */
        const probe = gepflegt[0];
        if (probe) {
            await page.goto(`${BASE}/tools/${probe.name}/`, { waitUntil: 'networkidle2' });
            const da = await page.evaluate(() => !!document.querySelector('.archive-note'));
            if (da) fail(`tools/${probe.name}/ is not archived but shows the note anyway`);
        }
    } finally {
        await browser.close();
    }

    if (!process.exitCode) {
        console.log(`PASS: archive note — ${archiviert.length} archived tools all say so and ` +
                    'none of them is on the front page');
    }
})();
