/**
 * The timestamp converter's "Get Timestamp" button, clicked for real
 * (Puppeteer, server on 3000).
 *
 * For a long time the button wrote into four fields that were not on the
 * page. The click threw before the result box was shown, so the Date to
 * Timestamp half of the tool did nothing at all, and test-time-converter.js
 * did not notice: it replaces dayjs with a stand-in and never presses the
 * button.
 */
const puppeteer = require('puppeteer');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

function fail(msg) {
    console.error('FAIL: ' + msg);
    process.exitCode = 1;
}

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const errors = [];
    try {
        const page = await browser.newPage();
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(`${BASE}/tools/time-converter/`, { waitUntil: 'networkidle2' });

        // UTC, so the expected numbers do not depend on the machine's zone
        await page.select('#manualTz', 'utc');
        await page.$eval('#dateInput', (el) => { el.value = '2026-09-28T09:27:23'; });
        await page.click('#convertToTsBtn');

        const shown = await page.$eval('#dateResultBox', (el) => !el.classList.contains('hidden'));
        if (!shown) fail('the result box stays hidden after the click');

        const values = await page.evaluate(() => Object.fromEntries(
            ['resTsSeconds', 'resTsMillis', 'resTsMicro', 'resTsNano'].map((id) => {
                const el = document.getElementById(id);
                return [id, el ? el.value : null];
            })));
        const expected = {
            resTsSeconds: '1790587643',
            resTsMillis: '1790587643000',
            resTsMicro: '1790587643000000',
            resTsNano: '1790587643000000000',
        };
        for (const [id, want] of Object.entries(expected)) {
            if (values[id] !== want) fail(`#${id} reads ${JSON.stringify(values[id])}, expected ${want}`);
        }
        if (errors.length) fail('errors on the page: ' + errors.join(' | '));
    } finally {
        await browser.close();
    }
    if (!process.exitCode) console.log('PASS: Get Timestamp fills all four fields');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
