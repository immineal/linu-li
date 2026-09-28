/**
 * The PDF compressor's decisions, in Node: what it reads out of a PDF, what
 * it leaves alone and why, how it walks the ladder, and the pixel code the
 * worker runs. The browser half (decoding, encoding, the page) is in
 * test-pdf-compressor-browser.js.
 *
 * The PDFs here are built by hand with the same pdf-lib the tool uses, so
 * each one has exactly the feature under test and nothing else.
 */
const assert = require('assert');
const zlib = require('zlib');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const L = require(path.join(ROOT, 'assets/vendor/pdf-lib.min.js'));
const E = require(path.join(ROOT, 'tools/pdf-compressor/engine.js'));
const W = require(path.join(ROOT, 'tools/pdf-compressor/worker.js'));

let passed = 0;
const pending = [];
function test(name, fn) {
    pending.push(async () => {
        try {
            await fn();
            passed++;
            console.log('  ok  ' + name);
        } catch (err) {
            console.error('  FAIL  ' + name + '\n        ' + (err && err.stack || err));
            process.exitCode = 1;
        }
    });
}

const bytes = (s) => Buffer.from(s, 'latin1');

function image(ctx, dict, raw) {
    return ctx.register(L.PDFRawStream.of(
        ctx.obj(Object.assign({ Type: 'XObject', Subtype: 'Image', Filter: 'FlateDecode' }, dict)),
        zlib.deflateSync(raw)));
}
function noisy(n, seed) {
    // Incompressible enough to stay above the size where the tool bothers
    const out = Buffer.alloc(n);
    let r = seed || 1;
    for (let i = 0; i < n; i++) { r = (r * 1103515245 + 12345) >>> 0; out[i] = r >>> 24; }
    return out;
}
async function docWith(build) {
    const doc = await L.PDFDocument.create();
    await build(doc, doc.context);
    return L.PDFDocument.load(await doc.save({ useObjectStreams: false }), { updateMetadata: false });
}
function draw(doc, page, ops, xobjects) {
    for (const [n, ref] of Object.entries(xobjects || {})) page.node.setXObject(L.PDFName.of(n), ref);
    page.node.addContentStream(doc.context.register(
        L.PDFRawStream.of(doc.context.obj({ Filter: 'FlateDecode' }), zlib.deflateSync(bytes(ops)))));
}

/* ------------------------------------------------ content streams */

test('only real operators count: not the ones inside strings, comments or inline images', () => {
    const seen = [];
    const content = bytes(
        '% a comment with /Fake Do in it\n' +
        'BT (text with \\) and (nested) Do inside) Tj <2f446f> Tj ET\n' +
        'BI /W 4 /H 1 /BPC 8 /CS /G ID \x00EI\xff\x01 EI\n' +
        '[ (x) 3 (y) ] TJ\n' +
        'q 1 0 0 1 5 5 cm /Real Do Q');
    E.walkContent(content, (op, args) => seen.push([op, args.slice()]));
    const ops = seen.map((s) => s[0]);
    assert.deepStrictEqual(ops, ['BT', 'Tj', 'Tj', 'ET', 'TJ', 'q', 'cm', 'Do', 'Q']);
    assert.deepStrictEqual(seen[7][1], [{ name: 'Real' }]);
    assert.deepStrictEqual(seen[6][1], [1, 0, 0, 1, 5, 5]);
});

test('an inline image whose data holds "EI" does not end early', () => {
    const seen = [];
    E.walkContent(bytes('BI /W 2 /H 2 ID xxEIyy EI /After Do'), (op, args) => seen.push([op, args.slice()]));
    assert.deepStrictEqual(seen, [['Do', [{ name: 'After' }]]]);
});

/* ------------------------------------------------ placements */

test('the drawn size follows q, Q, cm and nested forms, and the largest use wins', async () => {
    const doc = await docWith(async (d, ctx) => {
        const img = image(ctx, { Width: 1000, Height: 500, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }, noisy(1000 * 500 * 3));
        const form = ctx.register(L.PDFRawStream.of(ctx.obj({
            Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 1, 1], Matrix: [2, 0, 0, 2, 0, 0],
            Resources: { XObject: { I: img } },
        }), bytes('/I Do')));
        const p1 = d.addPage([600, 800]);
        // 100x50 inside a q that is thrown away, then 200x100 through the form
        draw(d, p1, 'q 100 0 0 50 0 0 cm /I Do Q q 100 0 0 50 10 10 cm /F Do Q', { I: img, F: form });
        const p2 = d.addPage([600, 800]);
        draw(d, p2, 'q 50 0 0 25 0 0 cm /I Do Q', { I: img });
    });
    const m = E.measurePlacements(doc, L);
    assert.strictEqual(m.problems.length, 0);
    const [[key, place]] = [...m.placements.entries()];
    assert.strictEqual(Math.round(place.wPt), 200);
    assert.strictEqual(Math.round(place.hPt), 100);
    assert.strictEqual(place.uses, 3);
    assert.ok(m.byPage[0].has(key) && m.byPage[1].has(key));

    const a = E.describeImages(doc, L, m);
    assert.strictEqual(a.candidates.length, 1);
    // 1000 pixels across 200 pt, which is 2.78 in
    assert.strictEqual(Math.round(a.candidates[0].ppi), 360);
    assert.strictEqual(a.candidates[0].placed, true);
});

test('an image no page draws is assumed to fill the largest page', async () => {
    const doc = await docWith(async (d, ctx) => {
        const img = image(ctx, { Width: 1200, Height: 1200, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }, noisy(1200 * 1200));
        const p = d.addPage([600, 800]);
        p.node.set(L.PDFName.of('Unused'), img); // reachable, never painted
    });
    const a = E.describeImages(doc, L, E.measurePlacements(doc, L));
    assert.strictEqual(a.candidates.length, 1);
    assert.strictEqual(a.candidates[0].placed, false);
    assert.strictEqual(Math.round(a.candidates[0].ppi), 144); // 1200 px over 600 pt
});

/* ------------------------------------------------ what is left alone */

test('each kind of image that cannot be rewritten safely is left alone, with its reason', async () => {
    const doc = await docWith(async (d, ctx) => {
        const p = d.addPage([600, 800]);
        const x = {};
        x.bilevel = image(ctx, { Width: 800, Height: 800, ColorSpace: 'DeviceGray', BitsPerComponent: 1 }, noisy(100 * 800));
        x.decode = image(ctx, { Width: 300, Height: 300, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Decode: [1, 0] }, noisy(90000));
        x.key = image(ctx, { Width: 300, Height: 300, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Mask: [0, 10] }, noisy(90000));
        x.lab = image(ctx, { Width: 300, Height: 300, ColorSpace: ['Lab', { WhitePoint: [1, 1, 1] }], BitsPerComponent: 8 }, noisy(270000));
        x.jpx = ctx.register(L.PDFRawStream.of(ctx.obj({ Type: 'XObject', Subtype: 'Image', Width: 300, Height: 300, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'JPXDecode' }), noisy(9000)));
        x.cmykjpeg = ctx.register(L.PDFRawStream.of(ctx.obj({ Type: 'XObject', Subtype: 'Image', Width: 300, Height: 300, ColorSpace: 'DeviceCMYK', BitsPerComponent: 8, Filter: 'DCTDecode' }), noisy(9000)));
        x.stencil = image(ctx, { Width: 800, Height: 800, ImageMask: true, BitsPerComponent: 1 }, noisy(100 * 800));
        let ops = '';
        let i = 0;
        for (const n of Object.keys(x)) ops += `q 100 0 0 100 ${i++ * 5} 0 cm /${n} Do Q `;
        draw(d, p, ops, x);
    });
    const a = E.describeImages(doc, L, E.measurePlacements(doc, L));
    assert.strictEqual(a.candidates.length, 0, 'none of these should be rewritten');
    const reasons = a.skipped.map((s) => s.reason).sort();
    assert.deepStrictEqual(reasons, ['bilevel', 'cmykjpeg', 'colourkey', 'colourspace', 'decode', 'jpx', 'stencil']);
    for (const r of reasons) assert.ok(E.REASONS[r], 'no wording for ' + r);
});

test('a soft mask travels with its image, unless another image shares it', async () => {
    const doc = await docWith(async (d, ctx) => {
        const own = image(ctx, { Width: 400, Height: 400, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }, noisy(160000, 2));
        const shared = image(ctx, { Width: 400, Height: 400, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }, noisy(160000, 3));
        const a = image(ctx, { Width: 400, Height: 400, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, SMask: own }, noisy(480000, 4));
        const b = image(ctx, { Width: 400, Height: 400, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, SMask: shared }, noisy(480000, 5));
        const c = image(ctx, { Width: 400, Height: 400, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, SMask: shared }, noisy(480000, 6));
        draw(d, d.addPage(), 'q 100 0 0 100 0 0 cm /A Do Q q 100 0 0 100 0 0 cm /B Do Q q 100 0 0 100 0 0 cm /C Do Q', { A: a, B: b, C: c });
    });
    const an = E.describeImages(doc, L, E.measurePlacements(doc, L));
    assert.strictEqual(an.candidates.length, 3, 'masks are not candidates of their own');
    const withMask = an.candidates.filter((c) => c.smask);
    assert.strictEqual(withMask.length, 1, 'only the unshared mask is resampled');
    assert.ok(withMask[0].bytes > withMask[0].stream.contents.length, 'its bytes count towards the image');
});

test('palette, 16-bit and CMYK images are read, with the palette handed over', async () => {
    const doc = await docWith(async (d, ctx) => {
        const pal = L.PDFHexString.of('ff0000' + '00ff00');
        const idx = image(ctx, { Width: 400, Height: 400, ColorSpace: ['Indexed', 'DeviceRGB', 1, pal], BitsPerComponent: 1 }, noisy(50 * 400));
        const g16 = image(ctx, { Width: 300, Height: 300, ColorSpace: 'DeviceGray', BitsPerComponent: 16 }, noisy(180000));
        const cmyk = image(ctx, { Width: 300, Height: 300, ColorSpace: 'DeviceCMYK', BitsPerComponent: 8 }, noisy(360000));
        draw(d, d.addPage(), 'q 100 0 0 100 0 0 cm /I Do Q q 100 0 0 100 0 0 cm /G Do Q q 100 0 0 100 0 0 cm /C Do Q', { I: idx, G: g16, C: cmyk });
    });
    const an = E.describeImages(doc, L, E.measurePlacements(doc, L));
    assert.strictEqual(an.candidates.length, 3);
    const byKind = Object.fromEntries(an.candidates.map((c) => [c.info.cs.kind, c]));
    const job = E.jobFor(byKind.indexed);
    assert.deepStrictEqual([...job.cs.table], [255, 0, 0, 0, 255, 0]);
    assert.strictEqual(job.cs.hival, 1);
    assert.strictEqual(job.cs.base.n, 3);
    assert.strictEqual(byKind.gray.info.bpc, 16);
    assert.strictEqual(byKind.cmyk.info.cs.n, 4);
});

/* ------------------------------------------------ the ladder */

test('levelAt interpolates between rungs and rounds for the cache', () => {
    assert.deepStrictEqual(E.levelAt(E.IMAGE_LEVELS, 0), E.IMAGE_LEVELS[0]);
    assert.deepStrictEqual(E.levelAt(E.IMAGE_LEVELS, 99), E.IMAGE_LEVELS[E.IMAGE_LEVELS.length - 1]);
    const mid = E.levelAt(E.IMAGE_LEVELS, 0.5);
    assert.strictEqual(mid.ppi, 275);
    assert.strictEqual(mid.quality, 0.84);
    for (let i = 1; i < E.IMAGE_LEVELS.length; i++) {
        const a = E.IMAGE_LEVELS[i - 1], b = E.IMAGE_LEVELS[i];
        assert.ok(b.ppi <= a.ppi && b.quality <= a.quality, 'rung ' + i + ' is gentler than the one before');
    }
});

// A file of 1 MB that no setting touches plus images that shrink with the square of the resolution
const model = (levels) => (t) => {
    const l = E.levelAt(levels, t);
    return 1e6 + 40e6 * Math.pow(l.ppi / 300, 2) * l.quality / 0.85;
};

test('the search lands just under the budget, not on the first rung that fits', async () => {
    const size = model(E.IMAGE_LEVELS);
    for (const target of [30e6, 10e6, 5e6, 2e6]) {
        const budget = target * E.HEADROOM;
        const r = await E.searchLevel(E.IMAGE_LEVELS, budget, async (t) => size(t));
        assert.ok(r.fits);
        assert.ok(size(r.t) <= budget, `${target}: over the budget`);
        assert.ok(size(r.t) > budget * 0.93, `${target}: ${size(r.t)} is further under than it needs to be`);
    }
});

test('when nothing fits it stops where going lower stops paying, not at the bottom', async () => {
    // 5 MB that never shrinks, 3 MB of images: the bottom rungs save next to nothing
    const size = (t) => {
        const l = E.levelAt(E.IMAGE_LEVELS, t);
        return 5e6 + 3e6 * Math.pow(l.ppi / 300, 2);
    };
    const r = await E.searchLevel(E.IMAGE_LEVELS, 1e6, async (t) => size(t));
    assert.strictEqual(r.fits, false);
    assert.ok(r.t < E.IMAGE_LEVELS.length - 1, 'went all the way down for nothing');
    assert.ok(size(r.t) <= r.floor * 1.03 + 30000);
});

test('after a real file came out too big, the search only looks further down', async () => {
    const size = model(E.IMAGE_LEVELS);
    const first = await E.searchLevel(E.IMAGE_LEVELS, 9.85e6, async (t) => size(t));
    const again = await E.searchLevel(E.IMAGE_LEVELS, 9.85e6, async (t) => size(t) * 1.1, { after: first.t });
    assert.ok(again.t > first.t);
    assert.ok(size(again.t) * 1.1 <= 9.85e6);
});

test('the estimate sample keeps the largest items', () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ b: i }));
    const s = E.sampleForEstimate(items, (x) => x.b, 24);
    assert.strictEqual(s.length, 24);
    for (let b = 99; b > 91; b--) assert.ok(s.some((x) => x.b === b), 'missing ' + b);
    assert.strictEqual(new Set(s).size, 24);
});

/* ------------------------------------------------ tidying and writing */

test('unreachable objects go, reachable ones stay, and the file still opens', async () => {
    const doc = await docWith(async (d, ctx) => {
        draw(d, d.addPage(), 'BT ET');
        ctx.register(L.PDFRawStream.of(ctx.obj({}), noisy(5000))); // an orphan
    });
    const before = doc.context.enumerateIndirectObjects().length;
    const { removed, bytes: freed } = E.removeUnreachable(doc, L);
    assert.strictEqual(removed, 1);
    assert.strictEqual(freed, 5000);
    assert.strictEqual(doc.context.enumerateIndirectObjects().length, before - 1);
    const again = await L.PDFDocument.load(await doc.save());
    assert.strictEqual(again.getPageCount(), 1);
});

test('uncompressed streams are deflated without loss, XMP metadata is not', async () => {
    const text = 'BT /F1 12 Tf (' + 'hello '.repeat(400) + ') Tj ET';
    let pageContent, meta;
    const doc = await docWith(async (d, ctx) => {
        const p = d.addPage();
        pageContent = ctx.register(L.PDFRawStream.of(ctx.obj({}), bytes(text)));
        p.node.set(L.PDFName.of('Contents'), pageContent);
        meta = ctx.register(L.PDFRawStream.of(ctx.obj({ Type: 'Metadata', Subtype: 'XML' }), bytes('<x>' + 'm'.repeat(3000) + '</x>')));
        d.catalog.set(L.PDFName.of('Metadata'), meta);
    });
    const { saved } = E.deflateLoose(doc, L);
    assert.ok(saved > 1500);
    const h = E.makeHelpers(L, doc.context);
    const page = doc.getPages()[0];
    const content = h.lookup(page.node.get(L.PDFName.of('Contents')));
    assert.strictEqual(h.name(h.get(content.dict, 'Filter')), 'FlateDecode');
    assert.strictEqual(Buffer.from(h.decodeStream(content)).toString('latin1'), text);
    const m = h.lookup(doc.catalog.get(L.PDFName.of('Metadata')));
    assert.strictEqual(h.get(m.dict, 'Filter'), undefined);
});

test('a rewritten image keeps optional content and structure, and drops the old filter', async () => {
    const doc = await docWith(async (d, ctx) => {
        const oc = ctx.register(ctx.obj({ Type: 'OCG', Name: L.PDFString.of('Layer') }));
        const img = image(ctx, {
            Width: 300, Height: 300, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, OC: oc, StructParent: 7,
            DecodeParms: { Predictor: 1 },
        }, noisy(270000));
        draw(d, d.addPage(), 'q 100 0 0 100 0 0 cm /I Do Q', { I: img });
    });
    const [c] = E.describeImages(doc, L, E.measurePlacements(doc, L)).candidates;
    const s = E.imageStream(L, doc.context, c.stream, { width: 50, height: 40, filter: 'DCTDecode', channels: 3, bytes: new Uint8Array(10) }, null);
    const h = E.makeHelpers(L, doc.context);
    assert.strictEqual(h.num(h.get(s.dict, 'Width')), 50);
    assert.strictEqual(h.num(h.get(s.dict, 'Height')), 40);
    assert.strictEqual(h.name(h.get(s.dict, 'Filter')), 'DCTDecode');
    assert.strictEqual(h.name(h.get(s.dict, 'ColorSpace')), 'DeviceRGB');
    assert.strictEqual(h.get(s.dict, 'DecodeParms'), undefined);
    assert.ok(h.get(s.dict, 'OC') instanceof L.PDFRef);
    assert.strictEqual(h.num(h.get(s.dict, 'StructParent')), 7);
});

test('a signed form is recognised', async () => {
    const doc = await docWith(async (d, ctx) => {
        d.addPage();
        const sig = ctx.register(ctx.obj({ FT: 'Sig', T: L.PDFString.of('s'), V: ctx.obj({ Type: 'Sig' }) }));
        d.catalog.set(L.PDFName.of('AcroForm'), ctx.obj({ Fields: [sig] }));
    });
    assert.strictEqual(E.isSigned(doc, L), true);
    const plain = await docWith(async (d) => { d.addPage(); });
    assert.strictEqual(E.isSigned(plain, L), false);
});

test('sizes are shown in decimal megabytes', () => {
    assert.strictEqual(E.formatMB(10 * 1000 * 1000), '10 MB');
    assert.strictEqual(E.formatMB(9597192), '9.6 MB');
    assert.strictEqual(E.formatMB(1234567), '1.23 MB');
    assert.strictEqual(E.formatMB(993000), '993 KB');
});

/* ------------------------------------------------ the worker's pixel code */

function pngEncode(raw, rowBytes, bpp, type) {
    const rows = raw.length / rowBytes;
    const out = Buffer.alloc(rows * (rowBytes + 1));
    for (let y = 0; y < rows; y++) {
        out[y * (rowBytes + 1)] = type;
        for (let i = 0; i < rowBytes; i++) {
            const x = raw[y * rowBytes + i];
            const a = i >= bpp ? raw[y * rowBytes + i - bpp] : 0;
            const b = y ? raw[(y - 1) * rowBytes + i] : 0;
            const c = i >= bpp && y ? raw[(y - 1) * rowBytes + i - bpp] : 0;
            let pred = 0;
            if (type === 1) pred = a;
            else if (type === 2) pred = b;
            else if (type === 3) pred = (a + b) >> 1;
            else if (type === 4) {
                const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
            }
            out[y * (rowBytes + 1) + 1 + i] = (x - pred) & 255;
        }
    }
    return out;
}

test('every PNG row filter decodes back to the original samples', () => {
    const w = 17, h = 9, colors = 3;
    const raw = noisy(w * h * colors, 9);
    for (const type of [0, 1, 2, 3, 4]) {
        const back = W.unpredict(pngEncode(raw, w * colors, colors, type), { predictor: 12, colors, bpc: 8, columns: w });
        assert.deepStrictEqual(Buffer.from(back), raw, 'filter ' + type);
    }
});

test('the TIFF predictor adds each sample to the one before it', () => {
    const out = W.unpredict(new Uint8Array([10, 20, 1, 2, 250, 10]), { predictor: 2, colors: 2, bpc: 8, columns: 3 });
    assert.deepStrictEqual([...out], [10, 20, 11, 22, 5, 32]);
});

test('samples of every supported depth and colour space come out as RGBA', () => {
    const px = (arr, i) => [...arr.slice(i * 4, i * 4 + 4)];
    // 4-bit grey: 0x0F is 0 then 15
    let out = W.samplesToRGBA(new Uint8Array([0x0f]), 2, 1, 4, { kind: 'gray', n: 1 });
    assert.deepStrictEqual(px(out, 0), [0, 0, 0, 255]);
    assert.deepStrictEqual(px(out, 1), [255, 255, 255, 255]);
    // 16-bit grey keeps the high byte
    out = W.samplesToRGBA(new Uint8Array([0x80, 0xff]), 1, 1, 16, { kind: 'gray', n: 1 });
    assert.deepStrictEqual(px(out, 0), [128, 128, 128, 255]);
    // CMYK: pure cyan, and pure black
    out = W.samplesToRGBA(new Uint8Array([255, 0, 0, 0, 0, 0, 0, 255]), 2, 1, 8, { kind: 'cmyk', n: 4 });
    assert.deepStrictEqual(px(out, 0), [0, 255, 255, 255]);
    assert.deepStrictEqual(px(out, 1), [0, 0, 0, 255]);
    // 1-bit palette, rows padded to a whole byte
    const cs = { kind: 'indexed', n: 1, base: { kind: 'rgb', n: 3 }, hival: 1, table: new Uint8Array([255, 0, 0, 0, 0, 255]) };
    out = W.samplesToRGBA(new Uint8Array([0b01000000, 0b10000000]), 2, 2, 1, cs);
    assert.deepStrictEqual(px(out, 0), [255, 0, 0, 255]);
    assert.deepStrictEqual(px(out, 1), [0, 0, 255, 255]);
    assert.deepStrictEqual(px(out, 2), [0, 0, 255, 255]);
    // an index past hival is held at hival rather than reading past the table
    out = W.samplesToRGBA(new Uint8Array([7]), 1, 1, 8, cs);
    assert.deepStrictEqual(px(out, 0), [0, 0, 255, 255]);
    assert.throws(() => W.samplesToRGBA(new Uint8Array(3), 2, 2, 8, { kind: 'rgb', n: 3 }), /shorter/);
});

test('grey detection, grey conversion and channel packing', () => {
    const grey = new Uint8ClampedArray([10, 10, 11, 255, 200, 200, 200, 255]);
    assert.strictEqual(W.isGray(grey), true);
    const colour = new Uint8ClampedArray([10, 10, 60, 255]);
    assert.strictEqual(W.isGray(colour), false);
    W.toGray(colour);
    assert.strictEqual(colour[0], colour[2]);
    assert.deepStrictEqual([...W.pack(grey, 1)], [10, 200]);
    assert.deepStrictEqual([...W.pack(grey, 3)], [10, 10, 11, 200, 200, 200]);
});

test('scan clean-up stretches between the black and white points', () => {
    const d = new Uint8ClampedArray([250, 250, 250, 255, 20, 20, 20, 255, 125, 125, 125, 255]);
    W.cleanPixels(d, true, true, 200, 50);
    assert.deepStrictEqual([d[0], d[4], d[8]], [255, 0, 128]);
});

/* Ported from the grayscale tool this one replaced */
function textLines(w, h, angleDeg) {
    const data = new Uint8Array(w * h * 4).fill(255);
    const rad = angleDeg * Math.PI / 180, cx = w / 2, cy = h / 2;
    for (let offset = -100; offset <= 100; offset += 30) {
        for (let x = 50; x < w - 50; x++) {
            if (x % 20 < 5) continue;
            const y = Math.round(cy + offset + (x - cx) * Math.tan(rad));
            for (const yy of [y, y + 1]) {
                if (yy < 0 || yy >= h) continue;
                const i = (yy * w + x) * 4;
                data[i] = data[i + 1] = data[i + 2] = 0;
            }
        }
    }
    return data;
}

test('the tilt of lines of text is measured', () => {
    assert.ok(Math.abs(W.calculateDeskewAngle(textLines(400, 400, 0), 400, 400)) < 0.5);
    assert.ok(Math.abs(W.calculateDeskewAngle(textLines(400, 400, 2), 400, 400) + 2) < 0.5);
    assert.ok(Math.abs(W.calculateDeskewAngle(textLines(400, 400, -3), 400, 400) - 3) < 0.5);
    assert.ok(Math.abs(W.calculateDeskewAngle(new Uint8Array(400 * 400 * 4).fill(255), 400, 400)) < 0.1);
});

(async () => {
    for (const t of pending) await t();
    console.log(`${passed} of ${pending.length} PDF compressor checks passed`);
})();
