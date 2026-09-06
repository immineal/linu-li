/**
 * Number inputs — spinner regression test (Puppeteer).
 *
 * The little up/down arrows Chrome and Firefox paint inside a number field
 * are switched off site-wide from assets/css/style.css. This walks every
 * tool page that actually has a number input and checks the property that
 * does the switching off, so deleting the rule — or a tool shipping its own
 * conflicting one — shows up here rather than on the live site.
 *
 * The arrows themselves cannot be screenshotted: headless Chrome does not
 * paint them. `appearance` is the mechanism, so `appearance` is what is
 * asserted.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const ROOT = path.join(__dirname, '..');

// Find the pages for real instead of keeping a list that drifts.
function pagesWithNumberInputs() {
    const found = [];
    const toolsDir = path.join(ROOT, 'tools');
    for (const tool of fs.readdirSync(toolsDir).sort()) {
        const file = path.join(toolsDir, tool, 'index.html');
        if (!fs.existsSync(file)) continue;
        if (/<input[^>]*type=["']number["']/.test(fs.readFileSync(file, 'utf8'))) {
            found.push({ tool, url: `${BASE}/tools/${tool}/` });
        }
    }
    return found;
}

function fail(msg) {
    console.error('FAIL: ' + msg);
    process.exitCode = 1;
}

(async () => {
    const pages = pagesWithNumberInputs();
    if (pages.length === 0) {
        fail('no tool page has a number input — the search is broken, not the CSS');
        process.exit(1);
    }

    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();

    let fields = 0;
    for (const { tool, url } of pages) {
        await page.goto(url, { waitUntil: 'networkidle2' });
        const inputs = await page.$$eval('input[type="number"]', (els) =>
            els.map((el) => ({
                id: el.id || el.name || '(unnamed)',
                appearance: getComputedStyle(el).appearance,
            }))
        );
        if (inputs.length === 0) {
            fail(`${tool}: the source has a number input but the page rendered none`);
            continue;
        }
        for (const input of inputs) {
            fields++;
            if (input.appearance !== 'textfield') {
                fail(`${tool} #${input.id}: appearance is "${input.appearance}", expected "textfield" — the spinner arrows are showing`);
            }
        }
    }

    await browser.close();

    if (process.exitCode) {
        console.error('Number spinner test failed.');
    } else {
        console.log(`PASS: number spinners — ${fields} field(s) across ${pages.length} tool(s), arrows hidden everywhere`);
    }
})().catch((err) => {
    console.error('FAIL: ' + err.message);
    process.exit(1);
});
