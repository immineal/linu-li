/**
 * That the JSON tools actually parse something, in a real browser.
 *
 * The tool hands the parsing to a Web Worker, so nothing about it can be
 * checked without one — jsdom has no Worker, and the tree view stays empty
 * until the worker answers. That is what this covers, and it is the only
 * reason it needs a browser and a server.
 *
 * Two things about it were wrong for as long as it existed, and they hid
 * each other:
 *
 *   1. It asserted nothing. It printed `Tree Box contains a: false` and
 *      exited 0, so a red result read exactly like a green one and CI could
 *      not tell them apart.
 *   2. It asked for /tools/json-tools/index.html. `npx serve` answers that
 *      with a 301 to /tools/json-tools — no trailing slash — and from there
 *      the tool's own `new Worker('./worker.js')` resolves one directory too
 *      high, to /tools/worker.js, which does not exist. The worker never
 *      started, so the result box stayed empty and so did the tree.
 *
 * The tool itself was never broken: at /tools/json-tools/ it parses and
 * renders. Apache serves the directory without moving the address, so this
 * only ever happened under the dev server the tests use. Asking for the
 * directory is also what a visitor's browser asks for, which is the better
 * reason to do it.
 */
const assert = require('assert');
const puppeteer = require('puppeteer');

const BASIS = 'http://localhost:3000';

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
        const page = await browser.newPage();
        const fehlgeschlagen = [];
        page.on('requestfailed', (r) => fehlgeschlagen.push(r.url()));

        const ziel = `${BASIS}/tools/json-tools/`;
        await page.goto(ziel, { waitUntil: 'networkidle0' });

        /* Kommt die Seite woanders an, rechnet der Worker-Pfad von dort aus
           weiter und die Prüfung darunter misst etwas anderes als gedacht. */
        assert.strictEqual(page.url(), ziel,
            `the server moved the address to ${page.url()} — relative paths in the ` +
            'page, the worker among them, resolve from there and not from the directory');

        await page.evaluate(() => {
            document.getElementById('jsonInput').value = '{"a": 1}';
            document.getElementById('processBtn').click();
        });
        await page.waitForFunction(
            () => document.getElementById('resultBox').innerText.trim().length > 0,
            { timeout: 10000 },
        ).catch(() => {
            throw new Error('the result box stayed empty — the worker never answered. ' +
                'Requests that failed: ' + (fehlgeschlagen.join(', ') || 'none'));
        });

        const formatiert = await page.evaluate(
            () => document.getElementById('resultBox').innerText);
        assert.ok(formatiert.includes('"a"'),
            `the formatted output does not carry the key that went in: ${JSON.stringify(formatiert)}`);

        await page.evaluate(() => document.getElementById('viewTreeBtn').click());
        await page.waitForFunction(
            () => document.getElementById('treeBox').children.length > 0,
            { timeout: 5000 },
        ).catch(() => {
            throw new Error('the tree view stayed empty after the parse succeeded');
        });

        const baum = await page.evaluate(
            () => document.getElementById('treeBox').innerHTML);
        assert.ok(baum.includes('"a"'),
            'the tree renders but does not show the key that went in');

        assert.deepStrictEqual(fehlgeschlagen, [],
            'requests failed while the page was working: ' + fehlgeschlagen.join(', '));

        console.log('PASS: json-tools parses in its worker and renders the tree');
    } finally {
        await browser.close();
    }
})().catch((err) => {
    console.error('FAIL: ' + err.message);
    process.exit(1);
});
