/**
 * layout.js — the SEO block, run the way the test suite runs it (jsdom).
 *
 * setupSEO fills in the tab title and the meta tags every page shares. It
 * reads the heading with innerText on purpose: the scene planner's wordmark
 * renders to nothing, and innerText is the only property that notices.
 * jsdom does not implement innerText at all, which is a different thing
 * from "renders to nothing" and must not take the function down with it.
 */
const fs = require('fs');
const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');

const layoutJs = fs.readFileSync(__dirname + '/../assets/js/layout.js', 'utf8');

function fail(msg) {
    console.error('FAIL: ' + msg);
    process.exitCode = 1;
}

function run(html, url) {
    const errors = [];
    // Keep jsdom from printing its own stack trace: the assertions below
    // report what went wrong, in one line.
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (err) => errors.push(err.message));
    const dom = new JSDOM(html, { runScripts: 'outside-only', url, virtualConsole });
    dom.window.addEventListener('error', (e) => errors.push(e.message));
    try {
        dom.window.eval(layoutJs);
    } catch (err) {
        errors.push(err.message);
    }
    // layout.js does its work on DOMContentLoaded, which jsdom has already
    // fired for a document built this way — fire it again for the listener
    // that was only just registered.
    try {
        dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    } catch (err) {
        errors.push(err.message);
    }
    return { dom, errors };
}

const PAGE = `<!DOCTYPE html><html><head><title>Unit Converter | Linus Linhof</title></head>
<body><main><div class="tool-header"><h1>Unit Converter</h1>
<p>Fast conversion for Length, Weight, Temperature.</p></div></main></body></html>`;

{
    const { dom, errors } = run(PAGE, 'http://localhost/tools/unit-converter/');
    if (errors.length) fail('setupSEO threw: ' + errors.join(' | '));

    const doc = dom.window.document;
    assert.strictEqual(doc.title, 'Unit Converter | Linus Linhof', 'tab title');

    const desc = doc.querySelector('meta[name="description"]');
    if (!desc) fail('no description meta tag was written');
    else if (!/Fast conversion/.test(desc.getAttribute('content'))) {
        fail('description reads ' + JSON.stringify(desc.getAttribute('content')) + ', expected the page paragraph');
    }

    for (const [attr, name] of [['property', 'og:title'], ['property', 'og:image'], ['name', 'twitter:title']]) {
        const el = doc.querySelector(`meta[${attr}="${name}"]`);
        if (!el) fail(`no ${name} meta tag`);
        else if (/undefined/.test(el.getAttribute('content'))) {
            fail(`${name} contains the word "undefined": ${el.getAttribute('content')}`);
        }
    }
}

// A page whose heading renders to nothing falls back to its own <title>.
{
    const html = `<!DOCTYPE html><html><head><title>Bühnenbild-Planer | Linus Linhof</title></head>
<body><main><h1><span></span></h1><p>Plan.</p></main></body></html>`;
    const { dom, errors } = run(html, 'http://localhost/tools/buehnenbild/');
    if (errors.length) fail('setupSEO threw on the empty-heading page: ' + errors.join(' | '));
    assert.strictEqual(dom.window.document.title, 'Bühnenbild-Planer | Linus Linhof', 'fallback tab title');
}

if (process.exitCode) {
    console.error('layout.js SEO test failed.');
} else {
    console.log('PASS: layout.js SEO — titles and meta tags written, nothing thrown');
}
