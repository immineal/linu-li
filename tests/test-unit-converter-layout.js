/**
 * Unit Converter — the equals sign sits on the fields (Puppeteer).
 *
 * The "=" between the two columns should read as belonging to the two
 * value fields, not float somewhere below them. Rather than assert on
 * whatever CSS happens to place it, this screenshots the strip between the
 * fields, finds the pixels the glyph actually painted, and compares their
 * centre with the centre of the fields. Any layout that gets the glyph to
 * the right place passes; any that does not, fails.
 */
const puppeteer = require('puppeteer');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const TOLERANCE_PX = 2;

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
    await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 });
    await page.goto(BASE + '/tools/unit-converter/', { waitUntil: 'networkidle2' });

    // Screenshot clips are measured from the top of the document, element
    // rectangles from the top of the window. Everything below works in
    // document coordinates so the two cannot drift apart.
    const rects = await page.evaluate(() => {
        const r = (el) => {
            const b = el.getBoundingClientRect();
            return {
                left: b.left + window.scrollX,
                right: b.right + window.scrollX,
                top: b.top + window.scrollY,
                bottom: b.bottom + window.scrollY,
                mid: b.top + window.scrollY + b.height / 2,
            };
        };
        const from = document.getElementById('inputFrom');
        return {
            from: r(from),
            to: r(document.getElementById('inputTo')),
            row: r(from.closest('.input-group').parentElement),
        };
    });

    if (!(rects.to.left > rects.from.right)) {
        fail('the two value fields are not side by side — this test assumes the desktop layout');
        await browser.close();
        process.exit(1);
    }

    // The gap between the two columns, over the full height of the row.
    // Nothing but the equals sign is painted in there, so every stray pixel
    // found below belongs to the glyph — wherever in the row it ended up.
    const clip = {
        x: Math.round(rects.from.right + 1),
        y: Math.round(rects.row.top),
        width: Math.round(rects.to.left - rects.from.right - 2),
        height: Math.round(rects.row.bottom - rects.row.top),
    };
    const shot = await page.screenshot({ clip, encoding: 'base64' });

    // Decode in the page — no image library needed on this side.
    const band = await page.evaluate(async (b64) => {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64; });
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        const at = (x, y) => [d[(y * c.width + x) * 4], d[(y * c.width + x) * 4 + 1], d[(y * c.width + x) * 4 + 2]];

        // The background is simply the colour most of the strip is: card
        // fill above and below, field fill in between. Picking a corner
        // pixel instead would hand us an antialiased edge.
        const counts = new Map();
        for (let y = 0; y < c.height; y++) {
            for (let x = 0; x < c.width; x++) {
                const k = at(x, y).join(',');
                counts.set(k, (counts.get(k) || 0) + 1);
            }
        }
        let bg = null, best = -1;
        for (const [k, n] of counts) if (n > best) { best = n; bg = k.split(',').map(Number); }

        // Well above antialiasing noise, well below the contrast of ink.
        const far = (p) => Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 60;
        // A glyph covers a few pixels of a row, never the whole width. Rows
        // that run edge to edge belong to the page behind it, not to the sign.
        let top = null, bottom = null, painted = 0;
        for (let y = 0; y < c.height; y++) {
            let n = 0;
            for (let x = 0; x < c.width; x++) if (far(at(x, y))) n++;
            if (n >= 2 && n <= c.width * 0.6) {
                if (top === null) top = y;
                bottom = y;
                painted += n;
            }
        }
        return { top, bottom, painted, height: c.height, bg, bgShare: +(best / (c.width * c.height)).toFixed(3) };
    }, shot);

    if (band.top === null) {
        fail('nothing is painted between the two fields — where did the equals sign go?');
    } else {
        const glyphMid = clip.y + (band.top + band.bottom) / 2;
        const fieldMid = (rects.from.mid + rects.to.mid) / 2;
        const off = glyphMid - fieldMid;
        if (Math.abs(off) > TOLERANCE_PX) {
            fail(
                `the equals sign sits ${off > 0 ? 'below' : 'above'} the value fields by ` +
                `${Math.abs(off).toFixed(1)} px (glyph centre ${glyphMid.toFixed(1)}, field centre ${fieldMid.toFixed(1)}, ` +
                `tolerance ${TOLERANCE_PX} px)`
            );
        } else {
            console.log(`  equals sign is ${off.toFixed(1)} px off the field centre (tolerance ${TOLERANCE_PX} px)`);
        }
    }

    // Narrow screens stack the row; the sign must survive that, and the
    // two fields must end up one above the other.
    await page.setViewport({ width: 420, height: 900, deviceScaleFactor: 1 });
    await new Promise((r) => setTimeout(r, 200));
    const stacked = await page.evaluate(() => {
        const a = document.getElementById('inputFrom').getBoundingClientRect();
        const b = document.getElementById('inputTo').getBoundingClientRect();
        const sign = document.querySelector('[class*="equals"]');
        const s = sign ? sign.getBoundingClientRect() : null;
        return { stacked: b.top >= a.bottom, signVisible: !!s && s.width > 0 && s.height > 0 };
    });
    if (!stacked.stacked) fail('on a narrow screen the two fields are still side by side');
    if (!stacked.signVisible) fail('on a narrow screen the equals sign has no box at all');

    // An equals sign is two horizontal bars: wider than it is tall. Turned a
    // quarter turn it reads as two vertical strokes, which is a different
    // character. Measure the ink, not the CSS.
    const upright = await page.evaluate(() => {
        const el = document.querySelector('.equals-glyph') || document.querySelector('[class*="equals"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        // The painted bars sit inside the box; the box itself is square-ish,
        // so read the transform the browser resolved instead.
        const t = getComputedStyle(el).transform;
        return { transform: t, w: r.width, h: r.height };
    });
    if (!upright) {
        fail('on a narrow screen there is no equals sign to measure');
    } else if (upright.transform && upright.transform !== 'none') {
        fail(`on a narrow screen the equals sign is turned (transform ${upright.transform}) — it should read as "=", not as two upright strokes`);
    }

    await browser.close();

    if (process.exitCode) {
        console.error('Unit converter layout test failed.');
    } else {
        console.log('PASS: unit converter layout — equals sign on the fields, row stacks on narrow screens');
    }
})().catch((err) => {
    console.error('FAIL: ' + err.message);
    process.exit(1);
});
