/**
 * What the site actually stores while somebody uses it (Puppeteer).
 *
 * tests/test-autosave-nur-einstellungen.js reads the source and checks that
 * nothing dangerous carries `data-save`. This one types into real pages in a
 * real browser and looks at what ends up in localStorage, because the source
 * check can only see what it knows to look for: a field named `wifiPass` is
 * obvious, and the next one will be named something else.
 *
 * Three things are under test:
 *
 *   1. A secret typed into a tool is not stored. Before the change, both of
 *      these were: `autosave_/tools/qr-creator/_wifiPass` held the WiFi
 *      password, and `autosave_/tools/jwt-debugger/_signatureSecret` held the
 *      HMAC signing secret — which came straight back into the field on the
 *      next visit.
 *   2. A setting still is, because that is the whole point of keeping the
 *      feature rather than deleting it.
 *   3. The one-time clear-out really removes what the old rule left behind.
 *      A fix that only works going forward would leave those secrets sitting
 *      on the machines of everyone who already used the tools.
 */
const puppeteer = require('puppeteer');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

function fail(msg) {
    console.error('FAIL: ' + msg);
    process.exitCode = 1;
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/* Eingetippt, nicht per value gesetzt: die Speicherung hängt am
   input-Ereignis, und ein zugewiesenes .value löst keines aus. */
async function tippen(page, pfad, selektor, text, vorher) {
    await page.goto(BASE + pfad, { waitUntil: 'networkidle2' });
    await settle(900);
    if (vorher) await vorher(page);
    if (!(await page.$(selektor))) return null;
    await page.click(selektor, { clickCount: 3 }).catch(() => {});
    await page.type(selektor, text, { delay: 10 });
    await settle(800);          // die Speicherung wartet 300 ms
    return page.evaluate((t) => Object.entries(localStorage)
        .filter(([, wert]) => typeof wert === 'string' && wert.includes(t))
        .map(([schluessel]) => schluessel), text);
}

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
        const page = await browser.newPage();

        /* ---- 1. Geheimnisse und Inhalte bleiben draußen ---- */
        const geheim = [
            ['/tools/qr-creator/', '#wifiPass', 'GEHEIM-WLAN-PASSWORT',
                async (p) => { await p.select('#qrMode', 'wifi').catch(() => {}); await settle(400); }],
            ['/tools/jwt-debugger/', '#signatureSecret', 'GEHEIM-SIGNIERSCHLUESSEL'],
            ['/tools/markdown-editor/', '#mdInput', 'Vertraulicher Entwurf'],
            ['/tools/diff-checker/', '#inputOriginal', 'Vertraulicher Vertragstext'],
            ['/', '#toolSearch', 'wonach-ich-gesucht-habe'],
        ];
        for (const [pfad, selektor, text, vorher] of geheim) {
            const treffer = await tippen(page, pfad, selektor, text, vorher);
            if (treffer === null) {
                fail(`${pfad}${selektor} is not there any more — this test is checking nothing`);
                continue;
            }
            if (treffer.length) {
                fail(`${pfad}${selektor} was written to localStorage as ${treffer.join(', ')}. ` +
                    'Whatever someone types into a tool has to stay in the page.');
            }
        }

        /* ---- 2. Einstellungen werden gemerkt UND zurückgeladen ---- */
        //
        // Nur nachzusehen, ob ein Schlüssel entsteht, hat hier schon einmal
        // nichts gefangen: die erste Fassung schrieb alle 32 Einstellungen
        // und las keine zurück, und dieser Test war grün. Es zählt, was nach
        // dem Neuladen im Feld steht.
        for (const [pfad, selektor] of [
            ['/tools/image-resizer/', '#outputFormat'],
            ['/tools/lorem-generator/', '#format'],
            ['/tools/time-converter/', '#targetTz'],   // wird per Skript gefüllt
        ]) {
            await page.goto(BASE + pfad, { waitUntil: 'networkidle2' });
            await settle(1200);
            const anders = await page.evaluate((sel) => {
                const s = document.querySelector(sel);
                if (!s) return null;
                const w = [...s.options].map((o) => o.value).find((v) => v !== s.value);
                return w === undefined ? null : w;
            }, selektor);
            if (anders === null) {
                fail(`${pfad}${selektor} is not a dropdown with a second option any more`);
                continue;
            }
            await page.select(selektor, anders);
            await settle(700);

            await page.goto(BASE + pfad, { waitUntil: 'networkidle2' });
            await settle(1500);   // die per Skript gefüllte Auswahl braucht einen Moment
            const danach = await page.evaluate((sel) =>
                (document.querySelector(sel) || {}).value, selektor);
            if (danach !== anders) {
                fail(`${pfad}${selektor} was set to ${JSON.stringify(anders)} and came ` +
                    `back as ${JSON.stringify(danach)} — the setting is written to ` +
                    'localStorage and never read back, so the storage has no purpose ' +
                    'and the privacy policy claims one it does not have');
            }
        }

        /* ---- 3. Der Altbestand wird einmalig geräumt ---- */
        await page.evaluate(() => {
            localStorage.setItem('autosave_/tools/jwt-debugger/_signatureSecret', 'ALTLAST');
            localStorage.setItem('autosave_/tools/qr-creator/_wifiPass', 'ALTLAST');
            localStorage.removeItem('ll_autosave_bereinigt_v1');
        });
        await page.goto(BASE + '/', { waitUntil: 'networkidle2' });
        await settle(900);
        const uebrig = await page.evaluate(() => Object.entries(localStorage)
            .filter(([, wert]) => wert === 'ALTLAST').map(([k]) => k));
        if (uebrig.length) {
            fail('the one-time clear-out left old autosave keys behind: ' + uebrig.join(', ') +
                ' — every secret already stored on a visitor\'s machine would stay there');
        }

        if (!process.exitCode) {
            console.log('PASS: secrets and typed content are not stored, settings still are, ' +
                'and the old keys are cleared out');
        }
    } finally {
        await browser.close();
    }
})().catch((err) => {
    console.error('FAIL: ' + err.message);
    process.exit(1);
});
