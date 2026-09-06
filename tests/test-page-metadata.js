/**
 * What every page advertises about itself (Puppeteer).
 *
 * Every page advertises an og:image, and for a long time that URL was a
 * 404 — a shared link asked for a JPEG and got the 404 page's HTML back,
 * so no preview showed anywhere. The URL is built at runtime from the
 * origin, so the only honest check is to read what the page actually
 * advertises and fetch it.
 */
const puppeteer = require('puppeteer');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const PAGES = ['/', '/tools/pdf-splitter/', '/impressum.html'];

// Facebook and LinkedIn want at least 200x200; 1200x630 is the size that
// renders as a large card everywhere.
const MIN_WIDTH = 600;
const MIN_HEIGHT = 315;

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
    const seen = new Set();

    for (const path of PAGES) {
        await page.goto(BASE + path, { waitUntil: 'networkidle2' });
        const url = await page.evaluate(() => {
            const el = document.querySelector('meta[property="og:image"]');
            return el ? el.getAttribute('content') : null;
        });
        if (!url) {
            fail(`${path} advertises no og:image`);
            continue;
        }
        seen.add(url);

        const result = await page.evaluate(async (u) => {
            let head;
            try {
                head = await fetch(u, { cache: 'no-store' });
            } catch (err) {
                return { error: err.message };
            }
            const type = head.headers.get('content-type') || '';
            if (!head.ok) return { status: head.status, type };
            const img = new Image();
            const size = await new Promise((res) => {
                img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
                img.onerror = () => res(null);
                img.src = u;
            });
            return { status: head.status, type, size };
        }, url);

        if (result.error) { fail(`${path}: could not fetch ${url} — ${result.error}`); continue; }
        if (result.status !== 200) { fail(`${path}: ${url} answered ${result.status}`); continue; }
        if (!/^image\//.test(result.type)) {
            fail(`${path}: ${url} is served as ${JSON.stringify(result.type)}, not an image — a shared link gets no preview`);
            continue;
        }
        if (!result.size) { fail(`${path}: ${url} did not decode as an image`); continue; }
        if (result.size.w < MIN_WIDTH || result.size.h < MIN_HEIGHT) {
            fail(`${path}: ${url} is ${result.size.w}x${result.size.h}, too small for a large card (want at least ${MIN_WIDTH}x${MIN_HEIGHT})`);
        }

        // Exactly one manifest, and it has to be readable.
        const manifest = await page.evaluate(async () => {
            const links = document.querySelectorAll('link[rel="manifest"]');
            if (links.length !== 1) return { count: links.length };
            const href = links[0].href;
            try {
                const res = await fetch(href, { cache: 'no-store' });
                if (!res.ok) return { count: 1, href, status: res.status };
                const json = await res.json();
                return { count: 1, href, status: res.status, start_url: json.start_url, icons: (json.icons || []).length };
            } catch (err) {
                return { count: 1, href, error: err.message };
            }
        });
        if (manifest.count !== 1) {
            fail(`${path} links to ${manifest.count} web app manifests, expected exactly 1`);
        } else if (manifest.error) {
            fail(`${path}: manifest ${manifest.href} could not be read — ${manifest.error}`);
        } else if (manifest.status !== 200) {
            fail(`${path}: manifest ${manifest.href} answered ${manifest.status}`);
        } else if (!manifest.start_url) {
            fail(`${path}: the manifest names no start_url`);
        } else if (manifest.icons < 1) {
            fail(`${path}: the manifest lists no icon`);
        }
    }

    await browser.close();

    if (process.exitCode) {
        console.error('Page metadata test failed.');
    } else {
        console.log(`PASS: page metadata — ${PAGES.length} pages, ${[...seen].length} preview image that loads and is large enough, one readable manifest each`);
    }
})().catch((err) => {
    console.error('FAIL: ' + err.message);
    process.exit(1);
});
