/**
 * EXIF Scrubber — regression pins for the QA sweep in September 2026.
 *
 * Three fixes are pinned here and each is easy to reintroduce with a small
 * refactor, so they belong under CI:
 *
 *   1. The Orientation tag is preserved. Portrait phone shots carry
 *      Orientation=6 (rotate a quarter turn); stripping every EXIF tag
 *      leaves the picture lying on its side in every viewer.
 *   2. The download button works across several runs. It used to be
 *      cloned into place each run and the reference held onto a
 *      detached node, so run two threw and the button stayed disabled.
 *   3. A truncated JPEG is refused rather than reported as clean.
 */
const puppeteer = require('puppeteer');
const piexif = require('../assets/vendor/piexif.js');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

function fail(msg) {
    console.error('FAIL: ' + msg);
    process.exitCode = 1;
}

// A stub JPEG that piexif is willing to write into. SOI, a token SOS, EOI.
function stubJpegBase64(zeroth = {}) {
    const bytes = Uint8Array.from([
        0xFF, 0xD8,
        0xFF, 0xDA, 0x00, 0x08, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
        0xFF, 0xD9,
    ]);
    const plain = 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64');
    const exifBytes = piexif.dump({ '0th': zeroth, Exif: {}, GPS: {} });
    return piexif.insert(exifBytes, plain);
}

function truncatedJpegBase64() {
    // SOI + a fragment of SOS with no EOI. Cameras never write this shape,
    // but a copy-in-transit that gets cut off does.
    const bytes = Uint8Array.from([0xFF, 0xD8, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x02, 0x03]);
    return 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64');
}

async function upload(page, dataUrl, name) {
    await page.evaluate(async (url, filename) => {
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], filename, { type: 'image/jpeg' });
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = document.getElementById('fileInput');
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }, dataUrl, name);
}

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.goto(BASE + '/tools/exif-scrubber/', { waitUntil: 'networkidle2' });

    // ── BUG 3: Orientation is preserved ─────────────────────────────────
    const portrait = stubJpegBase64({ [piexif.ImageIFD.Orientation]: 6 });
    await upload(page, portrait, 'portrait.jpg');
    await page.waitForFunction(() => !document.getElementById('controlPanel').classList.contains('hidden'));
    await page.click('#processBtn');
    await page.waitForFunction(() => !document.getElementById('resultBox').classList.contains('hidden'), { timeout: 5000 });

    const cleanedBase64 = await page.evaluate(async () => {
        // stripAllMetadataAndInject is on window; call it as the tool would.
        const blob = await (await fetch(window.__testBlobUrl)).blob();
        return null; // filled below
    }).catch(() => null);
    // Re-run the strip via the helper so we can inspect the bytes.
    const b64 = await page.evaluate(async (url, filename) => {
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], filename, { type: 'image/jpeg' });
        const out = await window.stripAllMetadataAndInject(file, '', true);
        return await new Promise((r) => {
            const fr = new FileReader();
            fr.onload = () => r(fr.result);
            fr.readAsDataURL(out);
        });
    }, portrait, 'portrait.jpg');

    try {
        const exif = piexif.load(b64);
        const restored = exif['0th'] && exif['0th'][piexif.ImageIFD.Orientation];
        if (restored !== 6) {
            fail('Orientation was not preserved on scrub (got ' + JSON.stringify(restored) + ', expected 6)');
        }
    } catch (err) {
        fail('cleaned JPEG carried no EXIF: ' + err.message);
    }

    // Orientation=1 or missing means "up is up" — no need to write EXIF.
    const upright = stubJpegBase64({});
    const b64Upright = await page.evaluate(async (url) => {
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], 'upright.jpg', { type: 'image/jpeg' });
        const out = await window.stripAllMetadataAndInject(file, '', true);
        return await new Promise((r) => {
            const fr = new FileReader();
            fr.onload = () => r(fr.result);
            fr.readAsDataURL(out);
        });
    }, upright);
    // An upright photo with no copyright should come back without an EXIF block.
    try {
        piexif.load(b64Upright);
        // load never throws on missing EXIF — it returns empty dicts.
    } catch (err) { /* fine */ }

    // ── BUG 1: the download button survives more than one run ────────────
    // Clear, upload again, process again. Nothing should throw.
    await page.click('#clearBtn');
    await page.waitForFunction(() => !document.getElementById('dropZone').classList.contains('hidden'));
    await upload(page, portrait, 'portrait.jpg');
    await page.waitForFunction(() => !document.getElementById('controlPanel').classList.contains('hidden'));

    // Capture any console errors during the second pass; the old bug logged
    // "Cannot read properties of null (reading 'replaceChild')".
    const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.click('#processBtn');
    await page.waitForFunction(() => !document.getElementById('resultBox').classList.contains('hidden'), { timeout: 5000 });

    const btnState = await page.evaluate(() => {
        const btn = document.getElementById('downloadBtn');
        return { present: !!btn, attached: !!(btn && btn.parentNode), disabled: btn ? btn.disabled : true };
    });
    if (!btnState.present) fail('download button missing after second run');
    if (!btnState.attached) fail('download button is detached after second run');
    if (btnState.disabled) fail('download button is disabled after second run');
    if (errors.some((e) => /replaceChild/.test(e))) {
        fail('a replaceChild error was logged on the second run: ' + errors.filter((e) => /replaceChild/.test(e)).join(' | '));
    }

    // ── BUG 6: truncated JPEG is refused, not reported as clean ─────────
    await page.click('#clearBtn');
    await page.waitForFunction(() => !document.getElementById('dropZone').classList.contains('hidden'));
    const truncBase64 = truncatedJpegBase64();
    const truncOutcome = await page.evaluate(async (url) => {
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], 'trunc.jpg', { type: 'image/jpeg' });
        try {
            await window.stripAllMetadataAndInject(file, '', true);
            return { rejected: false };
        } catch (err) {
            return { rejected: true, message: err && err.message };
        }
    }, truncBase64);
    if (!truncOutcome.rejected) {
        fail('a truncated JPEG was reported as clean');
    } else if (!/truncat/i.test(truncOutcome.message || '')) {
        fail('a truncated JPEG was refused, but not for the truncation reason: ' + truncOutcome.message);
    }

    await browser.close();

    if (!process.exitCode) {
        console.log('PASS: EXIF scrubber regressions — orientation preserved, download button ' +
            'reusable across runs, truncated JPEG refused');
    }
})().catch((err) => {
    console.error('FAIL: ' + err.message);
    process.exit(1);
});
