/* The decisions behind the PDF compressor, kept apart from the page so that
   tests/test-pdf-compressor.js can run them in Node against the same
   pdf-lib the page uses.

   Nothing in here touches the DOM, a canvas or a worker. It reads a PDF that
   pdf-lib has loaded, says which images can be rewritten and how large each
   one is drawn, and picks a setting from a ladder. The pixel work happens in
   worker.js, the orchestration in index.html. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.Verkleinerer = api;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* Sizes are decimal: 10 MB is 10,000,000 bytes. Upload forms disagree on
       whether a megabyte has 1,000,000 or 1,048,576 bytes, and the smaller
       reading satisfies both. */
    const MB = 1000 * 1000;
    const TARGETS_MB = [1, 2, 3, 5, 8, 10, 12, 15, 20, 25, 50];

    /* Headroom under the target. The estimate adds up encoded image sizes
       and a measured remainder, and pdf-lib's object streams compress a
       little differently from one save to the next. 1.5 % has been enough
       for every file tried; the real size is checked afterwards anyway. */
    const HEADROOM = 0.985;

    /* Gentlest first. Each rung is smaller than the one before for any
       ordinary image, which is what lets the search halve the ladder. The
       resolution is the most an image keeps at the size it is printed on
       the page, so a photo drawn across a whole A4 page at 150 ppi ends up
       1240 pixels wide whatever it started as. */
    const IMAGE_LEVELS = [
        { ppi: 300, quality: 0.85 },
        { ppi: 250, quality: 0.82 },
        { ppi: 200, quality: 0.80 },
        { ppi: 175, quality: 0.76 },
        { ppi: 150, quality: 0.72 },
        { ppi: 150, quality: 0.62 },
        { ppi: 125, quality: 0.60 },
        { ppi: 110, quality: 0.55 },
        { ppi: 100, quality: 0.50 },
        { ppi: 90, quality: 0.46 },
        { ppi: 80, quality: 0.42 },
        { ppi: 72, quality: 0.40 },
        { ppi: 60, quality: 0.36 },
        { ppi: 50, quality: 0.32 },
        { ppi: 40, quality: 0.28 },
        { ppi: 30, quality: 0.25 },
    ];

    /* For turning whole pages into pictures. 200 dpi keeps 8 pt type
       readable; below 100 small print starts to smear, below 72 it goes. */
    const PAGE_LEVELS = [
        { dpi: 200, quality: 0.80 },
        { dpi: 175, quality: 0.76 },
        { dpi: 150, quality: 0.72 },
        { dpi: 150, quality: 0.60 },
        { dpi: 125, quality: 0.58 },
        { dpi: 110, quality: 0.52 },
        { dpi: 100, quality: 0.48 },
        { dpi: 90, quality: 0.45 },
        { dpi: 80, quality: 0.42 },
        { dpi: 72, quality: 0.40 },
        { dpi: 60, quality: 0.36 },
        { dpi: 50, quality: 0.32 },
        { dpi: 40, quality: 0.28 },
        { dpi: 30, quality: 0.25 },
    ];

    /* Browsers refuse canvases above roughly 16.7 million pixels (Safari)
       and sometimes much less on phones. A page that would come out larger
       is rendered at a lower resolution instead, and the result says so. */
    const MAX_CANVAS_PIXELS = 16 * 1000 * 1000;

    /* Decoding needs the whole image in memory as RGBA. 64 megapixels is
       256 MB, which a desktop manages and a phone may not; larger images are
       left as they are rather than taking the tab down. */
    const MAX_SOURCE_PIXELS = 64 * 1000 * 1000;

    /* Images this small cannot save anything worth a rewrite. */
    const MIN_IMAGE_BYTES = 4 * 1024;

    function formatMB(bytes) {
        const mb = bytes / MB;
        if (mb >= 100) return Math.round(mb) + ' MB';
        if (mb >= 10) return mb.toFixed(1).replace(/\.0$/, '') + ' MB';
        if (mb >= 1) return mb.toFixed(2).replace(/0$/, '').replace(/\.0$/, '') + ' MB';
        const kb = bytes / 1000;
        return (kb >= 10 ? Math.round(kb) : kb.toFixed(1)) + ' KB';
    }

    /* What a resolution means for someone reading the result. */
    function verdict(ppi) {
        if (ppi >= 200) return 'Prints as sharp as the original would at this size.';
        if (ppi >= 150) return 'Fine on screen and in print. Very small type may look a little soft on paper.';
        if (ppi >= 100) return 'Fine on screen. Printed, fine detail and small type in scanned pages go soft.';
        if (ppi >= 72) return 'Readable on screen at normal zoom. Small type in scanned pages is getting hard to read.';
        return 'Rough. Small type in scanned pages will be hard or impossible to read.';
    }

    /* ---------------------------------------------------------- matrices */

    /* PDF matrices are [a b c d e f] for row vectors, so "apply m1, then
       m2" is m1 × m2. `cm` sets the CTM to M × CTM. */
    function multiply(m1, m2) {
        return [
            m1[0] * m2[0] + m1[1] * m2[2],
            m1[0] * m2[1] + m1[1] * m2[3],
            m1[2] * m2[0] + m1[3] * m2[2],
            m1[2] * m2[1] + m1[3] * m2[3],
            m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
            m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
        ];
    }
    const IDENTITY = [1, 0, 0, 1, 0, 0];

    /* ------------------------------------------------ content streams */

    /* A tokenizer that knows just enough of the content stream syntax to
       follow q, Q, cm and Do. It still has to get strings, hex strings,
       dictionaries and inline images right, because a ")" or an "EI" inside
       any of them would otherwise throw every later operator off. */
    function isWhite(c) { return c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00; }
    function isDelim(c) {
        return c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d ||
            c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25;
    }

    function walkContent(bytes, onOperator) {
        const n = bytes.length;
        let i = 0;
        const operands = [];

        while (i < n) {
            const c = bytes[i];
            if (isWhite(c)) { i++; continue; }
            if (c === 0x25) { // % comment to end of line
                while (i < n && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
                continue;
            }
            if (c === 0x28) { // (string), nested parentheses and escapes
                let depth = 1; i++;
                while (i < n && depth > 0) {
                    const d = bytes[i];
                    if (d === 0x5c) i += 2;
                    else { if (d === 0x28) depth++; else if (d === 0x29) depth--; i++; }
                }
                operands.push(null);
                continue;
            }
            if (c === 0x3c) {
                if (bytes[i + 1] === 0x3c) { i += 2; operands.push(null); continue; } // << of an inline dict
                while (i < n && bytes[i] !== 0x3e) i++; // <hex>
                i++;
                operands.push(null);
                continue;
            }
            if (c === 0x3e) { i += (bytes[i + 1] === 0x3e) ? 2 : 1; continue; }
            if (c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d) { i++; operands.push(null); continue; }
            if (c === 0x2f) { // /Name
                let j = i + 1;
                while (j < n && !isWhite(bytes[j]) && !isDelim(bytes[j])) j++;
                operands.push({ name: decodeName(bytes, i + 1, j) });
                i = j;
                continue;
            }
            // A number or an operator: read to the next delimiter
            let j = i;
            while (j < n && !isWhite(bytes[j]) && !isDelim(bytes[j])) j++;
            if (j === i) { i++; continue; }
            const word = latin1(bytes, i, j);
            i = j;
            const num = Number(word);
            if (word !== '' && !Number.isNaN(num) && /^[+\-.\d]/.test(word)) {
                operands.push(num);
                continue;
            }
            if (word === 'BI') {
                // Inline image: its data is binary and ends at an EI that
                // stands on its own between white space.
                i = skipInlineImage(bytes, i);
                operands.length = 0;
                continue;
            }
            if (onOperator(word, operands) === false) return;
            operands.length = 0;
        }
    }

    function skipInlineImage(bytes, i) {
        const n = bytes.length;
        // Find "ID" as its own word
        while (i < n - 1) {
            if (bytes[i] === 0x49 && bytes[i + 1] === 0x44 && (i === 0 || isWhite(bytes[i - 1])) &&
                (i + 2 >= n || isWhite(bytes[i + 2]))) { i += 3; break; }
            i++;
        }
        while (i < n - 1) {
            if (bytes[i] === 0x45 && bytes[i + 1] === 0x49 && isWhite(bytes[i - 1]) &&
                (i + 2 >= n || isWhite(bytes[i + 2]) || isDelim(bytes[i + 2]))) return i + 2;
            i++;
        }
        return n;
    }

    function latin1(bytes, from, to) {
        let s = '';
        for (let k = from; k < to; k++) s += String.fromCharCode(bytes[k]);
        return s;
    }

    function decodeName(bytes, from, to) {
        // #xx escapes, as pdf-lib stores names decoded
        let s = '';
        for (let k = from; k < to; k++) {
            if (bytes[k] === 0x23 && k + 2 < to) {
                const hex = String.fromCharCode(bytes[k + 1], bytes[k + 2]);
                if (/^[0-9a-fA-F]{2}$/.test(hex)) { s += String.fromCharCode(parseInt(hex, 16)); k += 2; continue; }
            }
            s += String.fromCharCode(bytes[k]);
        }
        return s;
    }

    /* ------------------------------------------------ reading a PDF */

    function refKey(ref) { return ref.objectNumber + ' ' + ref.generationNumber; }

    function makeHelpers(L, context) {
        const lookup = (obj) => (obj instanceof L.PDFRef ? context.lookup(obj) : obj);
        const name = (obj) => {
            obj = lookup(obj);
            return obj instanceof L.PDFName ? obj.decodeText() : null;
        };
        const num = (obj) => {
            obj = lookup(obj);
            return obj instanceof L.PDFNumber ? obj.asNumber() : null;
        };
        const bool = (obj) => {
            obj = lookup(obj);
            return obj instanceof L.PDFBool ? obj.asBoolean() : false;
        };
        const get = (dict, key) => (dict ? dict.get(L.PDFName.of(key)) : undefined);
        const has = (dict, key) => get(dict, key) !== undefined;
        const decodeStream = (stream) => {
            if (!(stream instanceof L.PDFRawStream)) {
                if (stream && typeof stream.getContents === 'function') return stream.getContents();
                return new Uint8Array(0);
            }
            if (!has(stream.dict, 'Filter')) return stream.contents;
            return L.decodePDFRawStream(stream).decode();
        };
        return { lookup, name, num, bool, get, has, decodeStream };
    }

    /* How large each image is drawn, in points. Walks every page's content
       and every form XObject it paints, tracking the CTM, and keeps for each
       image the largest size it appears at: that is where it needs its
       pixels most. Images only reachable some other way (patterns,
       annotation appearances, Type 3 glyphs) are missing from the result
       and get a fallback in describeImages. */
    function measurePlacements(pdfDoc, L, opts) {
        const context = pdfDoc.context;
        const h = makeHelpers(L, context);
        const budget = { ops: (opts && opts.maxOperators) || 20 * 1000 * 1000 };
        const placements = new Map(); // refKey -> { wPt, hPt, ppiScale }
        const formCache = new Map(); // refKey -> [{ ref, m }] in form space
        const problems = [];
        const byPage = []; // per page: refKey -> area in square points

        function note(ref, m) {
            const wPt = Math.hypot(m[0], m[1]);
            const hPt = Math.hypot(m[2], m[3]);
            if (!(wPt > 0.01 && hPt > 0.01)) return;
            const key = refKey(ref);
            const prev = placements.get(key);
            if (!prev) placements.set(key, { wPt, hPt, uses: 1 });
            else {
                prev.uses++;
                // Larger area means fewer pixels per inch: keep that one
                if (wPt * hPt > prev.wPt * prev.hPt) { prev.wPt = wPt; prev.hPt = hPt; }
            }
        }

        function xobjectsOf(resources) {
            const res = h.lookup(resources);
            if (!(res instanceof L.PDFDict)) return null;
            const x = h.lookup(h.get(res, 'XObject'));
            return x instanceof L.PDFDict ? x : null;
        }

        /* Placements inside a form, relative to the form's own space. A logo
           drawn on every page is walked once. */
        function formPlacements(formRef, inheritedResources, depth) {
            const key = refKey(formRef);
            if (formCache.has(key)) return formCache.get(key);
            formCache.set(key, []); // a form that draws itself stops here
            const form = context.lookup(formRef);
            const own = h.get(form.dict, 'Resources');
            const list = collect(h.decodeStream(form), own !== undefined ? own : inheritedResources, depth + 1);
            formCache.set(key, list);
            return list;
        }

        function collect(content, resources, depth) {
            const out = [];
            if (depth > 12) return out;
            const xobjects = xobjectsOf(resources);
            let ctm = IDENTITY;
            const stack = [];
            walkContent(content, (op, args) => {
                if (--budget.ops < 0) return false;
                if (op === 'q') stack.push(ctm);
                else if (op === 'Q') { if (stack.length) ctm = stack.pop(); }
                else if (op === 'cm') {
                    if (args.length >= 6 && args.slice(-6).every((a) => typeof a === 'number')) {
                        ctm = multiply(args.slice(-6), ctm);
                    }
                } else if (op === 'Do' && xobjects) {
                    const nm = args[args.length - 1];
                    if (!nm || !nm.name) return;
                    const ref = xobjects.get(L.PDFName.of(nm.name));
                    if (!(ref instanceof L.PDFRef)) return;
                    const obj = context.lookup(ref);
                    if (!(obj instanceof L.PDFStream)) return;
                    const sub = h.name(h.get(obj.dict, 'Subtype'));
                    if (sub === 'Image') out.push({ ref, m: ctm });
                    else if (sub === 'Form') {
                        const mArr = h.lookup(h.get(obj.dict, 'Matrix'));
                        let fm = IDENTITY;
                        if (mArr instanceof L.PDFArray && mArr.size() === 6) {
                            const vals = mArr.asArray().map((v) => h.num(v));
                            if (vals.every((v) => typeof v === 'number')) fm = vals;
                        }
                        const base = multiply(fm, ctm);
                        for (const p of formPlacements(ref, resources, depth)) {
                            out.push({ ref: p.ref, m: multiply(p.m, base) });
                        }
                    }
                }
            });
            return out;
        }

        const pages = pdfDoc.getPages();
        pages.forEach((page, index) => {
            try {
                const node = page.node;
                const contents = h.lookup(node.get(L.PDFName.of('Contents')));
                const parts = [];
                if (contents instanceof L.PDFArray) {
                    for (const c of contents.asArray()) {
                        const s = h.lookup(c);
                        if (s instanceof L.PDFStream) parts.push(h.decodeStream(s));
                    }
                } else if (contents instanceof L.PDFStream) {
                    parts.push(h.decodeStream(contents));
                }
                // The parts of a page are one stream cut in pieces; a token may
                // straddle the cut, so they are joined with a space, as the
                // spec says a reader should.
                let total = 0;
                parts.forEach((p) => { total += p.length + 1; });
                const joined = new Uint8Array(total);
                let at = 0;
                for (const p of parts) { joined.set(p, at); at += p.length; joined[at++] = 0x20; }
                const found = collect(joined, node.Resources(), 0);
                const onPage = new Map();
                for (const p of found) {
                    note(p.ref, p.m);
                    const area = Math.hypot(p.m[0], p.m[1]) * Math.hypot(p.m[2], p.m[3]);
                    const key = refKey(p.ref);
                    onPage.set(key, Math.max(onPage.get(key) || 0, area));
                }
                byPage[index] = onPage;
            } catch (err) {
                byPage[index] = new Map();
                problems.push({ page: index + 1, message: String(err && err.message || err) });
            }
        });

        return { placements, byPage, problems, exhausted: budget.ops < 0 };
    }

    /* Every image in the file, with what can be done about it. */
    function describeImages(pdfDoc, L, placementInfo) {
        const context = pdfDoc.context;
        const h = makeHelpers(L, context);
        const placements = placementInfo ? placementInfo.placements : new Map();

        // Largest page, for images whose placement is unknown; Letter if
        // the file somehow has none
        let maxW = 0, maxH = 0;
        for (const p of pdfDoc.getPages()) {
            const { width, height } = p.getSize();
            if (width * height > maxW * maxH) { maxW = width; maxH = height; }
        }
        if (!(maxW > 0 && maxH > 0)) { maxW = 612; maxH = 792; }

        const all = [];
        const maskUse = new Map(); // refKey -> number of images that use it as SMask or Mask
        const fontFiles = new Set();

        for (const [ref, obj] of context.enumerateIndirectObjects()) {
            if (obj instanceof L.PDFDict && h.name(h.get(obj, 'Type')) === 'FontDescriptor') {
                for (const k of ['FontFile', 'FontFile2', 'FontFile3']) {
                    const f = h.get(obj, k);
                    if (f instanceof L.PDFRef) fontFiles.add(refKey(f));
                }
            }
            if (!(obj instanceof L.PDFRawStream)) continue;
            if (h.name(h.get(obj.dict, 'Subtype')) !== 'Image') continue;
            all.push({ ref, stream: obj });
            for (const k of ['SMask', 'Mask']) {
                const m = h.get(obj.dict, k);
                if (m instanceof L.PDFRef) maskUse.set(refKey(m), (maskUse.get(refKey(m)) || 0) + 1);
            }
        }

        let imageBytes = 0, fontBytes = 0, otherBytes = 0;
        for (const [ref, obj] of context.enumerateIndirectObjects()) {
            if (!(obj instanceof L.PDFRawStream)) continue;
            const len = obj.contents.length;
            if (h.name(h.get(obj.dict, 'Subtype')) === 'Image') imageBytes += len;
            else if (fontFiles.has(refKey(ref))) fontBytes += len;
            else otherBytes += len;
        }

        const candidates = [];
        const skipped = [];
        for (const { ref, stream } of all) {
            const key = refKey(ref);
            if (maskUse.has(key)) continue; // handled with the image it belongs to
            const info = classify(stream, h, L, context);
            const size = stream.contents.length;
            if (!info.ok) { skipped.push({ key, bytes: size, reason: info.reason }); continue; }

            let smask = null, smaskBytes = 0;
            const smRef = h.get(stream.dict, 'SMask');
            if (smRef instanceof L.PDFRef) {
                const sm = context.lookup(smRef);
                const smInfo = sm instanceof L.PDFRawStream ? classifyMask(sm, h, L) : { ok: false };
                // A mask shared between images keeps its size; so does one
                // this code cannot read. The image itself is still fair game.
                if (smInfo.ok && maskUse.get(refKey(smRef)) === 1) {
                    smask = { ref: smRef, stream: sm, info: smInfo };
                    smaskBytes = sm.contents.length;
                }
            }

            const total = size + smaskBytes;
            if (total < MIN_IMAGE_BYTES) { skipped.push({ key, bytes: total, reason: 'tiny' }); continue; }

            const place = placements.get(key);
            let wPt, hPt, placed = true;
            if (place) { wPt = place.wPt; hPt = place.hPt; }
            else {
                // Not found on any page: assume it fills the largest page,
                // which errs towards keeping pixels.
                placed = false;
                const fit = Math.min(maxW / info.width, maxH / info.height);
                wPt = info.width * fit; hPt = info.height * fit;
            }
            const ppi = Math.min(info.width * 72 / wPt, info.height * 72 / hPt);

            candidates.push({
                key, ref, stream, info, smask, bytes: total, ppi, placed,
            });
        }

        // Images whose colours depend on a profile or on CMYK. Turning pages
        // into pictures goes through pdf.js, which draws those with plain
        // device colours, so the result says so when there are any.
        let profiled = 0;
        for (const { stream } of all) {
            const cs = colourSpaceOf(h.get(stream.dict, 'ColorSpace'), h, L, context, 0);
            if (cs.ok && (cs.managed || cs.kind === 'cmyk' || (cs.base && (cs.base.managed || cs.base.kind === 'cmyk')))) profiled++;
        }

        return { candidates, skipped, imageBytes, fontBytes, otherBytes, profiled };
    }

    function colourSpaceOf(cs, h, L, context, depth) {
        cs = h.lookup(cs);
        if (depth > 3 || cs === undefined) return { ok: false, reason: 'colourspace' };
        if (cs instanceof L.PDFName) {
            const n = cs.decodeText();
            if (n === 'DeviceGray' || n === 'CalGray' || n === 'G') return { ok: true, kind: 'gray', n: 1 };
            if (n === 'DeviceRGB' || n === 'CalRGB' || n === 'RGB') return { ok: true, kind: 'rgb', n: 3 };
            if (n === 'DeviceCMYK' || n === 'CMYK') return { ok: true, kind: 'cmyk', n: 4 };
            return { ok: false, reason: 'colourspace' };
        }
        if (cs instanceof L.PDFArray && cs.size() > 0) {
            const family = h.name(cs.get(0));
            if (family === 'ICCBased') {
                const profile = h.lookup(cs.get(1));
                const n = profile && profile.dict ? h.num(h.get(profile.dict, 'N')) : null;
                // managed: the numbers mean something only through a profile
                // or a calibration, which a rewrite has to carry over intact
                if (n === 1) return { ok: true, kind: 'gray', n: 1, managed: true };
                if (n === 3) return { ok: true, kind: 'rgb', n: 3, managed: true };
                if (n === 4) return { ok: true, kind: 'cmyk', n: 4, managed: true };
                return { ok: false, reason: 'colourspace' };
            }
            if (family === 'CalRGB') return { ok: true, kind: 'rgb', n: 3, managed: true };
            if (family === 'CalGray') return { ok: true, kind: 'gray', n: 1, managed: true };
            if (family === 'Indexed' || family === 'I') {
                const base = colourSpaceOf(cs.get(1), h, L, context, depth + 1);
                if (!base.ok || base.kind === 'indexed') return { ok: false, reason: 'colourspace' };
                const hival = h.num(cs.get(2));
                const lk = h.lookup(cs.get(3));
                let table = null;
                if (lk instanceof L.PDFString || lk instanceof L.PDFHexString) table = lk.asBytes();
                else if (lk instanceof L.PDFStream) table = h.decodeStream(lk);
                if (hival === null || !table) return { ok: false, reason: 'colourspace' };
                return { ok: true, kind: 'indexed', n: 1, base, hival, table };
            }
        }
        return { ok: false, reason: 'colourspace' };
    }

    function filtersOf(dict, h, L) {
        const f = h.lookup(h.get(dict, 'Filter'));
        const p = h.lookup(h.get(dict, 'DecodeParms'));
        const filters = [];
        const parms = [];
        if (f instanceof L.PDFName) { filters.push(f.decodeText()); parms.push(p); }
        else if (f instanceof L.PDFArray) {
            f.asArray().forEach((x, i) => {
                filters.push(h.name(x));
                parms.push(p instanceof L.PDFArray ? h.lookup(p.get(i)) : null);
            });
        }
        return { filters, parms };
    }

    const SHORT_FILTERS = { AHx: 'ASCIIHexDecode', A85: 'ASCII85Decode', LZW: 'LZWDecode', Fl: 'FlateDecode', RL: 'RunLengthDecode', DCT: 'DCTDecode', CCF: 'CCITTFaxDecode' };
    const READABLE_FILTERS = new Set(['ASCIIHexDecode', 'ASCII85Decode', 'LZWDecode', 'FlateDecode', 'RunLengthDecode']);

    function predictorOf(parms, h, L) {
        if (!(parms instanceof L.PDFDict)) return null;
        const predictor = h.num(h.get(parms, 'Predictor')) || 1;
        if (predictor < 2) return null;
        return {
            predictor,
            colors: h.num(h.get(parms, 'Colors')) || 1,
            bpc: h.num(h.get(parms, 'BitsPerComponent')) || 8,
            columns: h.num(h.get(parms, 'Columns')) || 1,
        };
    }

    function classify(stream, h, L, context) {
        const d = stream.dict;
        if (h.bool(h.get(d, 'ImageMask'))) return { ok: false, reason: 'stencil' };
        const width = h.num(h.get(d, 'Width'));
        const height = h.num(h.get(d, 'Height'));
        if (!(width > 0 && height > 0)) return { ok: false, reason: 'broken' };
        if (width * height > MAX_SOURCE_PIXELS) return { ok: false, reason: 'huge' };

        const { filters: raw, parms } = filtersOf(d, h, L);
        const filters = raw.map((f) => SHORT_FILTERS[f] || f);
        if (filters.some((f) => f === null)) return { ok: false, reason: 'broken' };
        const last = filters[filters.length - 1];
        if (last === 'JPXDecode') return { ok: false, reason: 'jpx' };
        if (last === 'JBIG2Decode' || last === 'CCITTFaxDecode') return { ok: false, reason: 'bilevel' };
        const pre = last === 'DCTDecode' ? filters.slice(0, -1) : filters;
        if (!pre.every((f) => READABLE_FILTERS.has(f))) return { ok: false, reason: 'filter' };
        const dct = last === 'DCTDecode';

        // A colour key mask picks out exact colours, which any lossy
        // rewrite would miss. A /Decode array remaps samples; rare, and
        // not worth getting subtly wrong.
        const mask = h.lookup(h.get(d, 'Mask'));
        if (mask instanceof L.PDFArray) return { ok: false, reason: 'colourkey' };
        if (h.has(d, 'Decode')) return { ok: false, reason: 'decode' };

        const cs = colourSpaceOf(h.get(d, 'ColorSpace'), h, L, context, 0);
        if (!cs.ok) return { ok: false, reason: cs.reason };
        const bpc = h.num(h.get(d, 'BitsPerComponent')) || 8;

        // CMYK only comes out right through the printer's profile, which a
        // browser does not have, so it is never converted. Stored raw it can
        // still be resampled channel by channel and kept as CMYK (worker.js);
        // a CMYK JPEG or palette cannot.
        if (cs.kind === 'indexed' && cs.base.kind === 'cmyk') return { ok: false, reason: 'cmyk' };

        if (dct) {
            if (cs.kind === 'cmyk') return { ok: false, reason: 'cmyk' };
            if (cs.kind === 'indexed') return { ok: false, reason: 'broken' };
            const dctParms = parms[parms.length - 1];
            if (dctParms instanceof L.PDFDict && h.has(dctParms, 'ColorTransform')) return { ok: false, reason: 'filter' };
        } else {
            if (cs.kind === 'indexed') { if (![1, 2, 4, 8].includes(bpc)) return { ok: false, reason: 'broken' }; }
            else if (bpc === 1) return { ok: false, reason: 'bilevel' };
            else if (![2, 4, 8, 16].includes(bpc)) return { ok: false, reason: 'broken' };
        }

        const smRef = h.get(d, 'SMask');
        if (smRef !== undefined) {
            const sm = h.lookup(smRef);
            // Matte means the colours were premultiplied against the mask;
            // resampling one without the other would fringe every edge.
            if (sm && sm.dict && h.has(sm.dict, 'Matte')) return { ok: false, reason: 'matte' };
        }

        return {
            ok: true, width, height, bpc, dct, cs,
            filters: pre,
            predictor: pre.length ? predictorOf(parms[pre.length - 1], h, L) : null,
        };
    }

    function classifyMask(stream, h, L) {
        const d = stream.dict;
        const width = h.num(h.get(d, 'Width'));
        const height = h.num(h.get(d, 'Height'));
        const bpc = h.num(h.get(d, 'BitsPerComponent')) || 8;
        if (!(width > 0 && height > 0) || width * height > MAX_SOURCE_PIXELS) return { ok: false };
        const { filters: raw, parms } = filtersOf(d, h, L);
        const filters = raw.map((f) => SHORT_FILTERS[f] || f);
        if (!filters.every((f) => READABLE_FILTERS.has(f))) return { ok: false };
        if (bpc !== 8 || h.has(d, 'Decode') || h.has(d, 'Matte')) return { ok: false };
        return {
            ok: true, width, height, bpc, filters,
            predictor: filters.length ? predictorOf(parms[filters.length - 1], h, L) : null,
        };
    }

    /* What the worker needs to rebuild one image: plain data only, since it
       crosses postMessage. */
    function jobFor(candidate) {
        const { info, stream, smask } = candidate;
        const cs = info.cs;
        return {
            key: candidate.key,
            bytes: stream.contents,
            width: info.width, height: info.height, bpc: info.bpc,
            dct: info.dct, filters: info.filters, predictor: info.predictor,
            cs: {
                kind: cs.kind, n: cs.n, managed: !!cs.managed,
                base: cs.base ? { kind: cs.base.kind, n: cs.base.n, managed: !!cs.base.managed } : null,
                // A slice, like the image bytes in index.html: a view into the
                // file would carry the whole file across postMessage.
                hival: cs.hival, table: cs.table ? cs.table.slice() : null,
            },
            smask: smask ? {
                bytes: smask.stream.contents,
                width: smask.info.width, height: smask.info.height,
                filters: smask.info.filters, predictor: smask.info.predictor,
            } : null,
        };
    }

    /* How far an image comes down at a given rung. Never up. */
    function scaleFor(candidate, level) {
        return Math.min(1, level.ppi / candidate.ppi);
    }
    function targetDims(width, height, scale) {
        return {
            width: Math.max(1, Math.round(width * scale)),
            height: Math.max(1, Math.round(height * scale)),
        };
    }

    /* ------------------------------------------------ the search */

    /* A point between two rungs, so the search can land close to the
       target instead of on whichever rung happens to fit. t runs from 0 to
       the last rung; the resolution is rounded to a whole number and the
       quality to a hundredth, so nearby tries share cached encodings. */
    function levelAt(levels, t) {
        const i = Math.max(0, Math.min(levels.length - 1, Math.floor(t)));
        const j = Math.min(levels.length - 1, i + 1);
        const f = Math.max(0, Math.min(1, t - i));
        const out = {};
        for (const k of Object.keys(levels[i])) {
            const v = levels[i][k] + (levels[j][k] - levels[i][k]) * f;
            out[k] = k === 'quality' ? Math.round(v * 100) / 100 : Math.round(v);
        }
        return out;
    }

    /* Where on the ladder to go for a budget. `estimate(t)` gives the
       expected size at point t and may be async; it is called with the
       same t more than once, so it should cache.

       First the rungs, halving; then a few halvings between the last rung
       that was too big and the first that fits. When nothing fits, the
       answer is not the bottom rung: past a point each step down costs a
       lot of quality and saves almost nothing (fonts and text do not
       shrink), so it stops where the saving flattens out. */
    async function searchLevel(levels, budget, estimate, opts) {
        const last = levels.length - 1;
        // After a real save came out too big at `after`, only points past it count
        const after = opts && typeof opts.after === 'number' ? opts.after : -1;
        const steps = opts && opts.refineSteps !== undefined ? opts.refineSteps : 4;
        const from = Math.min(last, Math.floor(after) + 1);

        let lo = from, hi = last, best = -1;
        while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            if (await estimate(mid) <= budget) { best = mid; hi = mid - 1; }
            else lo = mid + 1;
        }

        if (best === -1) {
            const floor = await estimate(last);
            const enough = floor * 1.03 + 30 * 1000;
            let a = from, b = last, knee = last;
            while (a <= b) {
                const mid = Math.floor((a + b) / 2);
                if (await estimate(mid) <= enough) { knee = mid; b = mid - 1; }
                else a = mid + 1;
            }
            return { t: knee, fits: false, floor };
        }

        // Between the last point known to be too big and the rung that fits
        let tooBig = Math.max(best - 1, after);
        let ok = best;
        if (tooBig >= 0 && tooBig < ok) {
            for (let k = 0; k < steps; k++) {
                const mid = (tooBig + ok) / 2;
                if (await estimate(mid) <= budget) ok = mid; else tooBig = mid;
            }
        }
        return { t: ok, fits: true };
    }

    /* A spread of items to estimate from: the largest ones, because they
       decide the total, plus an even pick of the rest. */
    function sampleForEstimate(items, bytesOf, size) {
        if (items.length <= size) return items.slice();
        const sorted = items.slice().sort((a, b) => bytesOf(b) - bytesOf(a));
        const big = Math.ceil(size / 3);
        const picked = sorted.slice(0, big);
        const rest = sorted.slice(big);
        const want = size - big;
        for (let k = 0; k < want; k++) {
            picked.push(rest[Math.floor((k + 0.5) * rest.length / want)]);
        }
        return picked;
    }

    /* ------------------------------------------------ tidying */

    /* Objects nothing points to any more: earlier versions of a page left
       behind by incremental saves, old cross-reference streams, thumbnails.
       They cost bytes and no reader ever looks at them. */
    function removeUnreachable(pdfDoc, L) {
        const context = pdfDoc.context;
        const seen = new Set();
        const queue = [];
        const push = (obj) => { if (obj !== undefined && obj !== null) queue.push(obj); };
        push(context.trailerInfo.Root);
        push(context.trailerInfo.Info);
        push(context.trailerInfo.Encrypt);
        while (queue.length) {
            const obj = queue.pop();
            if (obj instanceof L.PDFRef) {
                const key = refKey(obj);
                if (seen.has(key)) continue;
                seen.add(key);
                push(context.lookup(obj));
            } else if (obj instanceof L.PDFDict) {
                for (const [, v] of obj.entries()) push(v);
            } else if (obj instanceof L.PDFArray) {
                for (const v of obj.asArray()) push(v);
            } else if (obj instanceof L.PDFStream) {
                push(obj.dict);
            }
        }
        let removed = 0, bytes = 0;
        for (const [ref, obj] of context.enumerateIndirectObjects()) {
            if (seen.has(refKey(ref))) continue;
            if (obj instanceof L.PDFRawStream) bytes += obj.contents.length;
            context.delete(ref);
            removed++;
        }
        return { removed, bytes };
    }

    /* Streams stored without any compression, which some generators write
       for content and fonts. Flate is lossless, so this is free. XMP
       metadata stays readable, as the spec asks. */
    function deflateLoose(pdfDoc, L) {
        const context = pdfDoc.context;
        const h = makeHelpers(L, context);
        let before = 0, after = 0;
        for (const [ref, obj] of context.enumerateIndirectObjects()) {
            if (!(obj instanceof L.PDFRawStream)) continue;
            if (h.has(obj.dict, 'Filter')) continue;
            if (obj.contents.length < 1024) continue;
            const type = h.name(h.get(obj.dict, 'Type'));
            if (type === 'Metadata' || type === 'XRef' || type === 'ObjStm') continue;
            const packed = context.flateStream(obj.contents, {});
            if (packed.contents.length >= obj.contents.length * 0.95) continue;
            const dict = obj.dict.clone(context);
            dict.set(L.PDFName.of('Filter'), L.PDFName.of('FlateDecode'));
            dict.delete(L.PDFName.of('DecodeParms'));
            before += obj.contents.length;
            after += packed.contents.length;
            context.assign(ref, L.PDFRawStream.of(dict, packed.contents));
        }
        return { saved: before - after };
    }

    /* Page thumbnails are drawn by viewers from the pages themselves these
       days; the embedded ones are a leftover from Acrobat 4. */
    function dropThumbnails(pdfDoc, L) {
        let n = 0;
        for (const page of pdfDoc.getPages()) {
            if (page.node.get(L.PDFName.of('Thumb')) !== undefined) {
                page.node.delete(L.PDFName.of('Thumb'));
                n++;
            }
        }
        return n;
    }

    /* The replacement stream for an image, keeping everything in the old
       dictionary that still applies: optional content, structure links,
       rendering intent, an explicit stencil mask.

       The colour space stays when the channel count did not change, so an
       ICC profile goes on describing the same numbers. After a conversion
       (grey, CMYK, a palette) the new pixels are plain device colours. */
    function imageStream(L, context, candidate, result) {
        const dict = candidate.stream.dict.clone(context);
        const cs = candidate.info.cs;
        const h = makeHelpers(L, context);
        const device = L.PDFName.of(result.channels === 1 ? 'DeviceGray' : 'DeviceRGB');
        let space = device;
        if (!result.converted) {
            const own = dict.get(L.PDFName.of('ColorSpace'));
            // A palette's entries are in its base space, so the expanded
            // pixels are too
            if (cs.kind === 'indexed') { if (result.channels === cs.base.n) space = h.lookup(own).get(1); }
            else if (result.channels === cs.n) space = own;
        }
        // ColorTransform belongs in DecodeParms, but Skia writes it into the
        // image dictionary; either way it described the old JPEG, not ours
        for (const k of ['Filter', 'DecodeParms', 'Decode', 'Length', 'SMaskInData', 'DL', 'ColorTransform']) dict.delete(L.PDFName.of(k));
        dict.set(L.PDFName.of('Width'), L.PDFNumber.of(result.width));
        dict.set(L.PDFName.of('Height'), L.PDFNumber.of(result.height));
        dict.set(L.PDFName.of('BitsPerComponent'), L.PDFNumber.of(8));
        dict.set(L.PDFName.of('Filter'), L.PDFName.of(result.filter));
        dict.set(L.PDFName.of('ColorSpace'), space);
        return L.PDFRawStream.of(dict, result.bytes);
    }

    /* A one-pixel stand-in, to weigh a file without its images */
    function placeholderImage(L, context) {
        return L.PDFRawStream.of(context.obj({
            Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1,
            ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode',
        }), new Uint8Array(1));
    }

    function maskStream(L, context, original, mask) {
        const dict = original.dict.clone(context);
        for (const k of ['Filter', 'DecodeParms', 'Decode', 'Length', 'DL']) dict.delete(L.PDFName.of(k));
        dict.set(L.PDFName.of('Width'), L.PDFNumber.of(mask.width));
        dict.set(L.PDFName.of('Height'), L.PDFNumber.of(mask.height));
        dict.set(L.PDFName.of('BitsPerComponent'), L.PDFNumber.of(8));
        dict.set(L.PDFName.of('ColorSpace'), L.PDFName.of('DeviceGray'));
        dict.set(L.PDFName.of('Filter'), L.PDFName.of('FlateDecode'));
        return L.PDFRawStream.of(dict, mask.bytes);
    }

    /* Colour gradients of the function-based kind (ShadingType 1), which the
       pdf.js this site uses cannot draw. They matter twice: the preview,
       drawn by pdf.js, shows them wrongly, and turning pages into pictures
       would bake that into the file. */
    function undrawableShadings(pdfDoc, L) {
        const h = makeHelpers(L, pdfDoc.context);
        let n = 0;
        const isType1 = (d) => d instanceof L.PDFDict && h.num(h.get(d, 'ShadingType')) === 1;
        for (const [, obj] of pdfDoc.context.enumerateIndirectObjects()) {
            const d = obj instanceof L.PDFStream ? obj.dict : obj;
            if (!(d instanceof L.PDFDict)) continue;
            if (isType1(d)) { n++; continue; }
            const direct = d.get(L.PDFName.of('Shading'));
            if (isType1(direct)) n++;
            else if (direct instanceof L.PDFDict) {
                for (const [, v] of direct.entries()) if (isType1(v)) n++;
            }
        }
        return n;
    }

    function isSigned(pdfDoc, L) {
        const h = makeHelpers(L, pdfDoc.context);
        const acro = h.lookup(pdfDoc.catalog.get(L.PDFName.of('AcroForm')));
        if (!(acro instanceof L.PDFDict)) return false;
        const flags = h.num(h.get(acro, 'SigFlags')) || 0;
        if (flags & 1) return true;
        const fields = h.lookup(h.get(acro, 'Fields'));
        if (!(fields instanceof L.PDFArray)) return false;
        const stack = fields.asArray().slice();
        let guard = 0;
        while (stack.length && guard++ < 10000) {
            const f = h.lookup(stack.pop());
            if (!(f instanceof L.PDFDict)) continue;
            if (h.name(h.get(f, 'FT')) === 'Sig' && h.has(f, 'V')) return true;
            const kids = h.lookup(h.get(f, 'Kids'));
            if (kids instanceof L.PDFArray) stack.push(...kids.asArray());
        }
        return false;
    }

    const REASONS = {
        jpx: 'JPEG 2000, which browsers cannot decode',
        bilevel: 'black-and-white, already stored compactly',
        stencil: 'a stencil mask, already one bit per pixel',
        cmyk: 'CMYK, whose colours only come out right with the printer\'s profile, which a browser does not have',
        colourspace: 'in a colour space this tool does not convert (spot colours or Lab)',
        colourkey: 'transparent by exact colour, which recompression would break',
        decode: 'stored with remapped values',
        matte: 'premultiplied against its transparency',
        filter: 'compressed in a way this tool does not read',
        huge: 'too large to decode in a browser tab',
        broken: 'damaged or incomplete',
        tiny: 'too small to be worth it',
    };

    return {
        MB, TARGETS_MB, HEADROOM, IMAGE_LEVELS, PAGE_LEVELS, MAX_CANVAS_PIXELS, MAX_SOURCE_PIXELS, REASONS,
        formatMB, verdict, multiply, walkContent, measurePlacements, describeImages, jobFor,
        scaleFor, targetDims, levelAt, searchLevel, sampleForEstimate, removeUnreachable, deflateLoose,
        dropThumbnails, imageStream, placeholderImage, maskStream, isSigned, undrawableShadings, makeHelpers, refKey,
    };
});
