/* Pixel work for the PDF compressor: decode an image out of the PDF,
   bring it down to the size engine.js asked for, and encode it again. Also
   the scan clean-up for pages that are turned into pictures.

   Several of these run at once, one per spare core. Each keeps the images
   it has decoded, because the search asks for the same image at several
   settings in a row and decoding is the slow half. */

if (typeof importScripts === 'function') {
    // Only for the stream filters (Flate, LZW, ASCII85 and the rest)
    importScripts('../../assets/vendor/pdf-lib.min.js');
}

/* ---------------------------------------------------------- samples */

/* PNG and TIFF predictors. pdf-lib inflates a stream but leaves the
   predictor bytes in, and most images written by anything that also
   writes PNGs use one. */
function unpredict(data, p) {
    const colors = p.colors || 1;
    const bpc = p.bpc || 8;
    const columns = p.columns || 1;
    const rowBytes = Math.ceil(colors * bpc * columns / 8);
    const bpp = Math.max(1, Math.ceil(colors * bpc / 8));

    if (p.predictor === 2) {
        if (bpc !== 8) throw new Error('TIFF predictor with ' + bpc + ' bits');
        const out = new Uint8Array(data);
        for (let r = 0; r * rowBytes < out.length; r++) {
            const start = r * rowBytes;
            for (let i = colors; i < rowBytes && start + i < out.length; i++) {
                out[start + i] = (out[start + i] + out[start + i - colors]) & 0xff;
            }
        }
        return out;
    }

    const rows = Math.floor(data.length / (rowBytes + 1));
    const out = new Uint8Array(rows * rowBytes);
    const prior = new Uint8Array(rowBytes);
    for (let r = 0; r < rows; r++) {
        const type = data[r * (rowBytes + 1)];
        const src = r * (rowBytes + 1) + 1;
        const dst = r * rowBytes;
        for (let i = 0; i < rowBytes; i++) {
            const raw = data[src + i];
            const left = i >= bpp ? out[dst + i - bpp] : 0;
            const up = prior[i];
            const upLeft = i >= bpp ? prior[i - bpp] : 0;
            let v;
            switch (type) {
                case 0: v = raw; break;
                case 1: v = raw + left; break;
                case 2: v = raw + up; break;
                case 3: v = raw + ((left + up) >> 1); break;
                case 4: {
                    const pa = Math.abs(up - upLeft), pb = Math.abs(left - upLeft), pc = Math.abs(left + up - 2 * upLeft);
                    v = raw + ((pa <= pb && pa <= pc) ? left : (pb <= pc ? up : upLeft));
                    break;
                }
                default: throw new Error('PNG row filter ' + type);
            }
            out[dst + i] = v & 0xff;
        }
        prior.set(out.subarray(dst, dst + rowBytes));
    }
    return out;
}

function decodeFilters(bytes, filters, predictor) {
    let out = bytes;
    if (filters.length) {
        const L = self.PDFLib;
        const ctx = L.PDFContext.create();
        const dict = ctx.obj({ Filter: filters.map((f) => L.PDFName.of(f)) });
        out = L.decodePDFRawStream(L.PDFRawStream.of(dict, bytes)).decode();
    }
    if (predictor) out = unpredict(out, predictor);
    return out;
}

/* Raw samples to RGBA, for every colour space engine.js lets through.
   CMYK goes to RGB the simple way; without the output profile nothing
   better is possible, and the result says colours may shift. */
function samplesToRGBA(samples, width, height, bpc, cs) {
    const comps = cs.kind === 'indexed' ? 1 : cs.n;
    const rowBytes = Math.ceil(width * comps * bpc / 8);
    if (samples.length < rowBytes * height) throw new Error('image data is shorter than its size says');
    const out = new Uint8ClampedArray(width * height * 4);
    const max = (1 << bpc) - 1;

    const read = (row, k) => { // k-th sample in the row, as a raw value
        if (bpc === 8) return samples[row + k];
        if (bpc === 16) return samples[row + 2 * k]; // the high byte is enough
        const bit = k * bpc;
        const byte = samples[row + (bit >> 3)];
        return (byte >> (8 - bpc - (bit & 7))) & max;
    };
    const scale = bpc === 8 || bpc === 16 ? 1 : 255 / max;

    let baseN = 0, table = null, hival = 0;
    if (cs.kind === 'indexed') {
        baseN = cs.base.n;
        table = cs.table;
        hival = cs.hival;
    }

    for (let y = 0; y < height; y++) {
        const row = y * rowBytes;
        for (let x = 0; x < width; x++) {
            const o = (y * width + x) * 4;
            let r, g, b;
            if (cs.kind === 'indexed') {
                const idx = Math.min(read(row, x), hival) * baseN;
                if (baseN === 1) { r = g = b = table[idx]; }
                else if (baseN === 3) { r = table[idx]; g = table[idx + 1]; b = table[idx + 2]; }
                else {
                    const c = table[idx], m = table[idx + 1], yy = table[idx + 2], k = table[idx + 3];
                    r = (255 - c) * (255 - k) / 255; g = (255 - m) * (255 - k) / 255; b = (255 - yy) * (255 - k) / 255;
                }
            } else if (cs.n === 1) {
                r = g = b = read(row, x) * scale;
            } else if (cs.n === 3) {
                r = read(row, x * 3) * scale; g = read(row, x * 3 + 1) * scale; b = read(row, x * 3 + 2) * scale;
            } else {
                const c = read(row, x * 4) * scale, m = read(row, x * 4 + 1) * scale;
                const yy = read(row, x * 4 + 2) * scale, k = read(row, x * 4 + 3) * scale;
                r = (255 - c) * (255 - k) / 255; g = (255 - m) * (255 - k) / 255; b = (255 - yy) * (255 - k) / 255;
            }
            out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
        }
    }
    return out;
}

function toGray(rgba) {
    for (let i = 0; i < rgba.length; i += 4) {
        const v = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
        rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
    }
}

function isGray(rgba) {
    // Scanners and phones often store a grey page as RGB
    for (let i = 0; i < rgba.length; i += 4) {
        if (Math.abs(rgba[i] - rgba[i + 1]) > 2 || Math.abs(rgba[i] - rgba[i + 2]) > 2) return false;
    }
    return true;
}

function pack(rgba, channels) {
    const n = rgba.length / 4;
    const out = new Uint8Array(n * channels);
    if (channels === 1) for (let i = 0; i < n; i++) out[i] = rgba[i * 4];
    else for (let i = 0; i < n; i++) { out[i * 3] = rgba[i * 4]; out[i * 3 + 1] = rgba[i * 4 + 1]; out[i * 3 + 2] = rgba[i * 4 + 2]; }
    return out;
}

async function deflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ---------------------------------------------------------- pixels */

async function decodeJpeg(bytes) {
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    // The PDF's colour space describes these numbers, not whatever profile
    // the JPEG carries, so the browser must not convert them.
    try {
        return await createImageBitmap(blob, { colorSpaceConversion: 'none', imageOrientation: 'none' });
    } catch (err) {
        if (!(err instanceof TypeError)) throw err;
        return await createImageBitmap(blob, { colorSpaceConversion: 'none' });
    }
}

function canvas(w, h) {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    return { c, ctx };
}

/* Halving first and then the last step: a straight drawImage from 4000 to
   500 pixels samples too few source pixels in some browsers and comes out
   grainy. Each halving averages four pixels into one. */
function drawScaled(source, w, h) {
    let cur = source, cw = source.width, ch = source.height;
    while (cw / 2 >= w * 1.0001 && ch / 2 >= h * 1.0001) {
        const nw = Math.max(w, Math.round(cw / 2)), nh = Math.max(h, Math.round(ch / 2));
        const step = canvas(nw, nh);
        step.ctx.drawImage(cur, 0, 0, nw, nh);
        cur = step.c; cw = nw; ch = nh;
    }
    const out = canvas(w, h);
    out.ctx.fillStyle = '#fff';
    out.ctx.fillRect(0, 0, w, h);
    out.ctx.drawImage(cur, 0, 0, w, h);
    return out;
}

/* Decoded images, newest last. The budget is in pixels: an ImageBitmap
   costs four bytes each. */
const cache = new Map();
let cachedPixels = 0;
const CACHE_PIXELS = 40 * 1000 * 1000;

function remember(key, bitmap, extra) {
    const px = bitmap.width * bitmap.height;
    if (px > CACHE_PIXELS) return;
    while (cachedPixels + px > CACHE_PIXELS && cache.size) {
        const [oldKey, old] = cache.entries().next().value;
        cache.delete(oldKey);
        cachedPixels -= old.bitmap.width * old.bitmap.height;
        if (old.bitmap.close) old.bitmap.close();
    }
    cache.set(key, Object.assign({ bitmap }, extra));
    cachedPixels += px;
}
function recall(key) {
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); }
    return hit;
}

async function sourceOf(job) {
    const hit = recall(job.key);
    if (hit) return hit;
    if (!job.bytes) return null;

    let bitmap, gray = false;
    if (job.dct) {
        const jpeg = decodeFilters(job.bytes, job.filters, null);
        bitmap = await decodeJpeg(jpeg);
        if (bitmap.width !== job.width || bitmap.height !== job.height) {
            // The stream says one size and the JPEG another; the PDF's size
            // is what readers draw, so follow it.
            const fixed = drawScaled(bitmap, job.width, job.height);
            bitmap = fixed.c.transferToImageBitmap();
        }
        gray = job.cs.n === 1;
    } else {
        const samples = decodeFilters(job.bytes, job.filters, job.predictor);
        const rgba = samplesToRGBA(samples, job.width, job.height, job.bpc, job.cs);
        gray = job.cs.kind === 'gray' || isGray(rgba);
        bitmap = await createImageBitmap(new ImageData(rgba, job.width, job.height));
    }

    let mask = null;
    if (job.smask) {
        const m = job.smask;
        const samples = decodeFilters(m.bytes, m.filters, m.predictor);
        const rgba = samplesToRGBA(samples, m.width, m.height, 8, { kind: 'gray', n: 1 });
        mask = await createImageBitmap(new ImageData(rgba, m.width, m.height));
    }

    const entry = { bitmap, gray, mask };
    remember(job.key, bitmap, { gray, mask });
    return entry;
}

async function encodeImage(msg) {
    const { job, width, height, quality, grayscale, tryFlate } = msg;
    const src = await sourceOf(job);
    if (!src) return { missing: true };

    const { c, ctx } = drawScaled(src.bitmap, width, height);
    const img = ctx.getImageData(0, 0, width, height);
    const colourSource = !src.gray;
    let channels = src.gray ? 1 : 3;
    if (grayscale && colourSource) { toGray(img.data); ctx.putImageData(img, 0, 0); channels = 1; }

    const jpegBlob = await c.convertToBlob({ type: 'image/jpeg', quality });
    let best = { bytes: new Uint8Array(await jpegBlob.arrayBuffer()), filter: 'DCTDecode', channels: 3 };

    // Lossless when it is nearly as small: diagrams, screenshots and
    // anything with flat colour come out sharper and often smaller.
    if (tryFlate && typeof CompressionStream === 'function') {
        const flate = await deflate(pack(img.data, channels));
        if (flate.length <= best.bytes.length * 1.15) best = { bytes: flate, filter: 'FlateDecode', channels };
    }

    let mask = null;
    if (src.mask && typeof CompressionStream === 'function') {
        const mw = Math.max(1, Math.round(src.mask.width * width / job.width));
        const mh = Math.max(1, Math.round(src.mask.height * height / job.height));
        const m = drawScaled(src.mask, mw, mh);
        const md = m.ctx.getImageData(0, 0, mw, mh).data;
        mask = { bytes: await deflate(pack(md, 1)), width: mw, height: mh };
    }

    return {
        bytes: best.bytes, filter: best.filter, channels: best.channels, width, height, mask,
        converted: (grayscale && colourSource) || job.cs.kind === 'cmyk' || job.cs.kind === 'indexed',
    };
}

/* ---------------------------------------------------------- scans */

function calculateDeskewAngle(data, width, height) {
    // Every 4th pixel in each direction is enough to find the angle
    const step = 4;
    let maxVariance = 0;
    let bestAngle = 0;

    for (let angle = -5; angle <= 5; angle += 0.2) {
        if (Math.abs(angle) < 0.01) continue;
        const rad = angle * Math.PI / 180;
        const sin = Math.sin(rad);
        const cos = Math.cos(rad);

        const rowSums = new Float32Array(height);
        const cx = width / 2;
        const cy = height / 2;

        for (let y = 0; y < height; y += step) {
            for (let x = 0; x < width; x += step) {
                const i = (y * width + x) * 4;
                const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                if (gray < 200) {
                    const ry = Math.round((x - cx) * sin + (y - cy) * cos + cy);
                    if (ry >= 0 && ry < height) rowSums[ry]++;
                }
            }
        }

        let mean = 0;
        for (let i = 0; i < height; i++) mean += rowSums[i];
        mean /= height;

        let variance = 0;
        for (let i = 0; i < height; i++) variance += (rowSums[i] - mean) * (rowSums[i] - mean);

        if (variance > maxVariance) {
            maxVariance = variance;
            bestAngle = angle;
        }
    }

    return bestAngle;
}

/* Grey, and for scans a stretch between two points: lighter than white
   turns white, darker than black turns black. */
function cleanPixels(data, grayscale, cleanEnabled, whitePoint, blackPoint) {
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (!grayscale && !cleanEnabled) continue;
        let gray = (0.299 * r) + (0.587 * g) + (0.114 * b);
        if (cleanEnabled) {
            if (gray >= whitePoint) gray = 255;
            else if (gray <= blackPoint) gray = 0;
            else gray = (gray - blackPoint) * (255 / (whitePoint - blackPoint));
        }
        if (grayscale || cleanEnabled) {
            data[i] = gray; data[i + 1] = gray; data[i + 2] = gray;
        }
        data[i + 3] = 255;
    }
    return data;
}

/* ---------------------------------------------------------- messages */

if (typeof self !== 'undefined' && typeof importScripts === 'function') {
    self.onmessage = async (e) => {
        const msg = e.data;
        try {
            if (msg.type === 'hello') {
                self.postMessage({
                    id: msg.id,
                    offscreen: typeof OffscreenCanvas === 'function' &&
                        typeof OffscreenCanvas.prototype.convertToBlob === 'function',
                    compression: typeof CompressionStream === 'function',
                });
            } else if (msg.type === 'image') {
                const out = await encodeImage(msg);
                const transfer = [];
                if (out.bytes) transfer.push(out.bytes.buffer);
                if (out.mask) transfer.push(out.mask.bytes.buffer);
                self.postMessage(Object.assign({ id: msg.id }, out), transfer);
            } else if (msg.type === 'forget') {
                for (const entry of cache.values()) if (entry.bitmap.close) entry.bitmap.close();
                cache.clear();
                cachedPixels = 0;
                self.postMessage({ id: msg.id });
            } else if (msg.type === 'clean') {
                const data = cleanPixels(msg.data, msg.grayscale, msg.cleanEnabled, msg.whitePoint, msg.blackPoint);
                self.postMessage({ id: msg.id, data }, [data.buffer]);
            } else if (msg.type === 'deskew') {
                self.postMessage({ id: msg.id, angle: calculateDeskewAngle(msg.data, msg.width, msg.height) });
            }
        } catch (err) {
            self.postMessage({ id: msg.id, error: String(err && err.message || err) });
        }
    };
}

if (typeof module === 'object' && module.exports) {
    module.exports = { unpredict, samplesToRGBA, isGray, toGray, pack, calculateDeskewAngle, cleanPixels };
}
