/* The work behind the PDF compressor page: opening a file, the two ways of
   making it smaller, and the search that picks how far to go. index.html
   only wires this to the page; engine.js makes the decisions that do not
   need a browser, worker.js does the pixels.

   Everything that belongs to one file lives in one "session" object, built
   completely by open() before anyone sees it. A second file, or a cancelled
   first one, never leaves half of one file's state next to half of
   another's. */
(function (root) {
    'use strict';

    const E = root.Verkleinerer;
    const L = root.PDFLib;

    class Cancelled extends Error {}
    class NotPdf extends Error {}
    class PasswordNeeded extends Error {
        constructor(wrong) { super('password needed'); this.wrong = wrong; }
    }

    const pause = () => new Promise((r) => setTimeout(r, 0));

    /* ------------------------------------------------------------ workers */

    /* Started on first use: each worker loads pdf-lib, which is wasted on
       someone who only came to read the page. */
    const pool = (() => {
        const size = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
        const workers = [];
        let nextId = 1;
        const start = () => {
            if (workers.length) return;
            for (let i = 0; i < size; i++) {
                const w = new Worker('worker.js');
                const pending = new Map();
                w.onmessage = (e) => {
                    const p = pending.get(e.data.id);
                    if (!p) return;
                    pending.delete(e.data.id);
                    if (e.data.error) p.reject(new Error(e.data.error));
                    else p.resolve(e.data);
                };
                w.onerror = (e) => {
                    for (const p of pending.values()) p.reject(new Error(e.message || 'worker failed'));
                    pending.clear();
                };
                workers.push({ w, pending, has: new Set() });
            }
        };
        return {
            size,
            slot(index) { start(); return workers[index % size]; },
            call(index, msg, transfer) {
                const slot = this.slot(index);
                const id = nextId++;
                return new Promise((resolve, reject) => {
                    slot.pending.set(id, { resolve, reject });
                    slot.w.postMessage(Object.assign({ id }, msg), transfer || []);
                });
            },
            forget() {
                workers.forEach((slot, i) => { slot.has.clear(); this.call(i, { type: 'forget' }).catch(() => {}); });
            },
        };
    })();

    let ready = null;
    function canRecode() {
        if (!ready) {
            ready = pool.call(0, { type: 'hello' }).then((caps) => !!caps.offscreen).catch(() => false);
        }
        return ready;
    }

    function workerFor(key) {
        let h = 0;
        for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
        return h % pool.size;
    }

    /* Runs `fn` over `items` with a few in flight at once, so every worker
       has something to do while the next one is being sent. */
    async function eachLimited(items, limit, fn) {
        let i = 0;
        const lanes = [];
        for (let k = 0; k < Math.min(limit, items.length); k++) {
            lanes.push((async () => { while (i < items.length) { const item = items[i++]; await fn(item); } })());
        }
        await Promise.all(lanes);
    }

    /* ------------------------------------------------------------ opening */

    function isPdfHeader(bytes) {
        // The header may sit behind some junk, the spec allows 1024 bytes of it
        return new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).includes('%PDF-');
    }

    /* How every PDF is opened for drawing. pdf.js turns images into
       bitmaps on an OffscreenCanvas when the browser has one, and Safari's
       gives up on large ones without a word: the photo on some pages is
       simply not drawn. That broke the preview on iPhones, and would have
       put pages without their pictures into files made the second way.
       Measured in WebKit: with this off, every page of the file that showed
       it draws; with it on, one or two of eight do not. */
    function pdfjsOptions(bytes, password) {
        return { data: bytes.slice(), password: password || undefined, isOffscreenCanvasSupported: false };
    }

    let opened = 0;

    async function open(bytes, password, ctl) {
        if (!isPdfHeader(bytes)) throw new NotPdf('not a pdf');
        let original;
        try {
            original = await pdfjsLib.getDocument(pdfjsOptions(bytes, password)).promise;
        } catch (err) {
            if (err && err.name === 'PasswordException') throw new PasswordNeeded(!!password);
            throw err;
        }
        try {
            const s = {
                // Workers cache decoded images by name, and object numbers
                // repeat from one PDF to the next; this keeps them apart
                id: ++opened,
                bytes, original, lib: null, libProblem: null, encrypted: false, signed: false, undrawable: 0,
                analysis: null, tidyInfo: null, tidySize: 0, baseBytes: 0,
                encoded: new Map(), failures: new Map(),
            };
            await analyse(s, ctl);
            return s;
        } catch (err) {
            original.destroy();
            throw err;
        }
    }

    async function analyse(s, ctl) {
        const recode = await canRecode();
        let lib = null;
        try {
            // updateMetadata: false keeps the producer and dates as they were
            lib = await L.PDFDocument.load(s.bytes, { ignoreEncryption: true, updateMetadata: false });
        } catch (err) {
            console.error(err);
            s.libProblem = 'parts of this file could not be read for rewriting in place';
        }
        ctl.check();
        if (lib && lib.isEncrypted) {
            s.encrypted = true;
            s.libProblem = 'it is encrypted, so its images cannot be rewritten where they are';
            lib = null;
        }
        if (!lib) return;
        if (!recode) {
            s.libProblem = 'this browser cannot re-encode images in the background';
            return;
        }

        ctl.say('Looking at what takes up the space…');
        await pause();
        s.lib = lib;
        s.signed = E.isSigned(lib, L);
        s.undrawable = E.undrawableShadings(lib, L);
        const thumbs = E.dropThumbnails(lib, L);
        const gc = E.removeUnreachable(lib, L);
        const loose = E.deflateLoose(lib, L);
        s.tidyInfo = { thumbs, removed: gc.removed, removedBytes: gc.bytes, deflated: loose.saved };
        const placements = E.measurePlacements(lib, L);
        s.analysis = E.describeImages(lib, L, placements);
        s.analysis.byPage = placements.byPage;
        ctl.check();

        ctl.say('Measuring the parts that stay…');
        s.tidySize = (await save(s)).length;
        ctl.check();
        // What the file weighs whatever happens to the images: every
        // rewritable image reduced to a single pixel
        setImages(s, () => ({ image: E.placeholderImage(L, lib.context), mask: E.placeholderImage(L, lib.context) }));
        s.baseBytes = (await save(s)).length;
        setImages(s, () => null);
        ctl.check();
    }

    function close(s) {
        if (!s) return;
        s.original.destroy();
        pool.forget();
    }

    function save(s) {
        return s.lib.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
    }

    /* The one place image streams go into the document. `pick` returns the
       replacement streams for a candidate, or nothing to keep its original. */
    function setImages(s, pick) {
        const ctx = s.lib.context;
        for (const c of s.analysis.candidates) {
            const p = pick(c) || {};
            ctx.assign(c.ref, p.image || c.stream);
            if (c.smask) ctx.assign(c.smask.ref, p.mask || c.smask.stream);
        }
    }

    /* ------------------------------------------------------------ the search */

    /* Search, build, weigh, and adjust. `estimate(t)` guesses the size at a
       point on the ladder from a sample; `build(level)` makes the real file.
       A real file that comes out over the target sends the search further
       down, with the estimates scaled by how far off they were. One that
       comes out well under gets one try at a gentler setting, because every
       step up the ladder is visible quality. */
    async function searchAndBuild(levels, target, guess, build, ctl) {
        const memo = new Map();
        const estimate = (t) => { if (!memo.has(t)) memo.set(t, guess(t)); return memo.get(t); };
        const budget = target * E.HEADROOM;
        let found = await E.searchLevel(levels, budget, estimate);
        let fitting = null;   // the gentlest build that fitted
        let over = null;      // the latest one that did not
        let tightened = false;
        for (let attempt = 0; attempt < 8; attempt++) {
            const level = E.levelAt(levels, found.t);
            const built = Object.assign(await build(level), { level, t: found.t });
            ctl.check();
            const size = built.bytes.length;
            const lastRung = found.t >= levels.length - 1;
            const factor = size / await estimate(found.t);
            const corrected = async (t) => (await estimate(t)) * factor;

            if (size <= target) {
                built.fits = true;
                if (!fitting || built.t < fitting.t) fitting = built;
                if (tightened || found.t <= 0 || size >= target * 0.93) return fitting;
                tightened = true;
                const gentler = await E.searchLevel(levels, budget, corrected);
                if (!gentler.fits || gentler.t >= found.t - 0.05) return fitting;
                found = gentler;
                continue;
            }

            built.fits = false;
            built.stoppedEarly = !found.fits && !lastRung;
            over = built;
            if (fitting) return fitting; // the gentler try overshot; keep what fitted
            if (!found.fits || lastRung) return over;
            found = await E.searchLevel(levels, budget, corrected, { after: found.t });
        }
        return fitting || over;
    }

    /* The whole job: which method, and whether the original is the better
       answer after all. */
    async function compress(s, target, opts, ctl) {
        // Grey, clean-up and straightening are wanted for their own sake;
        // without them a result is only worth having if it is smaller.
        const untouched = !opts.gray && !opts.clean && !opts.angle;
        if (untouched && s.bytes.length <= target) {
            return { bytes: s.bytes, fits: true, kind: 'original', target, opts };
        }
        let out = opts.method === 'images'
            ? await shrinkImages(s, target, opts, ctl)
            : await imagePages(s, target, opts, ctl);
        ctl.check();
        if (untouched && out.bytes.length >= s.bytes.length) {
            out = { bytes: s.bytes, fits: s.bytes.length <= target, kind: 'original', notSmaller: true, tried: out.kind };
        }
        return Object.assign(out, { target, opts });
    }

    /* ---------- method 1: the images inside */

    async function encodeOne(s, c, level, gray) {
        const scale = E.scaleFor(c, level);
        const dims = E.targetDims(c.info.width, c.info.height, scale);
        const cacheKey = `${c.key}|${dims.width}x${dims.height}|${level.quality}|${gray ? 1 : 0}`;
        if (s.encoded.has(cacheKey)) return s.encoded.get(cacheKey);

        const key = s.id + ':' + c.key;
        const wIndex = workerFor(key);
        const slot = pool.slot(wIndex);
        const send = (withBytes) => {
            const job = Object.assign(E.jobFor(c), { key });
            const transfer = [];
            if (withBytes) {
                // A copy of just this stream. Sending the view would clone the
                // whole file behind it, once per image.
                job.bytes = job.bytes.slice();
                transfer.push(job.bytes.buffer);
                if (job.smask) { job.smask.bytes = job.smask.bytes.slice(); transfer.push(job.smask.bytes.buffer); }
            } else {
                job.bytes = null;
                if (job.smask) job.smask.bytes = null;
            }
            return pool.call(wIndex, {
                type: 'image', job, width: dims.width, height: dims.height,
                quality: level.quality, grayscale: gray, tryFlate: !c.info.dct,
            }, transfer);
        };

        let outcome;
        try {
            let res = await send(!slot.has.has(key));
            if (res.missing) res = await send(true);
            slot.has.add(key);
            const smaskOld = c.smask ? c.smask.stream.contents.length : 0;
            const newTotal = res.bytes.length + (res.mask ? res.mask.bytes.length : smaskOld);
            // A rewrite has to earn its keep: a tenth smaller, or grey
            // because grey was asked for.
            const accept = (gray && res.converted) || newTotal <= c.bytes * 0.9;
            outcome = { accept, bytes: accept ? newTotal : c.bytes, res, scale };
        } catch (err) {
            s.failures.set(c.key, err.message);
            outcome = { accept: false, bytes: c.bytes, res: null, scale: 1 };
        }
        s.encoded.set(cacheKey, outcome);
        return outcome;
    }

    async function encodeSet(s, items, level, gray, ctl, onDone) {
        const map = new Map();
        await eachLimited(items, pool.size * 2, async (c) => {
            ctl.check();
            map.set(c.key, await encodeOne(s, c, level, gray));
            onDone();
        });
        ctl.check();
        return map;
    }

    async function shrinkImages(s, target, opts, ctl) {
        const cands = s.analysis.candidates;
        const levels = E.IMAGE_LEVELS;

        // Nothing to rewrite, or the tidy alone is enough
        if (!cands.length || (!opts.gray && s.tidySize <= target)) {
            setImages(s, () => null);
            const bytes = await save(s);
            return { bytes, fits: bytes.length <= target, kind: 'images', level: null, outcomes: new Map() };
        }

        const sample = E.sampleForEstimate(cands, (c) => c.bytes, 24);
        const inSample = new Set(sample.map((c) => c.key));
        const sampleOrig = sample.reduce((sum, c) => sum + c.bytes, 0);
        const restOrig = cands.reduce((sum, c) => sum + (inSample.has(c.key) ? 0 : c.bytes), 0);

        let probes = 0;
        const guess = async (t) => {
            const level = E.levelAt(levels, t);
            probes++;
            let done = 0;
            const outcomes = await encodeSet(s, sample, level, opts.gray, ctl, () => {
                done++;
                ctl.say(`Trying ${level.ppi} ppi at quality ${Math.round(level.quality * 100)} (try ${probes})`,
                    Math.min(0.6, 0.05 * probes + 0.05 * done / sample.length));
            });
            let sampleNew = 0;
            for (const o of outcomes.values()) sampleNew += o.bytes;
            const ratio = sampleOrig ? sampleNew / sampleOrig : 1;
            return s.baseBytes + sampleNew + restOrig * ratio;
        };

        const built = await searchAndBuild(levels, target, guess, async (level) => {
            let done = 0;
            const outcomes = await encodeSet(s, cands, level, opts.gray, ctl, () => {
                done++;
                ctl.say(`Shrinking image ${done} of ${cands.length}`, 0.6 + 0.3 * done / cands.length);
            });
            const ctx = s.lib.context;
            setImages(s, (c) => {
                const o = outcomes.get(c.key);
                if (!o || !o.accept) return null;
                return {
                    image: E.imageStream(L, ctx, c, o.res),
                    mask: o.res.mask && c.smask ? E.maskStream(L, ctx, c.smask.stream, o.res.mask) : null,
                };
            });
            ctl.say('Writing the file…', 0.93);
            return { bytes: await save(s), outcomes };
        }, ctl);
        return Object.assign(built, { kind: 'images' });
    }

    /* ---------- method 2: every page a picture */

    async function renderPage(page, scale, canvas, angle) {
        const viewport = page.getViewport({ scale });
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (!angle) {
            await page.render({ canvasContext: ctx, viewport }).promise;
            return viewport;
        }
        const tmp = document.createElement('canvas');
        tmp.width = canvas.width; tmp.height = canvas.height;
        const tctx = tmp.getContext('2d');
        tctx.fillStyle = '#fff';
        tctx.fillRect(0, 0, tmp.width, tmp.height);
        await page.render({ canvasContext: tctx, viewport }).promise;
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(angle * Math.PI / 180);
        ctx.translate(-canvas.width / 2, -canvas.height / 2);
        ctx.drawImage(tmp, 0, 0);
        ctx.restore();
        return viewport;
    }

    /* The resolution a page gets: what was asked for, unless the canvas
       would be larger than a browser allows. */
    function pageScale(page, dpi) {
        const vp = page.getViewport({ scale: 1 });
        let scale = dpi / 72;
        if (vp.width * vp.height * scale * scale > E.MAX_CANVAS_PIXELS) {
            scale = Math.sqrt(E.MAX_CANVAS_PIXELS / (vp.width * vp.height));
        }
        return scale;
    }

    async function cleanCanvas(canvas, opts) {
        if (!opts.gray && !opts.clean) return;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const { data } = await pool.call(0, {
            type: 'clean', data: img.data, grayscale: opts.gray, cleanEnabled: opts.clean,
            whitePoint: opts.white, blackPoint: opts.black,
        }, [img.data.buffer]);
        ctx.putImageData(new ImageData(new Uint8ClampedArray(data.buffer), canvas.width, canvas.height), 0, 0);
    }

    function jpegOf(canvas, quality) {
        return new Promise((resolve, reject) => canvas.toBlob((b) => {
            if (!b) return reject(new Error('the browser could not encode a page'));
            b.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
        }, 'image/jpeg', quality));
    }

    function scaledCopy(source, factor) {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(source.width * factor));
        c.height = Math.max(1, Math.round(source.height * factor));
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, 0, 0, c.width, c.height);
        return c;
    }

    async function imagePages(s, target, opts, ctl) {
        const levels = E.PAGE_LEVELS;
        const original = s.original;
        const n = original.numPages;

        // Areas, to scale an estimate from a few pages to all of them
        const areas = [];
        for (let i = 1; i <= n; i++) {
            const vp = (await original.getPage(i)).getViewport({ scale: 1 });
            areas.push(vp.width * vp.height);
            if (i % 50 === 0) { ctl.check(); await pause(); }
        }
        const totalArea = areas.reduce((a, b) => a + b, 0);

        const want = Math.min(n, 6);
        const samplePages = [];
        for (let k = 0; k < want; k++) samplePages.push(Math.floor((k + 0.5) * n / want) + 1);
        const rendered = [];
        for (const [k, num] of samplePages.entries()) {
            ctl.say(`Rendering sample page ${k + 1} of ${samplePages.length}`, 0.05 + 0.2 * k / samplePages.length);
            const page = await original.getPage(num);
            const c = document.createElement('canvas');
            const scale = pageScale(page, levels[0].dpi);
            await renderPage(page, scale, c, opts.angle);
            await cleanCanvas(c, opts);
            ctl.check();
            rendered.push({ canvas: c, scale, area: areas[num - 1] });
        }
        const sampleArea = rendered.reduce((sum, r) => sum + r.area, 0);

        let probes = 0;
        const guess = async (t) => {
            const level = E.levelAt(levels, t);
            probes++;
            ctl.say(`Trying ${level.dpi} dpi at quality ${Math.round(level.quality * 100)} (try ${probes})`, Math.min(0.5, 0.25 + 0.03 * probes));
            let bytes = 0;
            for (const r of rendered) {
                const factor = Math.min(1, (level.dpi / 72) / r.scale);
                const c = factor < 1 ? scaledCopy(r.canvas, factor) : r.canvas;
                bytes += (await jpegOf(c, level.quality)).length;
                ctl.check();
            }
            // A page costs a few hundred bytes of structure besides its picture
            return bytes * totalArea / sampleArea + n * 400 + 2000;
        };

        const built = await searchAndBuild(levels, target, guess, async (level) => {
            const out = await L.PDFDocument.create({ updateMetadata: false });
            const title = s.lib && s.lib.getTitle();
            if (title) out.setTitle(title);
            let capped = 0;
            for (let i = 1; i <= n; i++) {
                ctl.say(`Page ${i} of ${n} at ${level.dpi} dpi`, 0.5 + 0.45 * (i - 1) / n);
                const page = await original.getPage(i);
                const scale = pageScale(page, level.dpi);
                if (scale < level.dpi / 72 - 1e-6) capped++;
                const c = document.createElement('canvas');
                const vp = await renderPage(page, scale, c, opts.angle);
                await cleanCanvas(c, opts);
                const jpg = await jpegOf(c, level.quality);
                ctl.check();
                const img = await out.embedJpg(jpg);
                const w = vp.width / scale, h = vp.height / scale;
                out.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
                c.width = c.height = 0; // let the memory go now, not at the next collection
                page.cleanup();
            }
            ctl.say('Writing the file…', 0.97);
            return { bytes: await out.save({ useObjectStreams: true }), capped };
        }, ctl);
        return Object.assign(built, { kind: 'pages' });
    }

    /* The tilt of page 1, for the straighten control */
    async function measureTilt(s) {
        const page = await s.original.getPage(1);
        const c = document.createElement('canvas');
        await renderPage(page, 1, c, 0);
        const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
        const { angle } = await pool.call(0, { type: 'deskew', data: img.data, width: c.width, height: c.height }, [img.data.buffer]);
        return Math.round(angle * 10) / 10;
    }

    root.Kompressor = { Cancelled, NotPdf, PasswordNeeded, open, close, compress, measureTilt, renderPage, pdfjsOptions };
})(self);
