const fs = require('fs');
const assert = require('assert');

// Read the actual index.html
const htmlContent = fs.readFileSync(__dirname + '/index.html', 'utf8');

// Use a simple regex to extract the function logic from the HTML file
const functionMatch = htmlContent.match(/function getPagesToExtract[\s\S]*?return Array\.from\(pages\)\.sort\(\(a, b\) => a - b\);\n\s*\}/);

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

// Test cases
try {
    // 1. Empty range should return all pages
    assert.deepStrictEqual(getPagesToExtract("", 5), [0, 1, 2, 3, 4], "Empty range failed");
    assert.deepStrictEqual(getPagesToExtract("   ", 5), [0, 1, 2, 3, 4], "Whitespace range failed");

    // 2. Valid single pages
    assert.deepStrictEqual(getPagesToExtract("1, 3, 5", 5), [0, 2, 4], "Single pages failed");
    assert.deepStrictEqual(getPagesToExtract(" 1 , 3 , 5 ", 5), [0, 2, 4], "Single pages with whitespace failed");

    // 3. Valid ranges
    assert.deepStrictEqual(getPagesToExtract("1-3", 5), [0, 1, 2], "Simple range failed");
    assert.deepStrictEqual(getPagesToExtract("3-1", 5), [0, 1, 2], "Reverse range failed");
    assert.deepStrictEqual(getPagesToExtract("1-3, 5", 5), [0, 1, 2, 4], "Mixed range and single failed");

    // 4. Overlapping ranges
    assert.deepStrictEqual(getPagesToExtract("1-4, 3-5", 5), [0, 1, 2, 3, 4], "Overlapping ranges failed");
    assert.deepStrictEqual(getPagesToExtract("1-2, 1-2", 5), [0, 1], "Duplicate ranges failed");
    assert.deepStrictEqual(getPagesToExtract("1, 1, 1", 5), [0], "Duplicate singles failed");

    // 5. Out of bounds
    assert.deepStrictEqual(getPagesToExtract("1-10", 5), [0, 1, 2, 3, 4], "Upper out of bounds range failed");
    assert.deepStrictEqual(getPagesToExtract("-5", 5), [], "Lower out of bounds (negative) failed");
    assert.deepStrictEqual(getPagesToExtract("0", 5), [], "Page 0 failed");
    assert.deepStrictEqual(getPagesToExtract("6", 5), [], "Page > max failed");

    // 6. Malformed strings
    assert.deepStrictEqual(getPagesToExtract("abc", 5), [], "Alphabetic string failed");
    assert.deepStrictEqual(getPagesToExtract("1-abc", 5), [], "Half malformed range failed");
    assert.deepStrictEqual(getPagesToExtract("1-3, abc", 5), [0, 1, 2], "Mixed valid and malformed failed");

    console.log("All tests passed dynamically against index.html!");
} catch (error) {
    console.error("Test failed:", error.message);
    process.exit(1);
}
