const fs = require('fs');
const assert = require('assert');

const htmlContent = fs.readFileSync(__dirname + '/index.html', 'utf8');

// The three fixes this test guards: the WinAnsi character check that stops
// pdf-lib from throwing "cannot encode …" mid-loop; the vertical alignment
// that puts pdf-lib's baseline where the CSS overlay showed its top edge;
// and the encrypted-PDF path that rolls back to the drop zone instead of
// leaving a broken editor.

// --- hasNonWinAnsi ---
// The function is defined inline in a browser-side <script>. Cut it out and
// eval it so we can call it from Node.
function inlineFn(name) {
    const re = new RegExp(`function ${name}\\([\\s\\S]*?\\n\\s{8}\\}`);
    const m = htmlContent.match(re);
    if (!m) throw new Error(`Could not find ${name} in index.html`);
    return m[0];
}

const winAnsiExtras = htmlContent.match(/const WIN_ANSI_EXTRAS = new Set\(\[[\s\S]*?\]\);/);
assert.ok(winAnsiExtras, 'WIN_ANSI_EXTRAS set not found in index.html');
// eval'd `const` is trapped in the eval's scope; make it visible to the
// following eval by re-declaring at module scope.
var WIN_ANSI_EXTRAS;
eval(winAnsiExtras[0].replace('const WIN_ANSI_EXTRAS', 'WIN_ANSI_EXTRAS'));
var hasNonWinAnsi;
eval(inlineFn('hasNonWinAnsi').replace('function hasNonWinAnsi', 'hasNonWinAnsi = function'));

try {
    // Latin letters, digits, common punctuation: all fine
    assert.strictEqual(hasNonWinAnsi('CONFIDENTIAL'), false, 'plain ASCII');
    assert.strictEqual(hasNonWinAnsi('Vertraulich'), false, 'German basic Latin');
    assert.strictEqual(hasNonWinAnsi('Grüße!'), false, 'German umlauts and eszett (Latin-1)');
    assert.strictEqual(hasNonWinAnsi('Piñata café'), false, 'Spanish accents (Latin-1)');
    assert.strictEqual(hasNonWinAnsi('“curly” quotes'), false, 'WinAnsi curly quotes');
    assert.strictEqual(hasNonWinAnsi('€100'), false, 'euro sign');
    assert.strictEqual(hasNonWinAnsi('one–two—three'), false, 'en dash and em dash');
    assert.strictEqual(hasNonWinAnsi(''), false, 'empty string');

    // Off-encoding: pdf-lib will throw here
    assert.strictEqual(hasNonWinAnsi('CONFIDENTIAL ✅'), true, 'emoji');
    assert.strictEqual(hasNonWinAnsi('机密'), true, 'CJK');
    assert.strictEqual(hasNonWinAnsi('Секрет'), true, 'Cyrillic');
    assert.strictEqual(hasNonWinAnsi('Απόρρητο'), true, 'Greek');
    assert.strictEqual(hasNonWinAnsi('محرم'), true, 'Arabic');
    assert.strictEqual(hasNonWinAnsi('Đặc biệt'), true, 'Vietnamese combining marks');
    assert.strictEqual(hasNonWinAnsi('ok😀'), true, 'surrogate-pair emoji');

    console.log('hasNonWinAnsi tests passed.');
} catch (err) {
    console.error('hasNonWinAnsi test failed:', err.message);
    process.exit(1);
}

// --- WYSIWYG geometry ---
try {
    // pdf-lib's baseline offset must be subtracted from the drawn Y so the
    // preview's top edge lines up with the pdf-lib baseline. If a future
    // edit removes this we'll silently ship the old drift back.
    assert.ok(/heightAtSize\(fontSize,\s*\{\s*descender:\s*false\s*\}\)/.test(htmlContent),
        'processPdf must ask pdf-lib for the ascent');
    assert.ok(/const pdfY = height - \(height \* posY\) - ascent/.test(htmlContent),
        'processPdf must subtract the ascent from the drawn Y');

    // CSS transform-origin must rotate about the baseline, not the box's bottom-left
    assert.ok(/transform-origin:\s*0%\s*72%/.test(htmlContent),
        'CSS transform-origin must rotate about the baseline (~72%)');

    console.log('WYSIWYG alignment guards present.');
} catch (err) {
    console.error('WYSIWYG geometry test failed:', err.message);
    process.exit(1);
}

// --- Encrypted PDF path ---
try {
    // handleFiles must roll back to the drop zone when the preview fails
    assert.ok(/PasswordException/.test(htmlContent),
        'handleFiles must recognise pdf.js PasswordException');
    assert.ok(htmlContent.includes('currentFiles = [];') &&
              htmlContent.indexOf('currentFiles = [];') !==
              htmlContent.lastIndexOf('currentFiles = [];'),
        'handleFiles must clear currentFiles on preview failure (two clearings expected: reset and preview-fail)');

    // processPdf's encrypted branch stays put — pdf-lib's own error text
    assert.ok(/is encrypted[\s\S]{0,200}stay locked/.test(htmlContent),
        'processPdf must keep its friendly encrypted message');

    console.log('Encrypted-PDF path guards present.');
} catch (err) {
    console.error('Encrypted PDF test failed:', err.message);
    process.exit(1);
}

console.log('All pdf-watermarker tests passed.');
