/**
 * Wie weit sich der Bühnenbild-Planer herauszoomen lässt (Puppeteer).
 *
 * Die Grenze lag bei der zwölffachen Bühnenbreite. Die Bühne war dann ein
 * Achtel des Fensters breit — ein Fleck in der Mitte —, und ein einziger
 * Wisch auf einem Trackpad erzeugt Dutzende Radrasten, ist also im Nu dort.
 * Zurück kam man nur über „Einpassen".
 *
 * Jetzt hört es beim Doppelten dessen auf, was ohnehin ins Bild passt, und
 * am Anschlag rückt der Ausschnitt auf die Arbeit zurück, statt den Wisch
 * ins Leere laufen zu lassen.
 *
 * Gemessen am Überblick und nicht an der Bühne: steht etwas in der Gasse,
 * ist der Überblick größer, und eine an der Bühne festgemachte Grenze hätte
 * genau die Szenen nicht mehr ganz ins Bild gelassen, bei denen es darauf
 * ankommt.
 *
 * Im Browser, weil das alles in app.js steht und app.js ohne DOM nicht läuft.
 * Die Rechnung darunter, SPPlan.viewOf, hängt in tests/test-buehnenbild.js.
 */
const assert = require('assert');
const puppeteer = require('puppeteer');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg) {
    console.error('FAIL: ' + msg);
    process.exitCode = 1;
}

const spanOf = (vb) => {
    const [, , w, h] = vb.split(/\s+/).map(Number);
    return Math.max(w, h);
};

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
        const page = await browser.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(e.message));

        await page.goto(`${BASE}/tools/buehnenbild/`, { waitUntil: 'networkidle2' });
        await sleep(2500);

        const viewBox = () => page.evaluate(() => {
            const c = document.querySelector('#spCanvas');
            return c ? c.getAttribute('viewBox') : null;
        });

        const start = await viewBox();
        if (!start) { fail('no canvas on the page — the planner did not start'); return; }
        const uebersicht = spanOf(start);

        /* Ein Wisch nach außen, in der Größenordnung, die ein Trackpad
           wirklich liefert. */
        const raus = (n) => page.evaluate((count) => {
            const c = document.querySelector('#spCanvas');
            const r = c.getBoundingClientRect();
            for (let i = 0; i < count; i++) {
                c.dispatchEvent(new WheelEvent('wheel', {
                    deltaY: 120, bubbles: true, cancelable: true,
                    clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
                }));
            }
        }, n);

        await raus(60);
        await sleep(300);
        const weit = await viewBox();
        const ratio = spanOf(weit) / uebersicht;

        if (ratio > 2.05) {
            fail(`60 notches out reach ${ratio.toFixed(2)}x what fits in the picture ` +
                 `(${weit}). The stage is a speck again.`);
        }

        /* Und es läuft nicht weiter, wenn man weiterwischt. */
        await raus(60);
        await sleep(300);
        const nochWeiter = await viewBox();
        if (spanOf(nochWeiter) > spanOf(weit) * 1.001) {
            fail(`another 60 notches went further still: ${weit} -> ${nochWeiter}`);
        }

        /* Am Anschlag steht die Bühne in der Mitte. Ohne das schiebt ein
           weiterer Wisch nichts mehr und die Arbeit bleibt am Rand liegen. */
        const [x, y, w, h] = nochWeiter.split(/\s+/).map(Number);
        const mitte = await page.evaluate(() => {
            const b = window.SP.stageOutline(window.SP.DEFAULT_STAGE).bounds;
            return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
        });
        if (Math.abs((x + w / 2) - mitte.x) > w * 0.02) {
            fail(`at the limit the view sits at x=${(x + w / 2).toFixed(2)}, ` +
                 `the stage centre is ${mitte.x} — it was not brought back`);
        }
        void y; void h;

        /* Hineinzoomen bleibt fein genug, um ein Requisit auf den Zentimeter
           zu stellen — das hängt an der Bühne, nicht am Überblick. */
        await page.evaluate(() => {
            const c = document.querySelector('#spCanvas');
            const r = c.getBoundingClientRect();
            for (let i = 0; i < 120; i++) {
                c.dispatchEvent(new WheelEvent('wheel', {
                    deltaY: -120, bubbles: true, cancelable: true,
                    clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
                }));
            }
        });
        await sleep(300);
        const nah = await viewBox();
        const nahSpan = spanOf(nah);
        if (!(nahSpan > 0) || nahSpan > uebersicht / 10) {
            fail(`zooming in stops too early at ${nah} — close work is not possible`);
        }
        if (nahSpan < 0.01) {
            fail(`zooming in ran away to ${nah}; rounded to three places that is an empty canvas`);
        }

        if (errs.length) fail('the page threw: ' + errs.slice(0, 3).join(' | '));

        if (!process.exitCode) {
            console.log(`PASS: zoom — out stops at ${ratio.toFixed(2)}x the overview and ` +
                        're-centres, in still reaches close work');
        }
    } finally {
        await browser.close();
    }
})();
