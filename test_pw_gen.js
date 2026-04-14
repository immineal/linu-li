const fs = require('fs');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const assert = require('assert');

const html = fs.readFileSync('tools/pw-generator/index.html', 'utf8');

const dom = new JSDOM(html, { runScripts: "dangerously" });

setTimeout(() => {
    const window = dom.window;
    const document = window.document;

    // Polyfill crypto and copyToClipboard
    const crypto = require('crypto');
    window.crypto = {
        getRandomValues: function(buffer) {
            return crypto.webcrypto.getRandomValues(buffer);
        }
    };

    let clipboardText = null;
    window.copyToClipboard = (text) => {
        clipboardText = text;
    };

    const generateBtn = document.getElementById('generateBtn');
    const lengthRange = document.getElementById('lengthRange');
    const copyBtn = document.getElementById('copyBtn');
    const output = document.getElementById('passwordOutput');

    lengthRange.removeAttribute('min');
    lengthRange.removeAttribute('max');

    console.log("Running deterministic regression tests...");

    // Test 1: Length <= 0
    lengthRange.value = "0";
    generateBtn.click();
    assert.strictEqual(output.textContent, "Length must be greater than 0.", "Failed: length 0 should show error");

    lengthRange.value = "-5";
    generateBtn.click();
    assert.strictEqual(output.textContent, "Length must be greater than 0.", "Failed: length -5 should show error");

    // Test 2: Copy error message should fail
    copyBtn.click();
    assert.strictEqual(clipboardText, null, "Failed: should not copy error message");

    // Test 3: All charsets disabled
    lengthRange.value = "16";
    document.getElementById('chkUppercase').checked = false;
    document.getElementById('chkLowercase').checked = false;
    document.getElementById('chkNumbers').checked = false;
    document.getElementById('chkSymbols').checked = false;
    generateBtn.click();
    assert.strictEqual(output.textContent, "Please select at least one option.", "Failed: no charsets should show error");

    // Test 4: Copy unselected message should fail
    copyBtn.click();
    assert.strictEqual(clipboardText, null, "Failed: should not copy unselected message");

    // Test 5: Extremely long length (> 2048) should cap at 2048
    document.getElementById('chkUppercase').checked = true;
    document.getElementById('chkLowercase').checked = true;
    document.getElementById('chkNumbers').checked = true;
    document.getElementById('chkSymbols').checked = true;
    lengthRange.type = 'number'; // Allow setting > max
    lengthRange.value = "10000";
    generateBtn.click();
    assert.strictEqual(output.textContent.length, 2048, "Failed: length should be capped at 2048");

    // Test 6: Math.random fallback (Crypto unavailable)
    window.crypto = undefined;
    lengthRange.value = "10";
    generateBtn.click();
    assert.strictEqual(output.textContent.length, 10, "Failed: Math.random fallback failed");

    // Test 7: Valid copy
    copyBtn.click();
    assert.strictEqual(clipboardText, output.textContent, "Failed: should copy valid password");

    console.log("All tests passed!");
}, 100);
