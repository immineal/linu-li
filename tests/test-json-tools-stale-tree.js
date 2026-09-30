/**
 * JSON Workbench — stale tree/data after an error.
 *
 * QA: format good JSON, paste broken JSON, click Format. The error shows up,
 * but switching to Tree renders the OLD tree; Copy/Download still pull the
 * old value; JSONPath filters the old value. Everything that reads
 * currentData has to be locked until the next successful parse.
 */
const assert = require('assert');
const puppeteer = require('puppeteer');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
        const page = await browser.newPage();
        await page.goto(BASE + '/tools/json-tools/', { waitUntil: 'networkidle0' });

        // 1. Good JSON → tree renders.
        await page.evaluate(() => {
            document.getElementById('jsonInput').value = '{"a": 1}';
            document.getElementById('processBtn').click();
        });
        await page.waitForFunction(
            () => document.getElementById('resultBox').innerText.trim().length > 0,
            { timeout: 10000 }
        );

        // Switch to tree once so it actually renders.
        await page.click('#viewTreeBtn');
        await page.waitForFunction(
            () => document.getElementById('treeBox').children.length > 0,
            { timeout: 5000 }
        );

        // Back to code view before the broken parse.
        await page.click('#viewCodeBtn');

        // 2. Break the input and reparse.
        await page.evaluate(() => {
            document.getElementById('jsonInput').value = '{"a": 1';
            document.getElementById('processBtn').click();
        });
        await page.waitForFunction(
            () => document.getElementById('statusText').textContent.startsWith('Invalid JSON'),
            { timeout: 5000 }
        );

        // 3. The tree must not still show yesterday's data.
        const treeChildren = await page.evaluate(
            () => document.getElementById('treeBox').children.length
        );
        assert.strictEqual(treeChildren, 0,
            `tree was not cleared on error — it still has ${treeChildren} child(ren)`);

        // 4. Clicking Tree while data is stale must not rebuild the old tree.
        await page.click('#viewTreeBtn');
        const stillEmpty = await page.evaluate(
            () => document.getElementById('treeBox').children.length
        );
        assert.strictEqual(stillEmpty, 0,
            `switching to tree after an error rebuilt the stale tree (${stillEmpty} children)`);

        // 5. Copy/Download/JSONPath/CSV should be disabled while data is stale.
        const state = await page.evaluate(() => ({
            copy: document.getElementById('copyBtn').disabled,
            download: document.getElementById('downloadBtn').disabled,
            csv: document.getElementById('csvBtn').disabled,
            jsonpath: document.getElementById('jsonPathInput').disabled,
            tree: document.getElementById('viewTreeBtn').disabled,
        }));
        assert.ok(state.copy, 'copy button should be disabled after error');
        assert.ok(state.download, 'download button should be disabled after error');
        assert.ok(state.csv, 'csv button should be disabled after error');
        assert.ok(state.jsonpath, 'jsonpath input should be disabled after error');
        assert.ok(state.tree, 'tree view button should be disabled after error');

        console.log('PASS: json-tools stale-tree lockout');
    } finally {
        await browser.close();
    }
})().catch((err) => {
    console.error('FAIL: ' + err.message);
    process.exit(1);
});
