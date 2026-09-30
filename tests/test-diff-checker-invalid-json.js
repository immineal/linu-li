/**
 * Diff Checker — invalid JSON must not leave a stale diff on screen.
 *
 * QA: switch to JSON mode, compare two valid documents (diff appears), then
 * put broken JSON on the right and click Compare. The error toast fires,
 * but the previous diff stays visible, so the tool looks like it worked.
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
        await page.goto(BASE + '/tools/diff-checker/', { waitUntil: 'networkidle0' });

        // 1. Two valid documents in JSON mode → diff appears.
        await page.evaluate(() => {
            document.getElementById('inputOriginal').value = '{"a":1}';
            document.getElementById('inputChanged').value = '{"a":2}';
            document.getElementById('diffMode').value = 'json';
            document.getElementById('compareBtn').click();
        });
        await page.waitForFunction(
            () => !document.getElementById('resultBox').classList.contains('hidden'),
            { timeout: 10000 }
        );
        const rowsBefore = await page.evaluate(
            () => document.getElementById('diffTableBody').querySelectorAll('tr').length
        );
        assert.ok(rowsBefore > 0, `first compare should produce rows; got ${rowsBefore}`);

        // 2. Break the right side and compare again.
        await page.evaluate(() => {
            document.getElementById('inputChanged').value = '{"a":2';
            document.getElementById('compareBtn').click();
        });
        // The synchronous JSON-parse guard hides the result box straight away.
        await new Promise((r) => setTimeout(r, 200));

        const stillVisible = await page.evaluate(
            () => !document.getElementById('resultBox').classList.contains('hidden')
        );
        assert.ok(!stillVisible,
            'the result box must be hidden when the input parse fails; a stale diff underneath an error toast reads as a working comparison');

        const rowsAfter = await page.evaluate(
            () => document.getElementById('diffTableBody').querySelectorAll('tr').length
        );
        assert.strictEqual(rowsAfter, 0,
            `stale diff rows must be cleared; found ${rowsAfter}`);

        console.log('PASS: diff-checker clears the stale diff on invalid JSON');
    } finally {
        await browser.close();
    }
})().catch((err) => {
    console.error('FAIL: ' + err.message);
    process.exit(1);
});
