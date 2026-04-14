const fs = require('fs');
const assert = require('assert');

console.log("Loading List Cleaner...");
const html = fs.readFileSync('tools/list-cleaner/index.html', 'utf-8');
const jsCode = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// Evaluate the JS code in a mock environment
let listInputValue = '';
let listOutputValue = '';
let inputCountText = '';
let outputCountText = '';
let prefixInputValue = '';
let suffixInputValue = '';
let triggerInputFn;

const listInput = {
    get value() { return listInputValue; },
    set value(val) { listInputValue = val; },
    addEventListener: (event, handler) => {
        if (event === 'input') {
            triggerInputFn = handler;
        }
    }
};

const listOutput = {
    get value() { return listOutputValue; },
    set value(val) { listOutputValue = val; },
    scrollIntoView: () => {}
};

const inputCount = {
    get textContent() { return inputCountText; },
    set textContent(val) { inputCountText = val; }
};

const outputCount = {
    get textContent() { return outputCountText; },
    set textContent(val) { outputCountText = val; }
};

const prefixInput = {
    get value() { return prefixInputValue; },
    set value(val) { prefixInputValue = val; }
};

const suffixInput = {
    get value() { return suffixInputValue; },
    set value(val) { suffixInputValue = val; }
};

const document = {
    getElementById: (id) => {
        if (id === 'listInput') return listInput;
        if (id === 'listOutput') return listOutput;
        if (id === 'inputCount') return inputCount;
        if (id === 'outputCount') return outputCount;
        if (id === 'prefixInput') return prefixInput;
        if (id === 'suffixInput') return suffixInput;
        return null;
    }
};

global.document = document;
global.window = {};

// We need to bypass the layout.js which is not loaded
global.copyToClipboard = () => {};

eval(jsCode);

async function runTests() {
    let testsPassed = 0;
    let testsFailed = 0;

    function runTest(name, testFn) {
        try {
            testFn();
            console.log(`✅ ${name}`);
            testsPassed++;
        } catch (e) {
            console.error(`❌ ${name}`);
            console.error(`   ${e.message}`);
            testsFailed++;
        }
    }

    // Helper for async timeout
    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    console.log("\nRunning Tests...");

    // Test 1: Empty state line count
    listInput.value = '';
    triggerInputFn();
    await wait(150); // Wait for debounce
    runTest("Empty state should report 0 lines", () => {
        assert.strictEqual(inputCount.textContent, '0 lines');
    });

    // Test 2: Output empty state line count
    listInput.value = '';
    processList('sortAZ');
    runTest("Processing empty state should report 0 output lines", () => {
        assert.strictEqual(outputCount.textContent, '0 lines');
    });

    // Test 3: Normal line count
    listInput.value = 'Line 1\nLine 2';
    triggerInputFn();
    await wait(150);
    runTest("Normal input should report correct line count", () => {
        assert.strictEqual(inputCount.textContent, '2 lines');
    });

    // Test 4: Enormous list doesn't freeze or timeout during line counting
    const hugeList = Array.from({length: 100000}, (_, i) => `Line ${i}`).join('\n');
    listInput.value = hugeList;
    const start = Date.now();
    triggerInputFn();
    await wait(150);
    const duration = Date.now() - start - 150; // Subtract debounce wait
    runTest("Enormous list line count should be fast (no freeze)", () => {
        assert.ok(duration < 200, `Took too long: ${duration}ms`);
        assert.strictEqual(inputCount.textContent, '100000 lines');
    });

    // Test 5: Case-insensitive deduplication
    listInput.value = 'apple\nApple\nbanana\nBanana';
    processList('dedupInsensitive');
    runTest("Case-insensitive deduplication removes mixed case duplicates", () => {
        assert.strictEqual(listOutput.value, 'apple\nbanana');
        assert.strictEqual(outputCount.textContent, '2 lines');
    });

    // Test 6: Standard deduplication
    listInput.value = 'apple\nApple\napple\nbanana';
    processList('dedup');
    runTest("Standard deduplication is case-sensitive", () => {
        assert.strictEqual(listOutput.value, 'apple\nApple\nbanana');
    });

    // Test 7: Remove empty lines
    listInput.value = 'a\n\n\nb\n\nc';
    processList('empty');
    runTest("Remove empty lines should eliminate consecutive blanks", () => {
        assert.strictEqual(listOutput.value, 'a\nb\nc');
    });

    console.log(`\nTests completed. Passed: ${testsPassed}, Failed: ${testsFailed}`);
    if (testsFailed > 0) {
        process.exit(1);
    }
}

runTests();
