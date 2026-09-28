/**
 * The PDF compressor end to end in a browser (Puppeteer, server on 3000):
 * a PDF built here goes in, a size is picked, and what comes out is checked
 * as a PDF, not as a promise on the screen. It has to be under the size, open
 * again, have the same pages and still carry its text.
 *
 * test-pdf-compressor.js covers the decisions in Node; this covers the half
 * that only exists in a browser: the workers decoding and encoding, pdf.js
 * rendering the pages, the page wiring it together.
 */
const puppeteer = require('puppeteer');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const L = require(path.join(__dirname, '..', 'assets/vendor/pdf-lib.min.js'));

/* Photo-like pixels: gradients, soft blobs and a little noise, so that JPEG
   beats Flate the way it does on a real photograph. */
function photo(w, h, seed) {
    const out = Buffer.alloc(w * h * 3);
    let r = seed;
    const rnd = () => ((r = (r * 1103515245 + 12345) >>> 0) / 4294967296);
    const blobs = Array.from({ length: 10 }, () => [rnd() * w, rnd() * h, 60 + rnd() * w / 3, rnd() * 255, rnd() * 255, rnd() * 255]);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let c = [x / w * 200, y / h * 200, (x + y) / (w + h) * 255];
            for (const [bx, by, br, R, G, B] of blobs) {
                const d = Math.hypot(x - bx, y - by) / br;
                if (d < 1) { const f = (1 - d) * (1 - d); c = [c[0] * (1 - f) + R * f, c[1] * (1 - f) + G * f, c[2] * (1 - f) + B * f]; }
            }
            const noise = (rnd() - 0.5) * 18;
            for (let k = 0; k < 3; k++) out[(y * w + x) * 3 + k] = Math.max(0, Math.min(255, c[k] + noise));
        }
    }
    return out;
}

async function buildFixture(file) {
    const doc = await L.PDFDocument.create();
    const font = await doc.embedFont(L.StandardFonts.Helvetica);
    const ctx = doc.context;
    for (let p = 0; p < 3; p++) {
        // 2400 pixels across 495 pt is 350 ppi, so the search has to come down
        const w = 2400, h = 1800;
        const img = ctx.register(L.PDFRawStream.of(ctx.obj({
            Type: 'XObject', Subtype: 'Image', Width: w, Height: h,
            ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'FlateDecode',
        }), zlib.deflateSync(photo(w, h, p + 1))));
        const page = doc.addPage([595, 842]);
        page.node.setXObject(L.PDFName.of('P'), img);
        page.drawText(`Marker ${p + 1} stays selectable`, { x: 50, y: 790, size: 14, font });
        page.node.addContentStream(ctx.register(L.PDFRawStream.of(ctx.obj({}),
            Buffer.from('q 495 0 0 371 50 380 cm /P Do Q', 'latin1'))));
    }
    fs.writeFileSync(file, await doc.save());
    return fs.statSync(file).size;
}

function fail(msg) {
    console.error('FAIL: ' + msg);
    process.exitCode = 1;
}

(async () => {
    const file = path.join(os.tmpdir(), 'll-compressor-fixture.pdf');
    const size = await buildFixture(file);
    assert.ok(size > 6e6, `the fixture is only ${size} bytes; it needs to be large enough to have to shrink`);

    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const errors = [];
    try {
        const page = await browser.newPage();
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        await page.goto(`${BASE}/tools/pdf-compressor/`, { waitUntil: 'networkidle2' });

        await (await page.$('#fileInput')).uploadFile(file);
        await page.waitForFunction(() => !document.getElementById('optionsPanel').classList.contains('hidden'), { timeout: 60000 });
        if (!(await page.evaluate(() => window.llHaeltArbeit()))) fail('the page does not report holding the file');

        const pick = (mb) => page.evaluate((mb) => {
            const b = [...document.querySelectorAll('#targets button')].find((x) => x.textContent === mb + ' MB');
            b.click();
        }, mb);
        const settled = () => page.waitForFunction(() => {
            const box = document.getElementById('resultBox');
            return !box.classList.contains('hidden') && document.getElementById('canvasAfter').width !== 300 &&
                document.getElementById('statusText').classList.contains('hidden');
        }, { timeout: 180000 });

        /* What the result is, read back with pdf.js the way any viewer would */
        const inspect = () => page.evaluate(async () => {
            const doc = await pdfjsLib.getDocument({ data: result.bytes.slice() }).promise;
            const texts = [];
            for (let i = 1; i <= doc.numPages; i++) {
                const t = await (await doc.getPage(i)).getTextContent();
                texts.push(t.items.map((it) => it.str).join(' '));
            }
            const c = document.getElementById('canvasAfter');
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            let ink = 0;
            for (let i = 0; i < d.length; i += 4) if (d[i] < 200) ink++;
            return {
                kind: result.kind, t: result.t, size: result.bytes.length, fits: result.fits, target: result.target,
                pages: doc.numPages, texts, ink,
                badge: document.getElementById('fitBadge').textContent,
                details: [...document.querySelectorAll('#detailsList li')].map((l) => l.textContent),
            };
        });

        // 1. Shrinking the images to a size typed in: under it, close to it, text intact
        await page.type('#customTarget', '0.6');
        await page.keyboard.press('Enter');
        await settled();
        let r = await inspect();
        console.log(`  0.6 MB target: ${r.size} bytes, ${r.kind}`);
        if (r.kind !== 'images') fail(`expected the images to be shrunk, got "${r.kind}"`);
        if (!(r.size <= 0.6e6)) fail(`${r.size} bytes is not under 0.6 MB`);
        if (r.t > 0 && !(r.size > 0.6e6 * 0.85)) fail(`${r.size} bytes is much further under 0.6 MB than it needs to be, so quality was thrown away`);
        if (!(r.t > 0)) fail('the fixture fitted at the gentlest setting, so the search was never exercised');
        if (r.pages !== 3) fail(`the result has ${r.pages} pages instead of 3`);
        for (let p = 1; p <= 3; p++) {
            if (!r.texts[p - 1].includes(`Marker ${p} stays selectable`)) fail(`page ${p} lost its text: ${JSON.stringify(r.texts[p - 1])}`);
        }
        if (r.ink < 1000) fail('the preview of the result is blank');
        if (!r.badge.startsWith('Under')) fail(`the badge reads "${r.badge}"`);

        // 2. A size it already fits: the original, untouched
        await pick(50);
        await settled();
        r = await inspect();
        if (r.kind !== 'original' || r.size !== size) fail(`a file under the target should come back as it was, got ${r.kind}, ${r.size} bytes`);

        // 3. Every page an image: reaches 1 MB, text gone, and says so
        await page.click('input[name=method][value=pages]');
        await pick(1);
        await settled();
        r = await inspect();
        console.log(`  1 MB as pictures: ${r.size} bytes, ${r.kind}`);
        if (r.kind !== 'pages') fail(`expected pages turned into images, got "${r.kind}"`);
        if (!(r.size <= 1e6)) fail(`${r.size} bytes is not under 1 MB`);
        if (r.pages !== 3) fail(`the result has ${r.pages} pages instead of 3`);
        if (r.texts.some((t) => t.trim())) fail('pages turned into pictures still carry text');
        if (!r.details.some((d) => d.includes('can no longer be selected'))) fail('the result does not say that the text is gone');

        await page.click('#resetBtn');
        if (await page.evaluate(() => window.llHaeltArbeit())) fail('after starting over the page still reports holding work');

        if (errors.length) fail('errors on the page: ' + errors.join(' | '));
    } finally {
        await browser.close();
        fs.unlinkSync(file);
    }
    if (!process.exitCode) console.log('PASS: PDF compressor in the browser');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
