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

/* CMYK samples as two pictures a canvas can scale: C, M and Y in the red,
   green and blue of one, K in the other. Nothing is converted, so the four
   numbers come back out as they went in, only fewer of them. */
function cmykPlanes(samples, width, height, bpc) {
    const rowBytes = Math.ceil(width * 4 * bpc / 8);
    if (samples.length < rowBytes * height) throw new Error('image data is shorter than its size says');
    const max = (1 << bpc) - 1;
    const read = (row, k) => {
        if (bpc === 8) return samples[row + k];
        if (bpc === 16) return samples[row + 2 * k];
        const bit = k * bpc;
        return ((samples[row + (bit >> 3)] >> (8 - bpc - (bit & 7))) & max) * 255 / max;
    };
    const cmy = new Uint8ClampedArray(width * height * 4);
    const k = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        const row = y * rowBytes;
        for (let x = 0; x < width; x++) {
            const o = (y * width + x) * 4;
            cmy[o] = read(row, x * 4); cmy[o + 1] = read(row, x * 4 + 1); cmy[o + 2] = read(row, x * 4 + 2); cmy[o + 3] = 255;
            k[o] = k[o + 1] = k[o + 2] = read(row, x * 4 + 3); k[o + 3] = 255;
        }
    }
    return { cmy, k };
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

/* ---------------------------------------------------------- grey JPEG */

/* A one-channel baseline JPEG encoder. Canvas only writes three channels,
   and a grey image with its own colour space (an ICC grey profile, CalGray)
   has to stay one channel to keep that colour space: stored as RGB it would
   lose the profile, and every colour-managed viewer would show different
   tones. Standard tables from Annex K of the JPEG spec, quality scaled the
   way libjpeg does it, so quality 72 here means what it means in canvas. */
const ZIGZAG = [
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21,
    28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61,
    54, 47, 55, 62, 63,
];
const LUMA_Q = [
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51,
    87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120,
    101, 72, 92, 95, 98, 112, 100, 103, 99,
];
const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_VALS = [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14,
    0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09,
    0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a,
    0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65,
    0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88,
    0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9,
    0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca,
    0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea,
    0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];

function huffmanCodes(bits, vals) {
    const codes = new Map();
    let code = 0, k = 0;
    for (let len = 1; len <= 16; len++) {
        for (let i = 0; i < bits[len - 1]; i++) codes.set(vals[k++], [code++, len]);
        code <<= 1;
    }
    return codes;
}
const DC_CODES = huffmanCodes(DC_BITS, DC_VALS);
const AC_CODES = huffmanCodes(AC_BITS, AC_VALS);

const COS = [];
for (let x = 0; x < 8; x++) {
    COS.push([]);
    for (let u = 0; u < 8; u++) COS[x].push(Math.cos((2 * x + 1) * u * Math.PI / 16) * (u === 0 ? Math.SQRT1_2 : 1) / 2);
}

function encodeGrayJpeg(pixels, width, height, quality) {
    const q = Math.max(1, Math.min(100, Math.round(quality * 100)));
    const scale = q < 50 ? 5000 / q : 200 - q * 2;
    const table = LUMA_Q.map((t) => Math.max(1, Math.min(255, Math.floor((t * scale + 50) / 100))));

    const out = [];
    const byte = (b) => out.push(b & 0xff);
    const word = (w) => { byte(w >> 8); byte(w); };
    word(0xffd8);
    word(0xffe0); word(16); [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0].forEach(byte);
    word(0xffdb); word(67); byte(0); for (let i = 0; i < 64; i++) byte(table[ZIGZAG[i]]);
    word(0xffc0); word(11); byte(8); word(height); word(width); byte(1); byte(1); byte(0x11); byte(0);
    word(0xffc4); word(3 + 16 + DC_VALS.length); byte(0x00); DC_BITS.forEach(byte); DC_VALS.forEach(byte);
    word(0xffc4); word(3 + 16 + AC_VALS.length); byte(0x10); AC_BITS.forEach(byte); AC_VALS.forEach(byte);
    word(0xffda); word(8); byte(1); byte(1); byte(0); byte(0); byte(63); byte(0);

    let acc = 0, nbits = 0;
    const put = (code, len) => {
        acc = (acc << len) | code; nbits += len;
        while (nbits >= 8) {
            const b = (acc >> (nbits - 8)) & 0xff;
            out.push(b);
            if (b === 0xff) out.push(0); // a data byte of FF is followed by 00
            nbits -= 8;
            acc &= (1 << nbits) - 1;
        }
    };
    const category = (v) => { v = Math.abs(v); let n = 0; while (v) { n++; v >>= 1; } return n; };
    const putValue = (v, n) => put(v < 0 ? v + (1 << n) - 1 : v, n);

    const block = new Float64Array(64), tmp = new Float64Array(64), coef = new Int32Array(64);
    let prevDC = 0;
    for (let by = 0; by < height; by += 8) {
        for (let bx = 0; bx < width; bx += 8) {
            for (let y = 0; y < 8; y++) {
                const sy = Math.min(height - 1, by + y) * width;
                for (let x = 0; x < 8; x++) block[y * 8 + x] = pixels[sy + Math.min(width - 1, bx + x)] - 128;
            }
            for (let y = 0; y < 8; y++) {
                for (let u = 0; u < 8; u++) {
                    let s = 0;
                    for (let x = 0; x < 8; x++) s += block[y * 8 + x] * COS[x][u];
                    tmp[y * 8 + u] = s;
                }
            }
            for (let u = 0; u < 8; u++) {
                for (let v = 0; v < 8; v++) {
                    let s = 0;
                    for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * COS[y][v];
                    coef[v * 8 + u] = Math.round(s / table[v * 8 + u]);
                }
            }
            const dc = coef[0], diff = dc - prevDC;
            prevDC = dc;
            const dn = category(diff);
            put(...DC_CODES.get(dn));
            if (dn) putValue(diff, dn);
            let run = 0;
            for (let i = 1; i < 64; i++) {
                const v = coef[ZIGZAG[i]];
                if (v === 0) { run++; continue; }
                while (run > 15) { put(...AC_CODES.get(0xf0)); run -= 16; }
                const n = category(v);
                put(...AC_CODES.get((run << 4) | n));
                putValue(v, n);
                run = 0;
            }
            if (run) put(...AC_CODES.get(0x00));
        }
    }
    if (nbits) put((1 << (8 - nbits)) - 1, 8 - nbits); // pad the last byte with ones
    word(0xffd9);
    return Uint8Array.from(out);
}

/* ---------------------------------------------------------- pixels */

/* A JPEG without the extras a browser might act on: APP1 (EXIF, whose
   orientation flag would turn the picture) and APP2 (an ICC profile, which
   Safari and Firefox apply even when asked not to). A PDF reader ignores
   both; the PDF's own colour space describes the numbers. Everything else,
   JFIF and Adobe's APP14 colour transform flag included, stays. */
function plainJpeg(bytes) {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
    const keep = [bytes.subarray(0, 2)];
    let i = 2, dropped = false;
    while (i + 4 <= bytes.length && bytes[i] === 0xff) {
        const marker = bytes[i + 1];
        if (marker === 0xff) { i++; continue; } // fill byte
        if (marker === 0xda || marker === 0xd9) break; // image data follows
        const length = (bytes[i + 2] << 8) | bytes[i + 3];
        if (length < 2 || i + 2 + length > bytes.length) return bytes; // damaged; leave it to the decoder
        if (marker === 0xe1 || marker === 0xe2) dropped = true;
        else keep.push(bytes.subarray(i, i + 2 + length));
        i += 2 + length;
    }
    if (!dropped) return bytes;
    keep.push(bytes.subarray(i));
    const out = new Uint8Array(keep.reduce((n, part) => n + part.length, 0));
    let at = 0;
    for (const part of keep) { out.set(part, at); at += part.length; }
    return out;
}

async function decodeJpeg(bytes) {
    const blob = new Blob([plainJpeg(bytes)], { type: 'image/jpeg' });
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
   costs four bytes each, and a CMYK image holds two of them (the black
   plane in its own). */
const cache = new Map();
let cachedPixels = 0;
const CACHE_PIXELS = 40 * 1000 * 1000;

const pixelsOf = (entry) => entry.bitmap.width * entry.bitmap.height +
    (entry.kBitmap ? entry.kBitmap.width * entry.kBitmap.height : 0);

function remember(key, bitmap, extra) {
    const entry = Object.assign({ bitmap }, extra);
    const px = pixelsOf(entry);
    if (px > CACHE_PIXELS) return;
    while (cachedPixels + px > CACHE_PIXELS && cache.size) {
        const [oldKey, old] = cache.entries().next().value;
        cache.delete(oldKey);
        cachedPixels -= pixelsOf(old);
        if (old.bitmap.close) old.bitmap.close();
        if (old.kBitmap && old.kBitmap.close) old.kBitmap.close();
    }
    cache.set(key, entry);
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

    let bitmap, kBitmap = null, gray = false;
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
    } else if (job.cs.kind === 'cmyk') {
        const samples = decodeFilters(job.bytes, job.filters, job.predictor);
        const planes = cmykPlanes(samples, job.width, job.height, job.bpc);
        bitmap = await createImageBitmap(new ImageData(planes.cmy, job.width, job.height));
        kBitmap = await createImageBitmap(new ImageData(planes.k, job.width, job.height));
    } else {
        const samples = decodeFilters(job.bytes, job.filters, job.predictor);
        const rgba = samplesToRGBA(samples, job.width, job.height, job.bpc, job.cs);
        const cs = job.cs.kind === 'indexed' ? job.cs.base : job.cs;
        // An RGB image that happens to be grey can be stored as grey, unless
        // a profile describes its RGB numbers: then grey would be a different
        // colour on every viewer that reads the profile
        gray = cs.kind === 'gray' || (!cs.managed && isGray(rgba));
        bitmap = await createImageBitmap(new ImageData(rgba, job.width, job.height));
    }

    let mask = null;
    if (job.smask) {
        const m = job.smask;
        const samples = decodeFilters(m.bytes, m.filters, m.predictor);
        const rgba = samplesToRGBA(samples, m.width, m.height, 8, { kind: 'gray', n: 1 });
        mask = await createImageBitmap(new ImageData(rgba, m.width, m.height));
    }

    const entry = { bitmap, kBitmap, gray, mask };
    remember(job.key, bitmap, { kBitmap, gray, mask });
    return entry;
}

async function scaledMask(maskBitmap, job, width, height) {
    if (typeof CompressionStream !== 'function') return null;
    const mw = Math.max(1, Math.round(maskBitmap.width * width / job.width));
    const mh = Math.max(1, Math.round(maskBitmap.height * height / job.height));
    const md = drawScaled(maskBitmap, mw, mh).ctx.getImageData(0, 0, mw, mh).data;
    return { bytes: await deflate(pack(md, 1)), width: mw, height: mh };
}

async function encodeImage(msg) {
    const { job, width, height, quality, grayscale, tryFlate } = msg;
    const src = await sourceOf(job);
    if (!src) return { missing: true };

    const mask = src.mask ? await scaledMask(src.mask, job, width, height) : null;

    if (src.kBitmap) {
        // CMYK: both halves scaled the same way, then put back together
        const cmy = drawScaled(src.bitmap, width, height).ctx.getImageData(0, 0, width, height).data;
        const k = drawScaled(src.kBitmap, width, height).ctx.getImageData(0, 0, width, height).data;
        const out = new Uint8Array(width * height * 4);
        for (let i = 0, o = 0; i < cmy.length; i += 4, o += 4) {
            out[o] = cmy[i]; out[o + 1] = cmy[i + 1]; out[o + 2] = cmy[i + 2]; out[o + 3] = k[i];
        }
        return { bytes: await deflate(out), filter: 'FlateDecode', channels: 4, width, height, mask, converted: false };
    }

    const { c, ctx } = drawScaled(src.bitmap, width, height);
    const img = ctx.getImageData(0, 0, width, height);
    const colourSource = !src.gray;
    let channels = src.gray ? 1 : 3;
    if (grayscale && colourSource) { toGray(img.data); ctx.putImageData(img, 0, 0); channels = 1; }

    let best;
    if (channels === 1) {
        best = { bytes: encodeGrayJpeg(pack(img.data, 1), width, height, quality), filter: 'DCTDecode', channels: 1 };
    } else {
        const jpegBlob = await c.convertToBlob({ type: 'image/jpeg', quality });
        // Chrome and Safari tag what they encode as sRGB; the PDF says what
        // the colours are, so the tag goes, as it would confuse a reader that
        // honours it
        best = { bytes: plainJpeg(new Uint8Array(await jpegBlob.arrayBuffer())), filter: 'DCTDecode', channels: 3 };
    }

    // Lossless when it is nearly as small: diagrams, screenshots and
    // anything with flat colour come out sharper and often smaller.
    if (tryFlate && typeof CompressionStream === 'function') {
        const flate = await deflate(pack(img.data, channels));
        if (flate.length <= best.bytes.length * 1.15) best = { bytes: flate, filter: 'FlateDecode', channels };
    }

    return {
        bytes: best.bytes, filter: best.filter, channels: best.channels, width, height, mask,
        converted: grayscale && colourSource,
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
                for (const entry of cache.values()) {
                    if (entry.bitmap.close) entry.bitmap.close();
                    if (entry.kBitmap && entry.kBitmap.close) entry.kBitmap.close();
                }
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
    module.exports = { cmykPlanes, encodeGrayJpeg, plainJpeg, unpredict, samplesToRGBA, isGray, toGray, pack, calculateDeskewAngle, cleanPixels };
}
