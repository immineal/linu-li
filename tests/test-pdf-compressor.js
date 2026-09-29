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
const R = require(path.join(ROOT, 'tools/pdf-compressor/report.js'));

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
        x.cmykJpeg = ctx.register(L.PDFRawStream.of(ctx.obj({ Type: 'XObject', Subtype: 'Image', Width: 300, Height: 300, ColorSpace: 'DeviceCMYK', BitsPerComponent: 8, Filter: 'DCTDecode' }), noisy(9000)));
        x.stencil = image(ctx, { Width: 800, Height: 800, ImageMask: true, BitsPerComponent: 1 }, noisy(100 * 800));
        let ops = '';
        let i = 0;
        for (const n of Object.keys(x)) ops += `q 100 0 0 100 ${i++ * 5} 0 cm /${n} Do Q `;
        draw(d, p, ops, x);
    });
    const a = E.describeImages(doc, L, E.measurePlacements(doc, L));
    assert.strictEqual(a.candidates.length, 0, 'none of these should be rewritten');
    const reasons = a.skipped.map((s) => s.reason).sort();
    assert.deepStrictEqual(reasons, ['bilevel', 'cmyk', 'colourkey', 'colourspace', 'decode', 'jpx', 'stencil']);
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

test('palette, 16-bit and raw CMYK images are read, with the palette handed over', async () => {
    const doc = await docWith(async (d, ctx) => {
        const pal = L.PDFHexString.of('ff0000' + '00ff00');
        const idx = image(ctx, { Width: 400, Height: 400, ColorSpace: ['Indexed', 'DeviceRGB', 1, pal], BitsPerComponent: 1 }, noisy(50 * 400));
        const g16 = image(ctx, { Width: 300, Height: 300, ColorSpace: 'DeviceGray', BitsPerComponent: 16 }, noisy(180000));
        const cmyk = image(ctx, { Width: 300, Height: 300, ColorSpace: 'DeviceCMYK', BitsPerComponent: 8 }, noisy(360000));
        draw(d, d.addPage(), 'q 100 0 0 100 0 0 cm /I Do Q q 100 0 0 100 0 0 cm /G Do Q q 100 0 0 100 0 0 cm /C Do Q', { I: idx, G: g16, C: cmyk });
    });
    const an = E.describeImages(doc, L, E.measurePlacements(doc, L));
    assert.strictEqual(an.candidates.length, 3, 'raw CMYK is resampled as CMYK, so it is a candidate');
    assert.strictEqual(an.cmyk, 1, 'the CMYK image is counted, so turning pages into pictures can say how CMYK comes out');
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
    const s = E.imageStream(L, doc.context, c, { width: 50, height: 40, filter: 'DCTDecode', channels: 3, bytes: new Uint8Array(10) });
    const h = E.makeHelpers(L, doc.context);
    assert.strictEqual(h.num(h.get(s.dict, 'Width')), 50);
    assert.strictEqual(h.num(h.get(s.dict, 'Height')), 40);
    assert.strictEqual(h.name(h.get(s.dict, 'Filter')), 'DCTDecode');
    assert.strictEqual(h.name(h.get(s.dict, 'ColorSpace')), 'DeviceRGB');
    assert.strictEqual(h.get(s.dict, 'DecodeParms'), undefined);
    assert.ok(h.get(s.dict, 'OC') instanceof L.PDFRef);
    assert.strictEqual(h.num(h.get(s.dict, 'StructParent')), 7);
});

test('the colour space stays when the channels do, and turns plain when they change', async () => {
    const doc = await docWith(async (d, ctx) => {
        const icc = ctx.register(L.PDFRawStream.of(ctx.obj({ N: 3 }), new Uint8Array(4)));
        const img = image(ctx, { Width: 300, Height: 300, ColorSpace: ['ICCBased', icc], BitsPerComponent: 8 }, noisy(270000));
        draw(d, d.addPage(), 'q 100 0 0 100 0 0 cm /I Do Q', { I: img });
    });
    const [c] = E.describeImages(doc, L, E.measurePlacements(doc, L)).candidates;
    const h = E.makeHelpers(L, doc.context);
    const base = { width: 10, height: 10, bytes: new Uint8Array(1) };
    const kept = E.imageStream(L, doc.context, c, Object.assign({ filter: 'DCTDecode', channels: 3 }, base));
    assert.ok(h.lookup(h.get(kept.dict, 'ColorSpace')) instanceof L.PDFArray, 'the ICC profile went missing');
    const grey = E.imageStream(L, doc.context, c, Object.assign({ filter: 'FlateDecode', channels: 1 }, base));
    assert.strictEqual(h.name(h.get(grey.dict, 'ColorSpace')), 'DeviceGray');
    const converted = E.imageStream(L, doc.context, c, Object.assign({ filter: 'DCTDecode', channels: 3, converted: true }, base));
    assert.strictEqual(h.name(h.get(converted.dict, 'ColorSpace')), 'DeviceRGB');
});

test('a grey profile stays with grey pixels, a palette hands over its base space', async () => {
    const doc = await docWith(async (d, ctx) => {
        const grayIcc = ctx.register(L.PDFRawStream.of(ctx.obj({ N: 1 }), new Uint8Array(4)));
        const rgbIcc = ctx.register(L.PDFRawStream.of(ctx.obj({ N: 3 }), new Uint8Array(4)));
        const g = image(ctx, { Width: 300, Height: 300, ColorSpace: ['ICCBased', grayIcc], BitsPerComponent: 8 }, noisy(90000, 3));
        const pal = image(ctx, { Width: 300, Height: 300, ColorSpace: ['Indexed', ['ICCBased', rgbIcc], 1, L.PDFHexString.of('ff000000ff00')], BitsPerComponent: 8 }, noisy(90000, 4));
        const plain = image(ctx, { Width: 300, Height: 300, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }, noisy(270000, 5));
        draw(d, d.addPage(), 'q 100 0 0 100 0 0 cm /G Do Q q 100 0 0 100 0 0 cm /P Do Q q 100 0 0 100 0 0 cm /R Do Q', { G: g, P: pal, R: plain });
    });
    const an = E.describeImages(doc, L, E.measurePlacements(doc, L));
    const by = Object.fromEntries(an.candidates.map((c) => [c.info.cs.kind === 'indexed' ? 'pal' : c.info.cs.kind, c]));
    const h = E.makeHelpers(L, doc.context);
    const base = { width: 10, height: 10, bytes: new Uint8Array(1), filter: 'DCTDecode' };
    const grey = E.imageStream(L, doc.context, by.gray, Object.assign({ channels: 1 }, base));
    assert.strictEqual(h.name(h.lookup(h.get(grey.dict, 'ColorSpace')).get(0)), 'ICCBased', 'the grey profile went missing');
    const pal = E.imageStream(L, doc.context, by.pal, Object.assign({ channels: 3 }, base));
    assert.strictEqual(h.name(h.lookup(h.get(pal.dict, 'ColorSpace')).get(0)), 'ICCBased', 'the palette base went missing');
    const reduced = E.imageStream(L, doc.context, by.rgb, Object.assign({ channels: 1 }, base));
    assert.strictEqual(h.name(h.get(reduced.dict, 'ColorSpace')), 'DeviceGray', 'plain RGB that turned out grey is stored as grey');
    assert.strictEqual(E.jobFor(by.gray).cs.managed, true);
    assert.strictEqual(E.jobFor(by.pal).cs.base.managed, true);
    assert.strictEqual(E.jobFor(by.rgb).cs.managed, false);
});

test('the grey JPEG encoder writes a valid one-channel baseline file for any size', () => {
    for (const [w, h] of [[1, 1], [9, 17], [640, 480]]) {
        const px = new Uint8Array(w * h).map((_, i) => (i * 37) & 255);
        const j = W.encodeGrayJpeg(px, w, h, 0.72);
        assert.deepStrictEqual([j[0], j[1], j[j.length - 2], j[j.length - 1]], [0xff, 0xd8, 0xff, 0xd9]);
        const sof = j.indexOf(0xc0, 2);
        assert.strictEqual(j[sof - 1], 0xff);
        assert.strictEqual((j[sof + 4] << 8) | j[sof + 5], h);
        assert.strictEqual((j[sof + 6] << 8) | j[sof + 7], w);
        assert.strictEqual(j[sof + 8], 1, 'one component');
        // no unstuffed FF inside the scan data
        let sos = sof;
        while (!(j[sos] === 0xff && j[sos + 1] === 0xda)) sos++;
        sos += 2 + ((j[sos + 2] << 8) | j[sos + 3]);
        for (let k = sos; k < j.length - 2; k++) if (j[k] === 0xff) assert.ok(j[k + 1] === 0x00, 'FF not stuffed at ' + k);
    }
});

test('JPEG extras a browser could act on are removed before decoding', () => {
    const seg = (m, text) => { const b = Buffer.from(text); return Buffer.concat([Buffer.from([0xff, m, (b.length + 2) >> 8, (b.length + 2) & 255]), b]); };
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe0, 'JFIF\0'), seg(0xe1, 'Exif\0\0'), seg(0xe2, 'ICC_PROFILE\0'), seg(0xee, 'Adobe'), Buffer.from([0xff, 0xda, 0, 2, 7, 0xff, 0xd9])]);
    const out = Buffer.from(W.plainJpeg(new Uint8Array(jpg)));
    assert.ok(!out.includes('Exif') && !out.includes('ICC_PROFILE'));
    assert.ok(out.includes('JFIF') && out.includes('Adobe'));
    assert.deepStrictEqual([...out.subarray(-7)], [0xff, 0xda, 0, 2, 7, 0xff, 0xd9]);
    const plain = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 2, 0xff, 0xd9]);
    assert.strictEqual(W.plainJpeg(plain), plain, 'nothing to drop, nothing copied');
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

/* ------------------------------------------------ what the page says */

function session(over) {
    const cand = (key, extra) => Object.assign({ key, info: { cs: { kind: 'rgb', n: 3 } } }, extra);
    return Object.assign({
        bytes: new Uint8Array(8e6), signed: false, encrypted: false, baseBytes: 1.2e6,
        failures: new Map(),
        tidyInfo: { removed: 0, removedBytes: 0, deflated: 0, thumbs: 0 },
        analysis: {
            candidates: [cand('a'), cand('b'), cand('c', { info: { cs: { kind: 'cmyk', n: 4 } } })],
            skipped: [{ key: 'j', reason: 'jpx' }, { key: 't', reason: 'tiny' }],
            byPage: [new Map([['a', 100]]), new Map([['b', 5000], ['c', 10]])],
        },
    }, over);
}
const opts = { method: 'images', gray: false, clean: false, angle: 0, white: 200, black: 50 };

test('the report counts what happened to each image, in the right number', () => {
    const r = {
        kind: 'images', fits: true, target: 5e6, bytes: new Uint8Array(4.8e6), opts,
        level: { ppi: 150, quality: 0.72 },
        outcomes: new Map([
            ['a', { accept: true, scale: 0.5, res: { filter: 'DCTDecode' } }],
            ['b', { accept: true, scale: 1, res: { filter: 'FlateDecode' } }],
            ['c', { accept: true, scale: 0.4, res: { filter: 'DCTDecode' } }],
        ]),
    };
    const lines = R.describe(r, session());
    assert.ok(lines.includes('3 of 4 images rewritten.'), lines.join('\n'));
    assert.ok(lines.some((l) => l.startsWith('2 images had more pixels than 150 ppi at the size they are printed and were scaled down')));
    assert.ok(lines.includes('2 images are JPEG at quality 72 now.'));
    assert.ok(lines.includes('1 image was stored losslessly, which came out smaller for it than JPEG.'));
    assert.ok(lines.some((l) => l.startsWith('1 image left alone: JPEG 2000')));
    assert.ok(!lines.some((l) => l.includes('tiny')), 'tiny images are not worth a line');
    assert.strictEqual(R.advice(r, session()), null);
});

test('a tidy that is enough says so, and names what it removed', () => {
    const s = session({ tidyInfo: { removed: 3, removedBytes: 2e6, deflated: 0, thumbs: 1 } });
    const r = { kind: 'images', fits: true, target: 8e6, bytes: new Uint8Array(6e6), opts, level: null, outcomes: new Map() };
    const lines = R.describe(r, s);
    assert.strictEqual(lines[0], 'No image had to be touched. Writing the file out again more compactly was enough.');
    assert.ok(lines.some((l) => l.startsWith('Removed 3 objects')));
    assert.ok(lines.some((l) => l.startsWith('Dropped 1 embedded page thumbnail;')));
    assert.ok(!lines.some((l) => l.includes('left as they were')), 'nothing was tried, so nothing was kept back');
});

test('the original comes back with a reason, and the signature and encryption are mentioned', () => {
    const s = session({ signed: true });
    assert.match(R.describe({ kind: 'original', target: 10e6, fits: true }, s)[0], /already 8 MB, under the 10 MB/);
    assert.match(R.describe({ kind: 'original', notSmaller: true, tried: 'pages', target: 1e6 }, s)[0], /pages came out larger/);
    const pages = { kind: 'pages', fits: true, target: 5e6, bytes: new Uint8Array(1), level: { dpi: 150, quality: 0.72 }, capped: 2,
        opts: Object.assign({}, opts, { method: 'pages', clean: true, angle: 0.4 }) };
    const lines = R.describe(pages, session({ signed: true, encrypted: true }));
    assert.ok(lines[0].startsWith('Every page is now a JPEG picture at 150 dpi, quality 72.'));
    assert.ok(lines.includes('2 pages were too large to render at 150 dpi in a browser and came out at less.'));
    assert.ok(lines.includes('Every page turned by 0.4°.'));
    assert.ok(lines.includes('The original was encrypted. The result is not.'));
    assert.ok(lines.some((l) => l.includes('digitally signed')));
});

test('advice when the target was missed offers the other method only where it can help', () => {
    const over = { kind: 'images', fits: false, target: 1e6, bytes: new Uint8Array(1.7e6), opts, level: { ppi: 150, quality: 0.72 }, stoppedEarly: true, outcomes: new Map() };
    let a = R.advice(over, session());
    assert.ok(a.offerPages);
    assert.match(a.text, /About 1.2 MB of the file is text, fonts and drawings/);
    assert.match(a.text, /stopped at 150 ppi/);
    a = R.advice(over, session({ analysis: { candidates: [], skipped: [], byPage: [] } }));
    assert.match(a.text, /no images in this file that could be shrunk/);
    a = R.advice({ kind: 'pages', fits: false, target: 1e5, bytes: new Uint8Array(3e5), level: { dpi: 30 }, opts }, session());
    assert.strictEqual(a.offerPages, false);
    assert.match(a.text, /Even at 30 dpi, the lowest setting/);
    a = R.advice({ kind: 'original', notSmaller: true, tried: 'pages', fits: false, target: 1e5 }, session());
    assert.strictEqual(a.offerPages, false);
});

test('the preview opens where the images lost the most', () => {
    const r = { kind: 'images', outcomes: new Map([
        ['a', { accept: true, scale: 0.2 }],
        ['b', { accept: true, scale: 0.5 }],
        ['c', { accept: false }],
    ]) };
    // page 1: 100 * 0.85 = 85; page 2: 5000 * 0.55 = 2750
    assert.deepStrictEqual(R.previewPage(r, session()), { page: 2, chosen: true });
    assert.deepStrictEqual(R.previewPage({ kind: 'pages' }, session()), { page: 1, chosen: false });
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

test('CMYK is split for scaling without converting a single value', () => {
    const src = new Uint8Array([10, 20, 30, 40, 250, 0, 128, 255]);
    const { cmy, k } = W.cmykPlanes(src, 2, 1, 8);
    assert.deepStrictEqual([...cmy], [10, 20, 30, 255, 250, 0, 128, 255]);
    assert.deepStrictEqual([k[0], k[4]], [40, 255]);
    const wide = W.cmykPlanes(new Uint8Array([0x80, 0, 0x40, 0, 0x20, 0, 0x10, 0]), 1, 1, 16);
    assert.deepStrictEqual([wide.cmy[0], wide.cmy[1], wide.cmy[2], wide.k[0]], [128, 64, 32, 16]);
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
