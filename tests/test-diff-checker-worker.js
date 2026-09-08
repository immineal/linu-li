const assert = require('assert');

// Mock importScripts for the worker
global.importScripts = () => {};

// Mock self for the worker
global.self = {
    onmessage: null,
    postMessage: null
};

// We need a dummy highlight.js mock for the test if it's not defined
global.hljs = {
    highlight: (code, options) => {
        if (options.language === 'error-lang') throw new Error("Mock highlight error");
        return { value: `<span class="mock-hl">${code}</span>` };
    }
};

const { formatCode } = require('../tools/diff-checker/worker.js');

console.log("Running Diff Checker worker formatCode tests...");

function testFormatCode(inputCode, inputLanguage, expectedOutput) {
    const result = formatCode(inputCode, inputLanguage);
    assert.strictEqual(result, expectedOutput, `Failed for input "${inputCode}" with language "${inputLanguage}". Expected "${expectedOutput}", got "${result}"`);
}

// 1. Empty/whitespace input
testFormatCode(null, 'plaintext', ' ');
testFormatCode('', 'plaintext', ' ');
testFormatCode('   ', 'plaintext', '   ');

// 2. Plaintext (no highlighting, simple escaping)
testFormatCode('<div>&</div>', 'plaintext', '&lt;div&gt;&amp;&lt;/div&gt;');

// 3. Highlighted code
testFormatCode('function test() {}', 'javascript', '<span class="mock-hl">function test() {}</span>');

// 4. Highlight error fallback to escaping
testFormatCode('<div>&</div>', 'error-lang', '&lt;div&gt;&amp;&lt;/div&gt;');

console.log("All formatCode tests passed!");
