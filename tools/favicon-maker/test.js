const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const htmlContent = fs.readFileSync(__dirname + '/index.html', 'utf8');

// Extract sanitiseSvg from index.html and eval it in a DOM.
const match = htmlContent.match(/function sanitiseSvg\([\s\S]*?\n\s{8}\}/);
if (!match) { console.error('Could not find sanitiseSvg in index.html'); process.exit(1); }

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const parseSvg = (str) => new dom.window.DOMParser().parseFromString(str, 'image/svg+xml');

// eval'd function into module scope
var sanitiseSvg;
eval(match[0].replace('function sanitiseSvg', 'sanitiseSvg = function'));

try {
    // A clean SVG stays as-is.
    const clean = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="4"/></svg>`);
    const cleanResult = sanitiseSvg(clean);
    assert.deepStrictEqual(cleanResult, { foreign: 0, script: 0, external: 0 }, 'clean SVG untouched');
    assert.ok(clean.querySelector('circle'), 'clean SVG keeps its shape');

    // foreignObject gets removed.
    const withForeign = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="10" height="10"><div>hi</div></foreignObject><rect/></svg>`);
    const foreignResult = sanitiseSvg(withForeign);
    assert.strictEqual(foreignResult.foreign, 1, 'one foreignObject removed');
    assert.strictEqual(withForeign.querySelector('foreignObject'), null, 'foreignObject is gone');
    assert.ok(withForeign.querySelector('rect'), 'other shapes stay');

    // script inside SVG.
    const withScript = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle/></svg>`);
    const scriptResult = sanitiseSvg(withScript);
    assert.strictEqual(scriptResult.script, 1, 'one script removed');
    assert.strictEqual(withScript.querySelector('script'), null, 'script gone');

    // Inline event handlers stripped.
    const withInlineJs = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><circle onclick="alert(1)" onmouseover="hack()" cx="5" cy="5" r="4"/></svg>`);
    const inlineResult = sanitiseSvg(withInlineJs);
    assert.strictEqual(inlineResult.script, 2, 'two on* attributes removed');
    const circle = withInlineJs.querySelector('circle');
    assert.ok(circle && !circle.hasAttribute('onclick'), 'onclick removed from circle');
    assert.ok(circle && !circle.hasAttribute('onmouseover'), 'onmouseover removed');
    assert.strictEqual(circle.getAttribute('cx'), '5', 'other attributes stay');

    // External image reference removed; relative one kept.
    const withExtImage = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image href="http://evil.example.com/x.png" width="10" height="10"/><image href="local.png" width="10" height="10"/></svg>`);
    const extResult = sanitiseSvg(withExtImage);
    assert.strictEqual(extResult.external, 1, 'one external image reference removed');
    const remaining = Array.from(withExtImage.querySelectorAll('image'));
    assert.strictEqual(remaining.length, 1, 'the local image stays');
    assert.strictEqual(remaining[0].getAttribute('href'), 'local.png', 'local href preserved');

    // External <use> ref.
    const withExtUse = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil.example.com/x.svg#a"/></svg>`);
    const useResult = sanitiseSvg(withExtUse);
    assert.strictEqual(useResult.external, 1, 'external use removed');

    console.log('sanitiseSvg tests passed.');
} catch (err) {
    console.error('Test failed:', err.message);
    process.exit(1);
}

// The other Cluster-4 polish items are CSS-only. Spot-check the results
// so a future edit that revives crimson/magenta/cyan in jwt-debugger, or
// re-narrows the pw-generator card, is caught here rather than by eye.
try {
    const jwt = fs.readFileSync(__dirname + '/../jwt-debugger/index.html', 'utf8');
    assert.ok(!/#fb015b|#d63aff|#00b9f1/i.test(jwt),
        'jwt-debugger must not use the jwt.io crimson/magenta/cyan hex codes');
    assert.ok(/color: var\(--accent\);?\s*}/.test(jwt) || /color: var\(--accent\)/.test(jwt),
        'jwt-debugger must fall back on palette variables');

    const pw = fs.readFileSync(__dirname + '/../pw-generator/index.html', 'utf8');
    assert.ok(!/max-width:\s*800px/.test(pw),
        'pw-generator must not force a narrower card than every other tool');

    console.log('jwt-debugger and pw-generator polish held.');
} catch (err) {
    console.error('Test failed:', err.message);
    process.exit(1);
}

console.log('All favicon-maker (and adjacent polish) tests passed.');
