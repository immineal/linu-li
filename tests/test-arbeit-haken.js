/**
 * A tool that is holding something says so before a reload (Puppeteer).
 *
 * The update prompt's "Reload" button throws away everything in memory: the
 * PDF someone picked, the image being cropped, the text they were part-way
 * through. Tools that hold such a thing announce it with
 * `window.llHaeltArbeit`, and the prompt then asks a second time.
 *
 * The default is the safe one for the site but the unsafe one for a tool
 * that forgets: no hook means "nothing to lose", so a new tool with a file
 * input would quietly discard the file with no second question. That is the
 * mistake this test exists to prevent, and it is the same shape as the one
 * `tests/test-published-files.js` prevents — it works out for itself which
 * tools need the hook rather than keeping a list that would go stale.
 *
 * It also calls the hook on a freshly loaded page. Declaring one is easy;
 * declaring one that reads a variable which is not in scope is just as easy,
 * and the failure is invisible — layout.js catches the error and treats it as
 * "nothing held", which is exactly the answer the hook was added to avoid.
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

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/* Werkzeuge, die Dateien entgegennehmen — per Feld oder per Ziehen. */
function brauchtHaken() {
    const raus = [];
    for (const name of fs.readdirSync(path.join(ROOT, 'tools')).sort()) {
        const p = path.join(ROOT, 'tools', name, 'index.html');
        if (!fs.existsSync(p)) continue;
        const html = fs.readFileSync(p, 'utf8');
        const nimmtDateien = /type=["']file["']/.test(html) ||
            /\b(dragover|setupDropZone)\b/.test(html);
        if (nimmtDateien) raus.push(name);
    }
    return raus;
}

function hatHaken(name) {
    return /window\.llHaeltArbeit\s*=/.test(
        fs.readFileSync(path.join(ROOT, 'tools', name, 'index.html'), 'utf8'));
}

(async () => {
    const noetig = brauchtHaken();
    const ohne = noetig.filter((n) => !hatHaken(n));
    if (ohne.length) {
        fail('these tools take files but never say whether they are holding one, so ' +
            '"Reload" in the update prompt would discard it without asking: ' +
            ohne.join(', ') + '. Set window.llHaeltArbeit at the end of the tool\'s ' +
            'script block.');
    }

    /* Und jetzt jeden Haken wirklich aufrufen. */
    const alle = fs.readdirSync(path.join(ROOT, 'tools')).sort()
        .filter((n) => fs.existsSync(path.join(ROOT, 'tools', n, 'index.html')))
        .filter(hatHaken);

    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
        const page = await browser.newPage();
        for (const name of alle) {
            await page.goto(`${BASE}/tools/${name}/`, { waitUntil: 'networkidle2' });
            await settle(400);
            const ergebnis = await page.evaluate(() => {
                if (typeof window.llHaeltArbeit !== 'function') return { fehlt: true };
                try { return { wert: !!window.llHaeltArbeit() }; }
                catch (err) { return { wirft: String(err.message || err) }; }
            });

            if (ergebnis.fehlt) {
                fail(`${name}: llHaeltArbeit is in the source but not on the page — the ` +
                    'assignment sits in a scope that never runs, or the script threw first');
            } else if (ergebnis.wirft) {
                fail(`${name}: llHaeltArbeit throws (${ergebnis.wirft}). layout.js catches ` +
                    'that and reads it as "holding nothing", so the tool would lose its ' +
                    'file without a word. The variable is probably out of scope where the ' +
                    'hook was written.');
            } else if (ergebnis.wert !== false) {
                fail(`${name}: llHaeltArbeit says the tool is holding work on a page nobody ` +
                    'has touched yet. It would ask a pointless question on every reload, ' +
                    'and a question that is always asked stops being read. Check whether ' +
                    'something is prefilled at load.');
            }
        }

        /* Ein Haken, der immer false sagt, ist so gut wie keiner — und genau
           so sieht er aus, solange niemand etwas eingibt. Also: etwas
           eingeben und nachsehen, ob er umspringt. Stichproben über die drei
           Arten, wie ein Werkzeug etwas hält. */
        const proben = [
            ['word-counter', async (p) => { await p.type('#textInput', 'etwas Arbeit'); }],
            ['diff-checker', async (p) => { await p.type('#inputOriginal', 'links'); }],
            ['json-tools', async (p) => { await p.type('#jsonInput', '{"a":1}'); }],
            ['hash-generator', async (p) => {
                const feld = await p.$('#fileInput');
                await feld.uploadFile(path.join(__dirname, 'dummy.pdf'));
            }],
            ['pdf-splitter', async (p) => {
                const feld = await p.$('#fileInput');
                await feld.uploadFile(path.join(__dirname, 'dummy.pdf'));
            }],
            /* Zwei mit Vorbelegung: sie dürfen erst ja sagen, wenn wirklich
               etwas dazugekommen ist, nicht schon wegen des Beispiels. */
            ['sql-formatter', async (p) => { await p.type('#inputSql', ' AND 1=1'); }],
            ['qr-creator', async (p) => { await p.type('#qrInput', 'etwas anderes'); }],
        ];

        for (const [name, arbeiten] of proben) {
            await page.goto(`${BASE}/tools/${name}/`, { waitUntil: 'networkidle2' });
            await settle(600);
            try { await arbeiten(page); } catch (err) {
                fail(`${name}: could not put work into the tool for the test — ${err.message}`);
                continue;
            }
            await settle(1200);
            const haelt = await page.evaluate(() => {
                try { return !!window.llHaeltArbeit(); } catch (err) { return 'wirft: ' + err.message; }
            });
            if (haelt !== true) {
                fail(`${name}: something was put into the tool and llHaeltArbeit still says ` +
                    `${JSON.stringify(haelt)}. A hook that never says yes is the same as no ` +
                    'hook — the work would be discarded without a second question.');
            }
        }

        if (!process.exitCode) {
            console.log(`PASS: ${alle.length} tools report whether they are holding work, ` +
                `all ${noetig.length} that take files are among them, and ${proben.length} ` +
                'flip to yes when given something to hold');
        }
    } finally {
        await browser.close();
    }
})().catch((err) => {
    console.error('FAIL: ' + err.message);
    process.exit(1);
});
