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
 * The prompt now appears the moment the new worker enters the waiting state:
 * no idle timer, no click-a-link trigger. That is what visitors expect from a
 * button called Reload, and the earlier design — 30 seconds on the page plus
 * 90 without input — meant that anyone who reloaded a handful of times to see
 * a fresh deploy got the new files without ever seeing the note that said
 * what changed. The test drives that direct path and reads the whole of
 * `fragen()` on the way through.
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

        spur('Hinweis sofort da?');
        /* ---- der Hinweis meldet sich, sobald der neue Worker wartet ---- */
        await page.waitForSelector('.ll-update', { timeout: 4000 }).catch(() => {});
        if (!(await page.$('.ll-update'))) {
            fail('the prompt did not appear after the new worker started waiting — the ' +
                'point of this design is that a Reload button is the first thing a ' +
                'returning visitor sees when there is a new version to offer');
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

        spur('Spaeter');
        /* ---- „Später"/Escape schließt den Hinweis; die Seite fragt nicht noch mal ---- */
        await page.keyboard.press('Escape');
        await settle(600);
        if (await page.$('.ll-update')) {
            fail('Escape did not close the prompt — it is modal, so there has to be a ' +
                'way out that is not a button');
            return;
        }

        /* Weder Klick noch Navigation hat den Hinweis ausgelöst — er lag am
           Standby-Worker allein. Nach dem Schließen bleibt die Seite auf ihrer
           URL, weil kein `danach` mitzuschleppen war. */
        if (await page.evaluate(() => window.location.pathname.includes('case-converter'))) {
            fail('Escape navigated the visitor somewhere they did not click for');
            return;
        }

        /* ---- ein weiterer Deploy, neuer Reiter, und dann „Neu laden" ----
           Nach einem zweiten Deploy erwartet der neue Reiter den Hinweis
           genauso sofort wie beim ersten. */
        ausliefern(vorlage, 'ccccccc',
            ['Der erste Satz.', 'Die Gasse fällt als Bühnenform weg.', 'Und noch etwas.']);

        await page.goto(BASE + '/tools/word-counter/', { waitUntil: 'networkidle2' });
        await settle(2500);
        if (!(await page.evaluate(async () =>
            !!(await navigator.serviceWorker.getRegistration())?.waiting))) {
            fail('a further deploy produced no waiting worker');
            return;
        }
        await page.waitForSelector('.ll-update', { timeout: 4000 }).catch(() => {});
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
            console.log('PASS: the prompt appears the moment a new worker waits, says ' +
                'what changed, hands over on "reload", and leaves the other tab alone');
        }
    } finally {
        fs.writeFileSync(SW, vorlage);
        await browser.close();
    }
})().catch((err) => {
    console.error('FAIL: ' + err.message);
    process.exit(1);
});
