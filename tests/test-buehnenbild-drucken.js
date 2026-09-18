/**
 * Bühnenbild-Planer — der Weg zum Drucker (Puppeteer).
 *
 * Strg+P und das Browsermenü gehen an dem Knopf im Reiter „Drucken" vorbei.
 * Sie lösen `beforeprint` aus, und dort füllt der Planer den Druckvorrat
 * selbst. Stand in dieser Funktion ein Name, den es nicht gab, warf sie —
 * im Zuhörer, wo der Wurf nirgends auffällt. Der Vorrat blieb leer, die
 * Druck-CSS blendet alles außer ihm aus, und aus dem Drucker kam ein weißes
 * Blatt. Über den Knopf im Reiter fiel das nie auf: der füllt den Vorrat
 * selbst, und dann kehrt dieselbe Funktion gleich wieder um.
 *
 * Im Browser, weil `beforeprint` und die Druck-CSS ohne einen nicht
 * stattfinden.
 */
const assert = require('assert');
const puppeteer = require('puppeteer');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
function ok(name) { passed += 1; console.log('  ok  ' + name); }
function fail(name, msg) {
    console.error('  FAIL  ' + name + '\n        ' + msg);
    process.exitCode = 1;
}
function check(name, fn) {
    try { fn(); ok(name); } catch (err) { fail(name, err.message); }
}

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

        /* Das ausgearbeitete Beispiel: zehn Szenen, also zehn Blätter, und
           damit etwas, das leer bleiben könnte. */
        await page.evaluate(() => {
            const b = document.querySelector('[data-choose="example"]');
            if (b) b.click();
        });
        await sleep(1200);

        /* window.print anhalten: der Aufruf öffnet sonst einen Dialog, den
           niemand wegklickt. Gefüllt ist der Vorrat zu dem Zeitpunkt schon,
           und genau darum geht es hier. */
        await page.evaluate(() => { window.print = function () {}; });

        const vorher = errs.length;
        await page.evaluate(() => {
            /* Genau das, was Strg+P und das Browsermenü auslösen. */
            window.dispatchEvent(new Event('beforeprint'));
        });
        await sleep(400);

        const vorrat = await page.evaluate(() => {
            const p = document.getElementById('spPrintPortal');
            return {
                blaetter: p.querySelectorAll('.sp-sheet').length,
                plaene: p.querySelectorAll('svg.sp-plan').length,
                versteckt: p.hidden
            };
        });

        check('beforeprint wirft nicht', () => {
            assert.deepStrictEqual(errs.slice(vorher), [],
                'geworfen: ' + errs.slice(vorher).join(' | '));
        });
        check('beforeprint legt die Blätter in den Vorrat', () => {
            assert.ok(vorrat.blaetter > 0,
                'der Vorrat blieb leer — genau das ist das weiße Blatt');
            assert.ok(vorrat.plaene > 0, 'Blätter ohne Grundriss');
            assert.strictEqual(vorrat.versteckt, false,
                'der Vorrat ist versteckt geblieben und wird nicht gedruckt');
        });

        await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
        await sleep(300);
        const danach = await page.evaluate(() => {
            const p = document.getElementById('spPrintPortal');
            return { leer: p.innerHTML === '', versteckt: p.hidden };
        });
        check('nach dem Drucken ist der Vorrat wieder leer', () => {
            assert.ok(danach.leer, 'die Blätter stehen noch in der Seite');
            assert.ok(danach.versteckt, 'der Vorrat ist sichtbar geblieben');
        });

        /* Der Knopf im Reiter füllt selbst und darf sich nicht in die Quere
           kommen: er ruft window.print, das feuert beforeprint, und dann
           steht schon etwas im Vorrat. */
        await page.evaluate(() => {
            window.__doppelt = 0;
            const p = document.getElementById('spPrintPortal');
            window.print = function () { window.__doppelt = p.querySelectorAll('.sp-sheet').length; };
        });
        await page.evaluate(() => {
            const b = document.querySelector('[data-act="print"], #spPrint');
            if (b) b.click();
        });
        await sleep(600);

        check('nichts ist unterwegs geworfen worden', () => {
            assert.deepStrictEqual(errs, [], 'geworfen: ' + errs.join(' | '));
        });

        console.log('\n' + passed + ' Prüfungen bestanden');
    } finally {
        await browser.close();
    }
})();
