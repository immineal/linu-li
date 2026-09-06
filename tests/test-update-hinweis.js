/**
 * "A new version is ready" — the prompt, end to end (Puppeteer).
 *
 * The worker no longer takes over on its own (sw.js has no skipWaiting any
 * more), so this prompt is the only thing that hands a running tab the new
 * code. If it stops appearing, nothing breaks and nothing complains: visitors
 * simply keep running whatever they had until they close every tab.
 *
 * The test deploys twice, by hand. A deploy is two substitutions in sw.js —
 * the commit into DEPLOY_SHA, the sentences into DEPLOY_NOTES — so a fake one
 * is two string replacements, and the browser cannot tell the difference: it
 * sees a file whose bytes changed and fetches a new worker.
 *
 * It drives the click-a-link trigger rather than the idle timer, because the
 * idle path deliberately waits 30 seconds on the page plus 90 without input,
 * and a test that takes two minutes gets skipped. Both paths end in the same
 * `fragen()`, so what runs here is the whole of it apart from the clock.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const SW = path.join(__dirname, '..', 'sw.js');

function fail(msg) {
    console.error('FAIL: ' + msg);
    process.exitCode = 1;
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/* Nach jedem Schritt, der die Seite wegschickt, muss auf die Navigation
   gewartet werden. Eine Auswertung, die mittendrin läuft, hängt bis zum
   Protokoll-Zeitablauf und reißt den ganzen Lauf mit. */
const angekommen = (p) => p.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20_000 })
    .catch(() => {});
const SPUR = process.env.LL_SPUR === '1';
let schritt = 0;
const spur = (was) => { if (SPUR) console.log('  [%d] %s', ++schritt, was); };

/* Was der Deploy tut: den Stand und die Sätze einsetzen. */
function ausliefern(vorlage, sha, saetze) {
    fs.writeFileSync(SW, vorlage
        .replace('__DEPLOY_SHA__', sha)
        .replace('[/* __DEPLOY_NOTES__ */]', JSON.stringify(saetze)));
}

(async () => {
    const vorlage = fs.readFileSync(SW, 'utf8');
    if (!vorlage.includes('__DEPLOY_SHA__') || !vorlage.includes('__DEPLOY_NOTES__')) {
        fail('sw.js is not in its undeployed state — cannot fake a deploy from it');
        return;
    }

    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        /* Die Seite navigiert mitten im Test von selbst (das ist der Punkt).
           Eine Auswertung, die dabei ins Leere läuft, soll aufgeben und nicht
           den ganzen Lauf mit einem Protokollfehler abbrechen. */
        protocolTimeout: 60_000,
    });

    try {
        const page = await browser.newPage();
        page.on('dialog', (d) => d.accept());

        /* Ein zweiter Reiter, der offen bleibt.
           Ohne ihn übernimmt der wartende Worker, sobald der erste Reiter
           wegnavigiert — kein Client mehr übrig, also aktiviert er sich von
           selbst. Das ist richtig so, macht aber alles unbeobachtbar, was
           nach der ersten Navigation kommt. Zwei offene Reiter sind
           obendrein der Fall, den es zu prüfen lohnt: der zweite darf nicht
           mitgerissen werden. */
        const nebenan = await browser.newPage();

        spur('erster Stand');
        /* ---- erster Stand ---- */
        ausliefern(vorlage, 'aaaaaaa', ['Der erste Satz.']);
        await page.goto(BASE + '/tools/word-counter/', { waitUntil: 'networkidle2' });
        await page.evaluate(() => navigator.serviceWorker.ready).catch(() => {});
        await settle(1200);
        await page.reload({ waitUntil: 'networkidle2' });
        await settle(1200);
        if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
            fail('no worker took control — nothing under test');
            return;
        }

        spur('zweiter Reiter');
        await nebenan.goto(BASE + '/tools/case-converter/', { waitUntil: 'networkidle2' });
        await nebenan.evaluate(() => { window.__llNochDa = true; });
        await settle(600);

        spur('zweiter Stand');
        /* ---- zweiter Stand: derselbe Weg, den ein Deploy geht ---- */
        ausliefern(vorlage, 'bbbbbbb', ['Der erste Satz.', 'Die Gasse fällt als Bühnenform weg.']);
        // Der Browser sieht das neue sw.js beim nächsten Seitenaufruf.
        await page.goto(BASE + '/tools/word-counter/', { waitUntil: 'networkidle2' });
        await settle(2500);

        spur('wartet?');
        const wartet = await page.evaluate(async () =>
            !!(await navigator.serviceWorker.getRegistration())?.waiting);
        if (!wartet) {
            fail('the new worker did not install and wait — either sw.js is byte-identical ' +
                'across the two deploys, or skipWaiting is back');
            return;
        }

        /* Vor dem Klick darf nichts im Weg stehen. */
        if (await page.$('.ll-update')) {
            fail('the prompt appeared without being asked for — it must wait for an ' +
                'internal link or for the visitor to go idle');
            return;
        }

        spur('in Ruhe lassen');
        /* ---- was der Hinweis in Ruhe lassen muss ---- */
        //
        // Der Abfangjäger ruft preventDefault auf seiteneigenen Links. Alles,
        // was der Browser anders behandelt als eine gewöhnliche Navigation,
        // muss daran vorbeigehen. Bei Strg-Klick hieß das einmal: kein neuer
        // Reiter, dafür navigierte der alte weg — mitsamt der Arbeit darin,
        // ohne Rückfrage, weil der Arbeits-Haken nur am Knopf hängt.
        //
        // Gemessen wird am Ereignis, nicht an der Navigation: ein echter Klick
        // auf mailto: oder auf einen Download lässt den Browser auf einen
        // Protokoll-Handler bzw. einen Speichern-Dialog warten, und der Test
        // hängt (einmal ausprobiert, 400 s lang nichts). Ein zweiter Zuhörer,
        // nach dem von layout.js registriert, liest ab, ob dort schon
        // abgefangen wurde, und unterbindet dann die Navigation.
        await page.evaluate(() => {
            document.body.insertAdjacentHTML('beforeend', `
                <a id="ll-t-normal" href="/tools/case-converter/">normal</a>
                <a id="ll-t-anker" href="#irgendwo">Anker</a>
                <a id="ll-t-mail" href="mailto:x@example.com">Mail</a>
                <a id="ll-t-ziel" href="/tools/case-converter/" target="_new">Ziel</a>
                <a id="ll-t-laden" href="/tests/dummy.pdf" download>Laden</a>`);
            document.addEventListener('click', (e) => {
                window.__llAbgefangen = e.defaultPrevented;
                e.preventDefault();
            }, false);
        });

        const klick = (id, opt) => page.evaluate((eid, o) => {
            window.__llAbgefangen = null;
            document.getElementById(eid).dispatchEvent(new MouseEvent('click',
                Object.assign({ bubbles: true, cancelable: true, button: 0 }, o)));
            return window.__llAbgefangen;
        }, id, opt);

        const inRuhe = [
            ['ll-t-normal', { ctrlKey: true }, 'a ctrl-click'],
            ['ll-t-normal', { shiftKey: true }, 'a shift-click'],
            ['ll-t-normal', { metaKey: true }, 'a cmd-click'],
            ['ll-t-normal', { button: 1 }, 'a middle-click'],
            ['ll-t-anker', {}, 'a link to an anchor on the same page'],
            ['ll-t-mail', {}, 'a mailto: link'],
            ['ll-t-ziel', {}, 'a link with target="_new"'],
            ['ll-t-laden', {}, 'a download link'],
        ];
        for (const [id, wie, was] of inRuhe) {
            const abgefangen = await klick(id, wie);
            if (abgefangen !== false) {
                fail(`${was} was intercepted (defaultPrevented=${abgefangen}). Everything ` +
                    'the browser handles differently from an ordinary navigation has to ' +
                    'pass through untouched — otherwise the tab that holds the work ' +
                    'navigates away without anyone being asked.');
                return;
            }
        }

        spur('gewoehnlicher Klick');
        /* ---- derselbe Klick, gewöhnlich: der muss den Hinweis holen ----
           Nicht wegnavigieren zwischen den beiden Teilen: sobald kein Reiter
           der Seite mehr offen ist, übernimmt der wartende Worker von selbst,
           und danach gibt es nichts mehr anzubieten. (Einmal so gebaut, und
           der Test meldete, der Hinweis erscheine nicht mehr.) */
        if ((await klick('ll-t-normal', {})) !== true) {
            fail('an ordinary click on an internal link was not intercepted — the checks ' +
                'above would then prove nothing, and a tab left open would never be ' +
                'offered the new version');
            return;
        }
        await settle(1500);

        const dialog = await page.$('.ll-update');
        if (!dialog) {
            fail('the click was intercepted but no prompt came up');
            return;
        }

        const text = await page.evaluate(() => document.querySelector('.ll-update').innerText);
        if (!text.includes('Die Gasse fällt als Bühnenform weg.')) {
            fail(`the prompt does not name what changed: ${JSON.stringify(text)}`);
        }
        if (text.includes('Der erste Satz.')) {
            fail('the prompt repeats a sentence from the version already running — only ' +
                'what is new since the visitor\'s own version belongs in there');
        }
        if (await page.evaluate(() => window.location.pathname.includes('case-converter'))) {
            fail('the link went through while the prompt was up');
        }

        spur('Spaeter');
        /* ---- „Später": der Klick geht durch, und diese Seite fragt nicht nochmal ---- */
        spur('7a Escape gleich');
        const weg = angekommen(page);
        await page.keyboard.press('Escape');
        await weg;
        spur('7b navigiert');
        await settle(800);
        if (await page.$('.ll-update')) {
            fail('Escape did not close the prompt — it is modal, so there has to be a ' +
                'way out that is not a button');
            return;
        }
        spur('7c Dialog weg');
        if (!(await page.evaluate(() => window.location.pathname.includes('case-converter')))) {
            fail('dismissing the prompt swallowed the link that triggered it — the ' +
                'visitor clicked to go somewhere and ended up nowhere');
            return;
        }

        /* Zurück auf eine Seite mit wartendem Worker, und noch einmal klicken:
           dieselbe Seite darf nicht ein zweites Mal fragen. */
        /* ---- ein weiterer Deploy, und dann „Neu laden" ----
           Nach dem Wegklicken ist kein Worker mehr am Warten: die Seite hat
           navigiert, und ein wartender Worker übernimmt, sobald er darf. Das
           ist richtig so — es heißt nur, dass „Später" in der Praxis fast
           immer schon beim nächsten Seitenwechsel eingelöst wird. Dass es
           *diese* Seite betrifft und nicht den Browser, steht als Variable im
           Code (`schonGefragt`), nicht im Speicher; hier ist es nicht
           beobachtbar, weil der Fall nicht eintritt.
           Für den letzten Teil also ein dritter Stand. */
        ausliefern(vorlage, 'ccccccc',
            ['Der erste Satz.', 'Die Gasse fällt als Bühnenform weg.', 'Und noch etwas.']);

        await page.goto(BASE + '/tools/word-counter/', { waitUntil: 'networkidle2' });
        await settle(2500);
        if (!(await page.evaluate(async () =>
            !!(await navigator.serviceWorker.getRegistration())?.waiting))) {
            fail('a further deploy produced no waiting worker');
            return;
        }

        await page.evaluate(() => {
            const a = document.createElement('a');
            a.href = '/tools/case-converter/';
            a.id = 'll-test-link';
            a.textContent = 'weiter';
            document.body.appendChild(a);
            document.addEventListener('click', (e) => e.preventDefault(), false);
        });
        await page.evaluate(() => document.getElementById('ll-test-link').dispatchEvent(
            new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
        await settle(1500);
        if (!(await page.$('.ll-update'))) {
            fail('the prompt did not come up after a further deploy');
            return;
        }

        spur('Neu laden');
        /* ---- „Neu laden" tauscht den Worker und lädt neu ---- */
        const weg3 = angekommen(page);
        await page.evaluate(() =>
            document.querySelector('.ll-update [data-tun="jetzt"]').click());
        await weg3;
        await settle(1500);

        const jetzt = await page.evaluate(async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            return { wartet: !!reg?.waiting, dialogDa: !!document.querySelector('.ll-update') };
        });
        if (jetzt.wartet) fail('after "reload" the new worker is still waiting');
        if (jetzt.dialogDa) fail('the prompt is still on screen after "reload"');

        spur('Nachbar pruefen');
        /* Der Nachbarreiter darf von alldem nichts abbekommen haben. */
        const nachbarIntakt = await nebenan.evaluate(() => window.__llNochDa === true);
        if (!nachbarIntakt) {
            fail('the second tab reloaded along with the first — nobody there pressed ' +
                'anything, and whatever was open in it is gone');
        }

        if (!process.exitCode) {
            console.log('PASS: the prompt keeps out of the way, says what changed, hands ' +
                'over on "reload", and leaves the other tab alone');
        }
    } finally {
        fs.writeFileSync(SW, vorlage);
        await browser.close();
    }
})().catch((err) => {
    console.error('FAIL: ' + err.message);
    process.exit(1);
});
