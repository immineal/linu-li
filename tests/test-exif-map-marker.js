/**
 * EXIF Scrubber — metadata table and map marker regression test (Puppeteer).
 *
 * Two things are pinned here.
 *
 * The metadata table is built from whatever a stranger's photo happens to
 * carry. A camera model of `<img onerror=...>` must arrive as six visible
 * characters, not as an element — and the RISK badge next to a GPS fix
 * must still be a real badge, not the literal text of a span.
 *
 * The second half guards the vendored Leaflet asset paths. Leaflet's default marker,
 * its retina variant and the drop shadow are served from this repo, so a
 * moved or renamed directory shows up as broken image placeholders on the
 * map and nowhere else. The test loads a JPEG carrying GPS coordinates,
 * opts in to the map and asserts that every image Leaflet inserted really
 * decoded.
 *
 * Tile images come from openstreetmap.org; they are blocked here so the
 * test says nothing about the network.
 */
const puppeteer = require('puppeteer');
const piexif = require('../assets/vendor/piexif.js');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

// Smallest thing piexif will write into: SOI, a stub scan, EOI.
function gpsTaggedJpegBase64() {
    const bytes = Uint8Array.from([
        0xFF, 0xD8,
        0xFF, 0xDA, 0x00, 0x08, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
        0xFF, 0xD9,
    ]);
    const plain = 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64');
    // 40°44'54.0"N, 73°59'09.0"W — Manhattan.
    const gps = {
        [piexif.GPSIFD.GPSLatitudeRef]: 'N',
        [piexif.GPSIFD.GPSLatitude]: [[40, 1], [44, 1], [540, 10]],
        [piexif.GPSIFD.GPSLongitudeRef]: 'W',
        [piexif.GPSIFD.GPSLongitude]: [[73, 1], [59, 1], [90, 10]],
    };
    const exifBytes = piexif.dump({ '0th': {}, Exif: {}, GPS: gps });
    return piexif.insert(exifBytes, plain);
}

// Same stub JPEG, but with HTML sitting in the string tags a camera writes.
function hostileStringsJpegBase64() {
    const bytes = Uint8Array.from([
        0xFF, 0xD8,
        0xFF, 0xDA, 0x00, 0x08, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
        0xFF, 0xD9,
    ]);
    const plain = 'data:image/jpeg;base64,' + Buffer.from(bytes).toString('base64');
    const zeroth = {
        [piexif.ImageIFD.Make]: '<img src=x onerror="window.__xss=1">',
        [piexif.ImageIFD.Model]: '</span><script>window.__xss=1<\/script>',
        [piexif.ImageIFD.Software]: '"><svg onload="window.__xss=1">',
    };
    const exifBytes = piexif.dump({ '0th': zeroth, Exif: {}, GPS: {} });
    return piexif.insert(exifBytes, plain);
}

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

    const notFound = [];
    page.on('response', (res) => {
        if (res.status() >= 400) notFound.push(res.status() + ' ' + res.url());
    });

    await page.setRequestInterception(true);
    page.on('request', (req) => {
        // Map tiles live on someone else's servers; this test is about ours.
        if (/tile\.openstreetmap\.org/.test(req.url())) {
            req.respond({ status: 200, contentType: 'image/png', body: '' });
        } else {
            req.continue();
        }
    });

    await page.goto(BASE + '/tools/exif-scrubber/', { waitUntil: 'networkidle2' });

    const dataUrl = gpsTaggedJpegBase64();
    await page.evaluate(async (url) => {
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], 'gps.jpg', { type: 'image/jpeg' });
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = document.getElementById('fileInput');
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }, dataUrl);

    // The GPS row is what unlocks the map opt-in.
    await page.waitForFunction(
        () => !document.getElementById('mapOptInOverlay').classList.contains('hidden'),
        { timeout: 10000 }
    );

    const coords = await page.$$eval('.meta-row', (rows) => {
        const row = rows.find((r) => r.querySelector('.meta-label').textContent === 'GPS Coordinates');
        return row ? row.querySelector('.meta-value').textContent.trim() : null;
    });
    if (!coords || !/^40\.7483, -73\.9858/.test(coords)) {
        fail('expected the Manhattan coordinates in the table, got ' + JSON.stringify(coords));
    }

    // The RISK badge has to be a live element, not text that reads "<span ...>".
    const badge = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.meta-row'));
        const row = rows.find((r) => r.querySelector('.meta-label').textContent === 'GPS Coordinates');
        const el = row && row.querySelector('.meta-value .risk-badge');
        return { present: !!el, text: el ? el.textContent : null,
                 literal: row ? row.querySelector('.meta-value').textContent.includes('<span') : false };
    });
    if (!badge.present) fail('the GPS row carries no risk-badge element');
    if (badge.text !== 'RISK') fail('risk badge reads ' + JSON.stringify(badge.text) + ', expected "RISK"');
    if (badge.literal) fail('the span markup leaked into the cell as visible text');

    // Now a photo whose string tags contain markup.
    await page.evaluate(async (url) => {
        delete window.__xss;
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], 'hostile.jpg', { type: 'image/jpeg' });
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = document.getElementById('fileInput');
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }, hostileStringsJpegBase64());

    await page.waitForFunction(
        () => {
            const rows = Array.from(document.querySelectorAll('.meta-row .meta-label'));
            return rows.some((l) => l.textContent === 'Camera Make');
        },
        { timeout: 10000 }
    );
    await new Promise((r) => setTimeout(r, 60));

    const hostile = await page.evaluate(() => {
        const table = document.getElementById('metaTable');
        return {
            xss: window.__xss || 0,
            injected: table.querySelectorAll('img, script, svg, iframe').length,
            onAttr: Array.from(table.querySelectorAll('*')).filter((el) =>
                Array.from(el.attributes).some((a) => /^on/i.test(a.name))
            ).length,
            text: table.textContent,
        };
    });
    if (hostile.xss) fail('metadata strings executed script');
    if (hostile.injected) fail(hostile.injected + ' element(s) injected from metadata strings');
    if (hostile.onAttr) fail(hostile.onAttr + ' on* handler(s) injected from metadata strings');
    if (!hostile.text.includes('<img src=x onerror=')) {
        fail('the camera make was not shown as plain text: ' + JSON.stringify(hostile.text.slice(0, 160)));
    }

    // Back to the GPS photo for the map half of the test. Re-selecting the
    // same file is refused as a duplicate, so go through the queue the way
    // the page offers it: click the first entry in the file list.
    await page.click('.file-item .file-info');
    await page.waitForFunction(
        () => !document.getElementById('mapOptInOverlay').classList.contains('hidden'),
        { timeout: 10000 }
    );

    await page.click('#loadMapBtn');
    await page.waitForSelector('#mapContainer img.leaflet-marker-icon', { timeout: 10000 });

    // Give the shadow and the icon a moment to decode.
    await page.waitForFunction(
        () => {
            const imgs = document.querySelectorAll('#mapContainer img.leaflet-marker-icon, #mapContainer img.leaflet-marker-shadow');
            return imgs.length >= 1 && Array.from(imgs).every((i) => i.complete);
        },
        { timeout: 10000 }
    );

    const images = await page.$$eval(
        '#mapContainer img.leaflet-marker-icon, #mapContainer img.leaflet-marker-shadow',
        (imgs) => imgs.map((i) => ({ src: i.getAttribute('src'), width: i.naturalWidth }))
    );

    if (images.length === 0) fail('Leaflet inserted no marker images at all');
    images.forEach((img) => {
        if (img.width === 0) fail('marker image did not load: ' + img.src);
    });

    const localMisses = notFound.filter((u) => !/tile\.openstreetmap\.org/.test(u));
    if (localMisses.length) fail('requests to this site failed:\n  ' + localMisses.join('\n  '));

    await browser.close();

    if (process.exitCode) {
        console.error('EXIF map marker test failed.');
    } else {
        console.log('PASS: EXIF scrubber — metadata rendered as text, RISK badge intact, ' + images.length + ' Leaflet image(s) loaded');
    }
})().catch((err) => {
    console.error('FAIL: ' + err.message);
    process.exit(1);
});
