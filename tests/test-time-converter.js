const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const htmlPath = path.join(__dirname, '..', 'tools', 'time-converter', 'index.html');
let htmlContent = fs.readFileSync(htmlPath, 'utf8');

// Strip ALL scripts to prevent execution
htmlContent = htmlContent.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

const { window } = new JSDOM(htmlContent, {
    url: "http://localhost",
    runScripts: "outside-only"
});

const document = window.document;

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
    try {
        console.log("Testing BigInt formatting and format auto-detection...");

        // Setup mock for dayjs
        window.dayjs = function(val) {
            return {
                isValid: () => true,
                utc: () => ({ format: () => 'MOCK_UTC' }),
                format: () => 'MOCK_LOCAL',
                tz: () => ({ format: () => 'MOCK_ZONE' }),
                fromNow: () => 'MOCK_RELATIVE',
                unix: () => 123,
                valueOf: () => 123000
            };
        };
        window.dayjs.extend = () => {};
        window.dayjs.unix = window.dayjs;
        window.dayjs.utc = window.dayjs;
        window.dayjs.tz = { guess: () => 'UTC' };

        // Mock global functions from layout.js
        window.showToast = function() {};
        window.copyToClipboard = function() {};

        // Extract the JS from the original file
        let originalHtml = fs.readFileSync(htmlPath, 'utf8');
        let scripts = originalHtml.split('<script>');
        let mainScript = scripts[scripts.length - 1].split('</script>')[0];

        // Evaluate the main script manually
        window.eval(mainScript);

        // Dispatch DOMContentLoaded to trigger init
        document.dispatchEvent(new window.Event('DOMContentLoaded'));

        // Let event handlers attach
        await wait(100);

        // --- Test 1: Auto-detection seconds (<11 chars) ---
        const tsInput = document.getElementById('tsInput');
        const tsFormat = document.getElementById('tsFormat');
        const convertToDateBtn = document.getElementById('convertToDateBtn');
        const tsFormatFeedback = document.getElementById('tsFormatFeedback');

        tsInput.value = '1678886400';
        tsFormat.value = 'auto';
        convertToDateBtn.click();
        assert(tsFormatFeedback.textContent.includes('Seconds'), 'Should auto-detect Seconds');

        // --- Test 2: Auto-detection ms (13 chars) ---
        tsInput.value = '1678886400000';
        convertToDateBtn.click();
        assert(tsFormatFeedback.textContent.includes('Milliseconds'), 'Should auto-detect Milliseconds');

        // --- Test 3: Auto-detection us (16 chars) ---
        tsInput.value = '1678886400000000';
        convertToDateBtn.click();
        assert(tsFormatFeedback.textContent.includes('Microseconds'), 'Should auto-detect Microseconds');

        // --- Test 4: Auto-detection ns (19 chars) ---
        tsInput.value = '1678886400000000000';
        convertToDateBtn.click();
        assert(tsFormatFeedback.textContent.includes('Nanoseconds'), 'Should auto-detect Nanoseconds');

        // --- Test 5: Check dynamic import setup is intact ---
        assert(originalHtml.includes('import('), 'Dynamic import should be in the HTML');
        assert(originalHtml.includes('chrono-node'), 'Chrono-node reference should exist');

        console.log('✅ Time Converter specific logic tests passed!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Time Converter tests failed:', err);
        process.exit(1);
    }
})();
