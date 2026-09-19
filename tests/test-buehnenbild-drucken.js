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

        /* Vor jedem Druck gelesen: die Regel muss schon dastehen, wenn
           niemand etwas gedruckt hat. */
        const seitenmass = await page.evaluate(() => {
            const el = document.getElementById('spPageStyle');
            return el ? el.textContent : null;
        });

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
            /* Mit der Größe, nicht nur mit der Stückzahl: die Frage, die das
               beantwortet, lautet „ist der fehlende Text der kleinste auf dem
               Blatt“, und die ist mit einer Anzahl nicht zu beantworten. */
            const eins = andere[Object.keys(andere)[0]];
            assert.strictEqual(typeof eins, 'object', 'nur gezählt, nicht gemessen');
            assert.ok(eins.n > 0, 'keine Stückzahl');
            assert.ok(typeof eins.min === 'number' && eins.min > 0,
                'keine Größe: ' + JSON.stringify(eins));
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

        const schriften = await page.evaluate(() => {
            const out = { klein: [], gesetzt: [], anzahl: 0 };
            document.querySelectorAll('#spPrintPortal text').forEach((el) => {
                out.anzahl += 1;
                const fs = parseFloat(el.getAttribute('font-size'));
                if (!(fs >= 1)) out.klein.push((el.getAttribute('class') || '?') + ' ' + fs);
                let s = null;
                try {
                    const m = el.getScreenCTM();
                    if (m) s = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c));
                } catch (err) { /* dann eben nicht */ }
                if (s) out.gesetzt.push(fs * s);
            });
            return out;
        });

        const ueberzug = await (async () => {
            await page.emulateMediaType('print');
            const r = await page.evaluate(() => {
                const cs = getComputedStyle(document.body, '::after');
                return { display: cs.display, content: cs.content };
            });
            await page.emulateMediaType('screen');
            return r;
        })();

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

        /* ---------------------------------------- das Maß der Seite */

        check('die Seitengröße steht in der Seite, bevor jemand druckt', () => {
            /* Sie stand früher nur im beforeprint-Zuhörer, also in dem
               Moment, in dem der Browser die Seiten schon einteilt. In dem
               PDF, das die Meldung ausgelöst hat, sind alle sieben Seiten
               Hochformat, obwohl jedes Blatt darin quer liegt — der Plan lag
               zusammengeschoben in der oberen Hälfte. */
            assert.ok(seitenmass, 'keine @page-Regel in der Seite');
            assert.ok(/@page\s*\{[^}]*size:\s*A4\s+(landscape|portrait)/.test(seitenmass),
                'die Regel nennt kein Format: ' + seitenmass);
            assert.ok(/margin:\s*0/.test(seitenmass),
                'ohne Rand null passt das Blatt nicht auf die Seite: ' + seitenmass);
        });

        /* ------------------------------ was Safari mit auf das Papier nimmt */

        /* Der Fehler, um den es die ganze Zeit ging. Auf einem Mac kam der
           Grundriss als PDF ohne einen einzigen Buchstaben heraus — keine
           Requisitennamen, kein Textfeld, keine Maßstabszahl, die
           Zeichnungen vollständig. Im PDF (Quartz, macOS 15.7.9) stand als
           Text nur, was aus dem HTML daneben kam. Der Unterschied war die
           Schriftgröße im Markup: im Grundriss rechnet alles in
           Bühnenmetern, dort stand font-size="0.116". */

        check('kein Text auf dem Blatt ist kleiner als eine Einheit gesetzt', () => {
            assert.ok(schriften.anzahl > 0, 'kein Text im Vorrat — dann prüft das hier nichts');
            assert.deepStrictEqual(schriften.klein, [],
                'in Bruchteilen einer Einheit gesetzt, das lässt Safari beim Drucken weg');
        });

        check('die Schrift landet trotzdem in derselben Größe auf dem Blatt', () => {
            /* Vergrößert und im selben Zug verkleinert. Käme hier etwas
               anderes heraus, wäre der Plan verstellt statt repariert. */
            const klein = Math.min.apply(null, schriften.gesetzt);
            const gross = Math.max.apply(null, schriften.gesetzt);
            assert.ok(klein > 2 && gross < 60,
                'die gesetzten Größen liegen bei ' + klein.toFixed(2) + '–' + gross.toFixed(2) + ' px');
        });

        check('die Papierstruktur der Seite kommt nicht mit auf das Blatt', () => {
            /* body::after liegt fest positioniert über der ganzen Seite. Am
               Bildschirm sieht man sie kaum; im PDF desselben Macs war sie
               ein Verlauf über die ganze Seite und die untere Hälfte jeder
               Planseite kam schwarz heraus. */
            assert.strictEqual(ueberzug.display, 'none',
                'der Überzug steht noch auf der Druckseite');
        });

        /* ------------------------------- und wenn niemand gedruckt hat */

        /* Der Grund für diese Prüfung ist eine Datei, die wirklich ankam.
           Sie war vollständig bis auf die eine Stelle, um die es ging: dort
           stand „Letzter Druck: keiner“. Die Reihenfolge — erst drucken,
           dann schreiben — war die einzige Bedingung, und sie hat beim
           ersten Versuch nicht gehalten. Jetzt misst der Planer selbst, und
           das muss in einem frischen Reiter gelten, in dem nie gedruckt
           wurde. */
        const frisch = await browser.newPage();
        const frischErrs = [];
        frisch.on('pageerror', (e) => frischErrs.push(e.message));
        await frisch.goto(`${BASE}/tools/buehnenbild/`, { waitUntil: 'networkidle2' });
        await sleep(2500);
        await frisch.evaluate(() => {
            const b = document.querySelector('[data-choose="example"]');
            if (b) b.click();
        });
        await sleep(1200);

        const schonGemessen = await frisch.evaluate(() => {
            const st = window.SPDiag.stand();
            return !!(st && st.druck);
        });
        check('im frischen Reiter ist noch nichts gemessen', () => {
            assert.ok(!schonGemessen, 'da liegt schon eine Messung — dann prüft das hier nichts');
        });

        await frisch.evaluate(() => {
            const b = document.getElementById('spFeedback');
            if (b) b.click();
        });
        await sleep(400);
        const ohneDruck = await frisch.evaluate(() => {
            const kasten = document.querySelector('#spSayTechnik');
            if (!kasten) return null;
            kasten.checked = true;
            const details = document.querySelector('.sp-say-vorschau');
            details.open = true;
            details.dispatchEvent(new Event('toggle'));
            const portal = document.getElementById('spPrintPortal');
            return {
                vorschau: document.querySelector('#spSayVorschau').textContent || '',
                vorratLeer: portal.innerHTML === '' && portal.hidden
            };
        });

        check('ohne Druck misst der Planer selbst', () => {
            assert.ok(ohneDruck, 'kein Kästchen im Formular');
            assert.ok(/ausgemessen ohne Druckdialog/.test(ohneDruck.vorschau),
                'niemand hat gemessen:\n' + ohneDruck.vorschau.slice(0, 1200));
            assert.ok(/sp-mark-text/.test(ohneDruck.vorschau),
                'kein Textfeld in der Messung:\n' + ohneDruck.vorschau.slice(0, 1200));
            assert.ok(ohneDruck.vorschau.indexOf('NaN') === -1, 'NaN im Bericht');
        });

        check('die Messung sagt, dass sie vom Bildschirm kommt', () => {
            /* Misst ein Browser beim Drucken anders als beim Anzeigen, ist
               genau das der Fehler. Eine Messung, die nicht sagt, woher sie
               kommt, führt dann in die Irre. */
            assert.ok(/Am Bildschirm gemessen/.test(ohneDruck.vorschau),
                'die Vorschau verschweigt, woher die Zahlen kommen');
        });

        check('der Vorrat bleibt danach leer', () => {
            assert.ok(ohneDruck.vorratLeer,
                'die Blätter stehen noch in der Seite — das verschiebt das Layout');
        });

        check('nichts ist unterwegs geworfen worden', () => {
            assert.deepStrictEqual(errs.concat(frischErrs), [],
                'geworfen: ' + errs.concat(frischErrs).join(' | '));
        });

        console.log('\n' + passed + ' Prüfungen bestanden');
    } finally {
        await browser.close();
    }
})();
