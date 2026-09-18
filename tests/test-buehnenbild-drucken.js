/**
 * Bühnenbild-Planer — der Weg zum Drucker und was dabei gemessen wird
 * (Puppeteer).
 *
 * Zwei Dinge, die sich nur im Browser zeigen.
 *
 * Erstens: Strg+P und das Browsermenü gehen an dem Knopf im Reiter vorbei.
 * Sie lösen `beforeprint` aus, und dort füllt der Planer den Druckvorrat
 * selbst. Stand in dieser Funktion ein Name, den es nicht gab, warf sie —
 * im Zuhörer, wo der Wurf nirgends auffällt. Der Vorrat blieb leer, die
 * Druck-CSS blendet alles außer ihm aus, und aus dem Drucker kam ein weißes
 * Blatt. Über den Knopf im Reiter fiel das nie auf.
 *
 * Zweitens: gemessen wird, solange die Blätter im Dokument stehen. Danach
 * räumt der Planer sie weg. Fällt die Messung aus, kommt jede Rückmeldung
 * über einen Druckfehler ohne die eine Zahl, um die es geht — wie groß die
 * Schrift gesetzt werden sollte.
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

        /* Das ausgearbeitete Beispiel, weil in ihm ein Textfeld mit echtem
           Text steht („Für den Transporter"). Ohne eines gäbe es genau das
           nicht zu messen, worum es hier geht. */
        await page.evaluate(() => {
            const b = document.querySelector('[data-choose="example"]');
            if (b) b.click();
        });
        await sleep(1200);

        /* ------------------------------------------------ Strg+P füllt */

        /* window.print anhalten: der Aufruf öffnet sonst einen Dialog, den
           niemand wegklickt. Der Vorrat ist zu dem Zeitpunkt gefüllt, und
           genau darum geht es. */
        await page.evaluate(() => {
            window.__gedruckt = null;
            window.print = function () {
                const p = document.getElementById('spPrintPortal');
                window.__gedruckt = {
                    laenge: p ? p.innerHTML.length : -1,
                    blaetter: p ? p.querySelectorAll('.sp-sheet').length : -1,
                    versteckt: p ? p.hidden : null
                };
            };
        });

        const vorher = errs.length;
        await page.evaluate(() => {
            /* Genau das, was Strg+P und das Browsermenü auslösen. */
            window.dispatchEvent(new Event('beforeprint'));
        });
        await sleep(300);

        const ueberBeforeprint = await page.evaluate(() => {
            const p = document.getElementById('spPrintPortal');
            return {
                blaetter: p.querySelectorAll('.sp-sheet').length,
                versteckt: p.hidden,
                plaene: p.querySelectorAll('svg.sp-plan').length,
                textfelder: p.querySelectorAll('.sp-mark-text').length
            };
        });

        check('beforeprint wirft nicht', () => {
            assert.deepStrictEqual(errs.slice(vorher), [],
                'geworfen: ' + errs.slice(vorher).join(' | '));
        });
        check('beforeprint legt Blätter in den Vorrat', () => {
            assert.ok(ueberBeforeprint.blaetter > 0,
                'der Vorrat blieb leer — das ist das weiße Blatt');
            assert.strictEqual(ueberBeforeprint.versteckt, false,
                'der Vorrat ist versteckt geblieben');
        });

        /* --------------------------------------- und dabei wird gemessen */

        const gemessen = await page.evaluate(() => {
            const s = window.SPDiag && window.SPDiag.stand();
            if (!s || !s.druck) return null;
            return {
                blaetter: s.druck.blaetter.length,
                erstes: s.druck.blaetter[0],
                felder: s.druck.blaetter.reduce((n, b) => n + b.felder.length, 0)
            };
        });

        check('der Druck wird ausgemessen, solange er im Dokument steht', () => {
            assert.ok(gemessen, 'SPDiag hat nichts gemessen');
            assert.ok(gemessen.blaetter > 0, 'kein Blatt gemessen');
        });

        check('das Beispiel bringt ein Textfeld auf ein Blatt', () => {
            assert.ok(ueberBeforeprint.textfelder > 0,
                'kein .sp-mark-text im Vorrat — dann ist hier nichts zu messen');
        });

        check('das Textfeld wird einzeln ausgemessen', () => {
            /* Die Zeile, wegen der das alles hier steht. Fehlt sie, kommt
               jede Rückmeldung über ein leeres Textfeld ohne die Zahl, die
               den Fehler benennt. */
            assert.ok(gemessen.felder > 0, 'kein Textfeld gemessen');
        });

        check('gemessen wird auch der Text neben den Textfeldern', () => {
            const andere = gemessen && gemessen.erstes && gemessen.erstes.andere;
            assert.ok(andere && Object.keys(andere).length > 0,
                'kein einziges <text> gefunden — dann misst die Messung nichts');
        });

        /* Absichtlich am fertigen Text geprüft und nicht an den Zahlen
           dahinter: verschickt wird der Text. */
        const bericht = await page.evaluate(
            () => window.SPDiag.bericht({ build: 'test-stempel', sha: 'abc1234' }, window));
        check('der Bericht nennt die Fassung und den letzten Druck', () => {
            assert.ok(bericht.indexOf('test-stempel') > -1, 'Fassung fehlt');
            assert.ok(/Letzter Druck \(/.test(bericht), 'Druck fehlt:\n' + bericht);
            assert.ok(/mit Textfeld/.test(bericht), 'zählt die Textfelder nicht:\n' + bericht);
            assert.ok(/sp-mark-text/.test(bericht),
                'kein ausgemessenes Textfeld im Bericht:\n' + bericht);
            assert.ok(/Rasterprobe/.test(bericht),
                'die Rasterprobe ist der Längengrenze zum Opfer gefallen');
            /* Ohne gesetzte Mindestschriftgröße — und der Prüfbrowser hat
               keine — müssen 4 px auch 4 px werden. Käme hier etwas anderes
               heraus, wäre die Messung selbst kaputt und der Hinweis im
               Bericht eine Falschmeldung. */
            assert.ok(/4 px werden gesetzt als: (3\.\d+|4|4\.\d+) px/.test(bericht),
                'die Mindestschrift misst sich selbst falsch:\n' + bericht);
            assert.ok(bericht.indexOf('NaN') === -1, 'NaN im Bericht:\n' + bericht);
            assert.ok(bericht.indexOf('undefined') === -1, 'undefined im Bericht:\n' + bericht);
        });

        /* ------------------------------------------- afterprint räumt ab */

        await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
        await sleep(200);
        const danach = await page.evaluate(() => {
            const p = document.getElementById('spPrintPortal');
            return { leer: p.innerHTML === '', versteckt: p.hidden };
        });
        check('nach dem Drucken ist der Vorrat wieder leer', () => {
            assert.ok(danach.leer, 'die Blätter stehen noch in der Seite');
            assert.ok(danach.versteckt, 'der Vorrat ist sichtbar geblieben');
        });

        /* Sonst wäre die Messung zu dem Zeitpunkt weg, an dem jemand
           schreibt: gedruckt wird zuerst, geschrieben danach. */
        const nochDa = await page.evaluate(() => {
            const s = window.SPDiag.stand();
            return !!(s && s.druck && s.druck.blaetter.length);
        });
        check('die Messung steht noch da, wenn das Formular aufgeht', () => {
            assert.ok(nochDa, 'die Messung ist mit dem Vorrat verschwunden');
        });

        /* ------------------------------------------ das Formular trägt sie */

        await page.evaluate(() => {
            const b = document.getElementById('spFeedback');
            if (b) b.click();
        });
        await sleep(400);
        const dialog = await page.evaluate(() => {
            const kasten = document.querySelector('#spSayTechnik');
            if (!kasten) return null;
            kasten.checked = true;
            const details = document.querySelector('.sp-say-vorschau');
            details.open = true;
            details.dispatchEvent(new Event('toggle'));
            return {
                vorschau: (document.querySelector('#spSayVorschau').textContent || '').slice(0, 4000),
                datei: !!document.querySelector('#spSayDatei')
            };
        });

        check('das Rückmeldeformular hat ein Kästchen für die Messwerte', () => {
            assert.ok(dialog, 'kein Kästchen im Formular');
            assert.ok(dialog.datei, 'kein Knopf für die Datei');
        });
        check('die Vorschau zeigt, was mitgeschickt wird', () => {
            assert.ok(dialog.vorschau.indexOf('Letzter Druck') > -1,
                'die Vorschau nennt den Druck nicht:\n' + dialog.vorschau);
            assert.ok(dialog.vorschau.indexOf('UA:') > -1, 'kein Browser in der Vorschau');
        });

        check('nichts ist unterwegs geworfen worden', () => {
            assert.deepStrictEqual(errs, [], 'geworfen: ' + errs.join(' | '));
        });

        console.log('\n' + passed + ' Prüfungen bestanden');
    } finally {
        await browser.close();
    }
})();
