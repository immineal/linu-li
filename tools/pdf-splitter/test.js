const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const htmlContent = fs.readFileSync(__dirname + '/index.html', 'utf8');

// The function lives inline in index.html; cut it out and eval it here
const functionMatch = htmlContent.match(/function getPagesToExtract[\s\S]*?(?=\s*splitBtn\.addEventListener\('click')/);

if (!functionMatch) {
    console.error("Could not find getPagesToExtract function in index.html");
    process.exit(1);
}

eval(functionMatch[0]);

if (typeof getPagesToExtract !== 'function') {
    console.error("Failed to load getPagesToExtract function");
    process.exit(1);
}

function getPagesToExtractArray(rangeStr, maxPages) {
    return Array.from(getPagesToExtract(rangeStr, maxPages)).sort((a, b) => a - b);
}

try {
    // Empty range should return all pages
    assert.deepStrictEqual(getPagesToExtractArray("", 5), [0, 1, 2, 3, 4], "Empty range failed");
    assert.deepStrictEqual(getPagesToExtractArray("   ", 5), [0, 1, 2, 3, 4], "Whitespace range failed");

    // Valid single pages
    assert.deepStrictEqual(getPagesToExtractArray("1, 3, 5", 5), [0, 2, 4], "Single pages failed");
    assert.deepStrictEqual(getPagesToExtractArray(" 1 , 3 , 5 ", 5), [0, 2, 4], "Single pages with whitespace failed");

    // Valid ranges
    assert.deepStrictEqual(getPagesToExtractArray("1-3", 5), [0, 1, 2], "Simple range failed");
    assert.deepStrictEqual(getPagesToExtractArray("3-1", 5), [0, 1, 2], "Reverse range failed");
    assert.deepStrictEqual(getPagesToExtractArray("1-3, 5", 5), [0, 1, 2, 4], "Mixed range and single failed");

    // Overlapping ranges
    assert.deepStrictEqual(getPagesToExtractArray("1-4, 3-5", 5), [0, 1, 2, 3, 4], "Overlapping ranges failed");
    assert.deepStrictEqual(getPagesToExtractArray("1-2, 1-2", 5), [0, 1], "Duplicate ranges failed");
    assert.deepStrictEqual(getPagesToExtractArray("1, 1, 1", 5), [0], "Duplicate singles failed");

    // Out of bounds
    assert.deepStrictEqual(getPagesToExtractArray("1-10", 5), [0, 1, 2, 3, 4], "Upper out of bounds range failed");
    assert.deepStrictEqual(getPagesToExtractArray("-5", 5), [], "Lower out of bounds (negative) failed");
    assert.deepStrictEqual(getPagesToExtractArray("0", 5), [], "Page 0 failed");
    assert.deepStrictEqual(getPagesToExtractArray("6", 5), [], "Page > max failed");

    // Malformed strings
    assert.deepStrictEqual(getPagesToExtractArray("abc", 5), [], "Alphabetic string failed");
    assert.deepStrictEqual(getPagesToExtractArray("1-abc", 5), [], "Half malformed range failed");
    assert.deepStrictEqual(getPagesToExtractArray("1-3, abc", 5), [0, 1, 2], "Mixed valid and malformed failed");

    console.log("getPagesToExtract tests passed.");

} catch (error) {
    console.error("Test failed:", error.message);
    process.exit(1);
}

// The worker cannot run under Node, so check its source for the message shapes the page expects
try {
    const workerContent = fs.readFileSync(__dirname + '/worker.js', 'utf8');

    assert.ok(workerContent.includes("pdf-lib.min.js"), "Worker should import pdf-lib");
    assert.ok(workerContent.includes("jszip.min.js"), "Worker should import jszip");

    assert.ok(workerContent.includes("self.postMessage"), "Worker must use postMessage to communicate");
    assert.ok(workerContent.includes("type: 'progress'"), "Worker must send progress messages");
    assert.ok(workerContent.includes("type: 'done'"), "Worker must send done messages");
    assert.ok(workerContent.includes("const zipBlob = await zip.generateAsync"), "Worker must generate zip asynchronously");

    console.log("Worker static analysis passed.");

} catch (error) {
    console.error("Worker test failed:", error.message);
    process.exit(1);
}

// A file that is not a PDF is turned away with a toast

const dom = new JSDOM(htmlContent, {
    runScripts: 'dangerously',
    beforeParse(window) {
        // layout.js is not loaded here, so its helpers are stubbed
        window.setupDropZone = function() {};

        window.showToast = function(msg, type) {
            window.__toastMsg = msg;
            window.__toastType = type;
        };
    }
});

setTimeout(() => {
    try {
        console.log("Running Invalid PDF Test...");
        const window = dom.window;

        window.eval(`
            const file = new window.File([''], 'test.txt', { type: 'text/plain' });
            handleFileSelection([file]);
        `);

        assert.strictEqual(window.__toastMsg, 'That is not a PDF.', 'Did not get correct toast message');
        assert.strictEqual(window.__toastType, 'error', 'Did not get error toast type');

        console.log("Invalid PDF test passed.");
        console.log("All tests passed against index.html and worker.js.");
        process.exit(0);
    } catch(e) {
        console.error("Invalid PDF Test failed:", e.message);
        process.exit(1);
    }
}, 500);
