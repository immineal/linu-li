const fs = require('fs');
const assert = require('assert');

// Read the actual index.html
const htmlContent = fs.readFileSync(__dirname + '/index.html', 'utf8');

// Use a simple regex to extract the function logic from the HTML file
const functionMatch = htmlContent.match(/function getPagesToExtract[\s\S]*?return pages;\n\s*\}/);

if (!functionMatch) {
    console.error("Could not find getPagesToExtract function in index.html");
    process.exit(1);
}

// Evaluate the extracted function into the current context
eval(functionMatch[0]);

// Ensure the function is defined
if (typeof getPagesToExtract !== 'function') {
    console.error("Failed to load getPagesToExtract function");
    process.exit(1);
}

function getPagesToExtractArray(rangeStr, maxPages) {
    return Array.from(getPagesToExtract(rangeStr, maxPages)).sort((a, b) => a - b);
}

// Test cases
try {
    // 1. Empty range should return all pages
    assert.deepStrictEqual(getPagesToExtractArray("", 5), [0, 1, 2, 3, 4], "Empty range failed");
    assert.deepStrictEqual(getPagesToExtractArray("   ", 5), [0, 1, 2, 3, 4], "Whitespace range failed");

    // 2. Valid single pages
    assert.deepStrictEqual(getPagesToExtractArray("1, 3, 5", 5), [0, 2, 4], "Single pages failed");
    assert.deepStrictEqual(getPagesToExtractArray(" 1 , 3 , 5 ", 5), [0, 2, 4], "Single pages with whitespace failed");

    // 3. Valid ranges
    assert.deepStrictEqual(getPagesToExtractArray("1-3", 5), [0, 1, 2], "Simple range failed");
    assert.deepStrictEqual(getPagesToExtractArray("3-1", 5), [0, 1, 2], "Reverse range failed");
    assert.deepStrictEqual(getPagesToExtractArray("1-3, 5", 5), [0, 1, 2, 4], "Mixed range and single failed");

    // 4. Overlapping ranges
    assert.deepStrictEqual(getPagesToExtractArray("1-4, 3-5", 5), [0, 1, 2, 3, 4], "Overlapping ranges failed");
    assert.deepStrictEqual(getPagesToExtractArray("1-2, 1-2", 5), [0, 1], "Duplicate ranges failed");
    assert.deepStrictEqual(getPagesToExtractArray("1, 1, 1", 5), [0], "Duplicate singles failed");

    // 5. Out of bounds
    assert.deepStrictEqual(getPagesToExtractArray("1-10", 5), [0, 1, 2, 3, 4], "Upper out of bounds range failed");
    assert.deepStrictEqual(getPagesToExtractArray("-5", 5), [], "Lower out of bounds (negative) failed");
    assert.deepStrictEqual(getPagesToExtractArray("0", 5), [], "Page 0 failed");
    assert.deepStrictEqual(getPagesToExtractArray("6", 5), [], "Page > max failed");

    // 6. Malformed strings
    assert.deepStrictEqual(getPagesToExtractArray("abc", 5), [], "Alphabetic string failed");
    assert.deepStrictEqual(getPagesToExtractArray("1-abc", 5), [], "Half malformed range failed");
    assert.deepStrictEqual(getPagesToExtractArray("1-3, abc", 5), [0, 1, 2], "Mixed valid and malformed failed");

    console.log("getPagesToExtract tests passed!");

} catch (error) {
    console.error("Test failed:", error.message);
    process.exit(1);
}

// ---------------------------------------------------------
// Test Worker Message Construction (Static Check)
// ---------------------------------------------------------
try {
    const workerContent = fs.readFileSync(__dirname + '/worker.js', 'utf8');

    // Ensure worker imports the correct libraries
    assert.ok(workerContent.includes("pdf-lib.min.js"), "Worker should import pdf-lib");
    assert.ok(workerContent.includes("jszip.min.js"), "Worker should import jszip");

    // Ensure worker handles postMessage properly
    assert.ok(workerContent.includes("self.postMessage"), "Worker must use postMessage to communicate");
    assert.ok(workerContent.includes("type: 'progress'"), "Worker must send progress messages");
    assert.ok(workerContent.includes("type: 'done'"), "Worker must send done messages");
    assert.ok(workerContent.includes("const zipBlob = await zip.generateAsync"), "Worker must generate zip asynchronously");

    console.log("Worker static analysis passed!");

} catch (error) {
    console.error("Worker test failed:", error.message);
    process.exit(1);
}

console.log("All tests passed dynamically against index.html & worker.js!");
