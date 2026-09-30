const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const htmlContent = fs.readFileSync(__dirname + '/index.html', 'utf8');

// The three pure helpers live inline in index.html; cut them out and eval them here.
function extractFn(name) {
    // The functions we grab: getPagesToExtract, getCutPoints, cutsToParts.
    // Each ends at the next blank line before another top-level "function" declaration.
    const re = new RegExp(`function ${name}\\([\\s\\S]*?\\n\\s{8}\\}\\n`);
    const m = htmlContent.match(re);
    if (!m) throw new Error(`Could not find ${name} in index.html`);
    return m[0];
}

eval(extractFn('getPagesToExtract'));
eval(extractFn('getCutPoints'));
eval(extractFn('cutsToParts'));

if (typeof getPagesToExtract !== 'function') { console.error('getPagesToExtract missing'); process.exit(1); }
if (typeof getCutPoints !== 'function') { console.error('getCutPoints missing'); process.exit(1); }
if (typeof cutsToParts !== 'function') { console.error('cutsToParts missing'); process.exit(1); }

function pagesArr(rangeStr, maxPages) {
    return Array.from(getPagesToExtract(rangeStr, maxPages)).sort((a, b) => a - b);
}
function cutsArr(str, totalPages) {
    return Array.from(getCutPoints(str, totalPages)).sort((a, b) => a - b);
}

try {
    // --- getPagesToExtract ---
    assert.deepStrictEqual(pagesArr('', 5), [0, 1, 2, 3, 4], 'Empty range -> all pages');
    assert.deepStrictEqual(pagesArr('   ', 5), [0, 1, 2, 3, 4], 'Whitespace range -> all pages');
    assert.deepStrictEqual(pagesArr('1, 3, 5', 5), [0, 2, 4], 'Single pages');
    assert.deepStrictEqual(pagesArr(' 1 , 3 , 5 ', 5), [0, 2, 4], 'Single pages, extra whitespace');
    assert.deepStrictEqual(pagesArr('1-3', 5), [0, 1, 2], 'Simple range');
    assert.deepStrictEqual(pagesArr('3-1', 5), [0, 1, 2], 'Reverse range');
    assert.deepStrictEqual(pagesArr('1-3, 5', 5), [0, 1, 2, 4], 'Mixed range and single');
    assert.deepStrictEqual(pagesArr('1-4, 3-5', 5), [0, 1, 2, 3, 4], 'Overlapping ranges');
    assert.deepStrictEqual(pagesArr('1-2, 1-2', 5), [0, 1], 'Duplicate ranges');
    assert.deepStrictEqual(pagesArr('1, 1, 1', 5), [0], 'Duplicate singles');
    assert.deepStrictEqual(pagesArr('1-10', 5), [0, 1, 2, 3, 4], 'Upper out of bounds');
    assert.deepStrictEqual(pagesArr('-5', 5), [], 'Negative single');
    assert.deepStrictEqual(pagesArr('0', 5), [], 'Page 0');
    assert.deepStrictEqual(pagesArr('6', 5), [], 'Page > max');
    assert.deepStrictEqual(pagesArr('abc', 5), [], 'Alphabetic string');
    assert.deepStrictEqual(pagesArr('1-abc', 5), [], 'Half malformed range');
    assert.deepStrictEqual(pagesArr('1-3, abc', 5), [0, 1, 2], 'Mixed valid and malformed');
    console.log('getPagesToExtract tests passed.');

    // --- getCutPoints ---
    assert.deepStrictEqual(cutsArr('', 10), [], 'Empty cuts -> no cuts');
    assert.deepStrictEqual(cutsArr('5', 10), [5], 'One cut');
    assert.deepStrictEqual(cutsArr('5, 8', 10), [5, 8], 'Two cuts');
    assert.deepStrictEqual(cutsArr('8, 5', 10), [5, 8], 'Cuts sort ascending');
    assert.deepStrictEqual(cutsArr('5, 5', 10), [5], 'Duplicate cuts dedupe');
    assert.deepStrictEqual(cutsArr('0, 10, 11', 10), [], 'Cut at 0, at total, and beyond are dropped');
    assert.deepStrictEqual(cutsArr('-1, 3, abc', 10), [3], 'Negative, valid, and gibberish mixed');
    console.log('getCutPoints tests passed.');

    // --- cutsToParts ---
    assert.deepStrictEqual(cutsToParts([], 10), [{ from: 1, to: 10 }], 'No cuts -> one part covering all');
    assert.deepStrictEqual(cutsToParts([5], 10), [{ from: 1, to: 5 }, { from: 6, to: 10 }], 'One cut -> two parts');
    assert.deepStrictEqual(cutsToParts([5, 8], 10),
        [{ from: 1, to: 5 }, { from: 6, to: 8 }, { from: 9, to: 10 }], 'Two cuts -> three parts');
    assert.deepStrictEqual(cutsToParts([1], 10),
        [{ from: 1, to: 1 }, { from: 2, to: 10 }], 'Cut at 1 -> first part is one page');
    assert.deepStrictEqual(cutsToParts([9], 10),
        [{ from: 1, to: 9 }, { from: 10, to: 10 }], 'Cut at N-1 -> last part is one page');
    console.log('cutsToParts tests passed.');

} catch (error) {
    console.error('Test failed:', error.message);
    process.exit(1);
}

// Worker source shape: the message types the page expects must still be sent.
try {
    const workerContent = fs.readFileSync(__dirname + '/worker.js', 'utf8');
    assert.ok(workerContent.includes('pdf-lib.min.js'), 'Worker imports pdf-lib');
    assert.ok(workerContent.includes('jszip.min.js'), 'Worker imports jszip');
    assert.ok(workerContent.includes('self.postMessage'), 'Worker uses postMessage');
    assert.ok(workerContent.includes("type: 'progress'"), 'Worker sends progress');
    assert.ok(workerContent.includes("type: 'done'"), 'Worker sends done');
    assert.ok(/action\s*===\s*'extract'/.test(workerContent), 'Worker handles extract action');
    assert.ok(/action\s*===\s*'split'/.test(workerContent), 'Worker handles split action');
    assert.ok(/action\s*===\s*'each'/.test(workerContent), 'Worker handles each action');
    console.log('Worker static analysis passed.');
} catch (error) {
    console.error('Worker test failed:', error.message);
    process.exit(1);
}

// A file that is not a PDF is turned away with a toast.
const dom = new JSDOM(htmlContent, {
    runScripts: 'dangerously',
    beforeParse(window) {
        window.setupDropZone = function() {};
        window.showToast = function(msg, type) {
            window.__toastMsg = msg;
            window.__toastType = type;
        };
        window.LL_I18N = { t: (en) => en };
        // pdf-lib and pdf.js are not loaded here; nothing on this path calls them.
    }
});

setTimeout(() => {
    try {
        console.log('Running Invalid PDF Test...');
        const window = dom.window;

        window.eval(`
            const file = new window.File([''], 'test.txt', { type: 'text/plain' });
            handleFileSelection([file]);
        `);

        assert.strictEqual(window.__toastMsg, 'That is not a PDF.', 'Wrong toast message');
        assert.strictEqual(window.__toastType, 'error', 'Wrong toast type');

        console.log('Invalid PDF test passed.');
        console.log('All tests passed against index.html and worker.js.');
        process.exit(0);
    } catch (e) {
        console.error('Invalid PDF Test failed:', e.message);
        process.exit(1);
    }
}, 500);
