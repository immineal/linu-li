const fs = require('fs');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const assert = require('assert');

const html = fs.readFileSync('tools/pw-generator/index.html', 'utf8');

const dom = new JSDOM(html, { runScripts: "dangerously" });

// Mock bip39Words before the script runs in the DOM if needed,
// but since runScripts is dangerously, we can just inject it or rely on the script tag.
// The script tag src="words.js" won't automatically load the file from disk in JSDOM
// unless we supply resources: "usable" or inject it. Let's inject it.
const wordsJs = fs.readFileSync('tools/pw-generator/words.js', 'utf8');
const scriptEl = dom.window.document.createElement("script");
scriptEl.textContent = wordsJs;
dom.window.document.head.appendChild(scriptEl);

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

    // Test 6: Fallback error when Crypto unavailable
    const originalCrypto = window.crypto;
    Object.defineProperty(window, 'crypto', { value: undefined, configurable: true });
    lengthRange.value = "10";
    generateBtn.click();
    assert.strictEqual(output.textContent, "Cryptographic randomness unavailable.", "Failed: should show error when crypto unavailable");
    Object.defineProperty(window, 'crypto', { value: originalCrypto, configurable: true }); // Restore for further tests

    // Test 7: Valid copy
    generateBtn.click(); // generate a valid password again
    copyBtn.click();
    assert.strictEqual(clipboardText, output.textContent, "Failed: should copy valid password");

    // Test 8: Passphrase mode
    const modePassphrase = document.getElementById('modePassphrase');
    const wordsRange = document.getElementById('wordsRange');
    const separatorSelect = document.getElementById('separatorSelect');

    modePassphrase.checked = true;
    modePassphrase.dispatchEvent(new window.Event('change'));

    wordsRange.removeAttribute('min');
    wordsRange.removeAttribute('max');

    wordsRange.value = "4";
    separatorSelect.value = "-";
    generateBtn.click();

    const passphraseParts = output.textContent.split("-");
    assert.strictEqual(passphraseParts.length, 4, "Failed: passphrase should have 4 words separated by hyphen");
    // Since `bip39Words` was defined with `const` in `words.js`, it's not on the `window` object in the global scope.
    // We can evaluate it directly or verify the words are alphanumeric.
    const wordsRaw = window.eval('bip39Words');
    assert.ok(passphraseParts.every(word => wordsRaw.includes(word)), "Failed: all parts should be valid words");

    // Test 9: Passphrase mode invalid word count
    wordsRange.value = "0";
    generateBtn.click();
    assert.strictEqual(output.textContent, "Word count must be at least 1.", "Failed: should show error for 0 words");

    console.log("All tests passed!");
}, 100);
