const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const htmlPath = path.join(__dirname, '..', 'tools', 'unit-converter', 'index.html');
let htmlContent = fs.readFileSync(htmlPath, 'utf8');

// Strip ALL scripts to prevent execution
htmlContent = htmlContent.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

const { window } = new JSDOM(htmlContent, {
    url: "http://localhost",
    runScripts: "outside-only"
});

// Provide a mock fetch to avoid errors in the script
window.fetch = async () => ({
    json: async () => ({ rates: {}, data: [] })
});

let originalHtml = fs.readFileSync(htmlPath, 'utf8');
let scripts = originalHtml.split('<script>');
let mainScript = scripts[scripts.length - 1].split('</script>')[0];

window.eval(mainScript);

function testFormatNumber(input, expected, description) {
    const result = window.eval(`formatNumber(${input})`);
    try {
        assert.strictEqual(result, expected);
        console.log(`✅ Passed: ${description} (${input} -> ${expected})`);
    } catch (e) {
        console.error(`❌ Failed: ${description}`);
        console.error(`   Input: ${input}`);
        console.error(`   Expected: ${expected}`);
        console.error(`   Actual: ${result}`);
        process.exit(1);
    }
}

console.log("Running Unit Converter formatNumber tests...");

// Test cases
testFormatNumber(0, "0", "Zero");
testFormatNumber(0.000000000001, "0", "Very small positive number (< 1e-10)");
testFormatNumber(-0.000000000001, "0", "Very small negative number (> -1e-10)");
testFormatNumber(1000000, "1000000", "Large positive number (>= 1e6)");
testFormatNumber(1234567.89, "1234567.89", "Large positive number with decimals");
testFormatNumber(-1000000, "-1000000", "Large negative number (<= -1e6)");
testFormatNumber(1.23456789, "1.23456789", "Normal number rounding");
testFormatNumber(0.1 + 0.2, "0.3", "Floating point addition issue (0.1 + 0.2)");
testFormatNumber(-1.23456789, "-1.23456789", "Normal negative number rounding");

console.log("All Unit Converter tests passed!");
process.exit(0);
