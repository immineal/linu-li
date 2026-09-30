/**
 * Unit Converter — end-to-end regressions from the September 2026 QA sweep.
 *
 * These are the ones the tool cannot catch in jsdom because they need the
 * real autosave path (a reload of the page) and event dispatch order:
 *
 *   1. After reload, km→mi shows the km→mi result, not the m→ft one.
 *   2. Quick convert handles temperature, comma decimals, no-space shapes.
 *   3. In German the category buttons still highlight the right one.
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
    const page = await browser.newPage();

    await page.goto(BASE + '/tools/unit-converter/?lang=en', { waitUntil: 'networkidle2' });

    // Wipe any autosave from an earlier run to start clean.
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle2' });

    // ── BUG 1: state survives reload with the right conversion ──────────
    await page.select('#unitFrom', 'km');
    await page.select('#unitTo', 'mi');
    // Autosave debounces changes; give it room to write.
    await new Promise((r) => setTimeout(r, 500));

    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 500));

    const restored = await page.evaluate(() => ({
        uFrom: document.getElementById('unitFrom').value,
        uTo: document.getElementById('unitTo').value,
        to: document.getElementById('inputTo').value,
    }));
    if (restored.uFrom !== 'km' || restored.uTo !== 'mi') {
        fail('the dropdowns did not restore to km/mi (got ' + JSON.stringify(restored) + ')');
    }
    if (Math.abs(parseFloat(restored.to) - 0.621371192237) > 1e-6) {
        fail('after reload, 1 km reads as ' + restored.to + ' — the restored units did not fire a recalculation');
    }

    // ── BUG 2: quick convert handles temperature ────────────────────────
    await page.evaluate(() => {
        document.getElementById('nlpInput').value = '';
        document.getElementById('nlpInput').dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.type('#nlpInput', '20 c to f');
    await new Promise((r) => setTimeout(r, 100));
    const temp = await page.evaluate(() => ({
        cat: document.querySelector('.button-group button:not(.outline)').getAttribute('data-category'),
        uFrom: document.getElementById('unitFrom').value,
        uTo: document.getElementById('unitTo').value,
        to: document.getElementById('inputTo').value,
    }));
    if (temp.cat !== 'temp') fail('20 c to f did not switch to the temp category (got ' + temp.cat + ')');
    if (temp.to !== '68') fail('20 c to f should read 68 F, got ' + temp.to);

    // ── BUG 3: no-space and comma-decimal shapes are tolerated ──────────
    for (const [query, wantFrom, wantTo, tol, wantValue] of [
        ['100km to miles', 'km', 'mi', 1e-6, 62.1371192237],
        ['5kg in pounds', 'kg', 'lb', 1e-6, 11.0231131092],
        ['1,5 km to miles', 'km', 'mi', 1e-6, 0.9320567884],
        ['convert 100 km to miles please', 'km', 'mi', 1e-6, 62.1371192237],
        ['50 mph in kmh', 'mph', 'km/h', 1e-6, 80.4672],
    ]) {
        await page.evaluate(() => {
            const el = document.getElementById('nlpInput');
            el.value = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.type('#nlpInput', query);
        await new Promise((r) => setTimeout(r, 100));
        const out = await page.evaluate(() => ({
            uFrom: document.getElementById('unitFrom').value,
            uTo: document.getElementById('unitTo').value,
            to: document.getElementById('inputTo').value,
            notice: document.getElementById('nlpNotUnderstood').style.display,
        }));
        if (out.uFrom !== wantFrom || out.uTo !== wantTo) {
            fail(`"${query}" did not resolve to ${wantFrom} -> ${wantTo} (got ${JSON.stringify(out)})`);
        }
        if (Math.abs(parseFloat(out.to) - wantValue) > tol) {
            fail(`"${query}" converted to ${out.to}, expected ~${wantValue}`);
        }
        if (out.notice !== 'none') fail(`"${query}" showed the not-understood notice`);
    }

    // A parse that fails hides the stale result and shows a notice.
    await page.evaluate(() => {
        const el = document.getElementById('nlpInput');
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.type('#nlpInput', 'jibberish that means nothing');
    await new Promise((r) => setTimeout(r, 100));
    const failed = await page.evaluate(() => ({
        to: document.getElementById('inputTo').value,
        notice: document.getElementById('nlpNotUnderstood').style.display,
    }));
    if (failed.to !== '') fail('nonsense left the previous result behind: ' + failed.to);
    if (failed.notice !== 'block') fail('nonsense did not surface the "not understood" notice');

    // ── BUG 9: German category highlight ────────────────────────────────
    await page.goto(BASE + '/tools/unit-converter/?lang=de', { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 200));
    await page.evaluate(() => setCategory('weight'));
    const highlighted = await page.evaluate(() => {
        const btn = document.querySelector('.button-group button:not(.outline)');
        return btn ? btn.getAttribute('data-category') : null;
    });
    if (highlighted !== 'weight') fail('German UI does not highlight the picked category (got ' + highlighted + ')');

    await browser.close();

    if (!process.exitCode) {
        console.log('PASS: unit converter regressions — reload, quick convert (temp/no-space/comma), German highlight');
    }
})().catch((err) => {
    console.error('FAIL: ' + err.message);
    process.exit(1);
});
