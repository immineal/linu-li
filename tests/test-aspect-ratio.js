const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const htmlPath = path.join(__dirname, '..', 'tools', 'aspect-ratio', 'index.html');
let htmlContent = fs.readFileSync(htmlPath, 'utf8');

// Strip ALL scripts to prevent execution
htmlContent = htmlContent.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

const { window } = new JSDOM(htmlContent, {
    url: "http://localhost",
    runScripts: "outside-only"
});

let originalHtml = fs.readFileSync(htmlPath, 'utf8');
const scriptMatches = Array.from(originalHtml.matchAll(/<script>([\s\S]*?)<\/script>/g));
const mainScript = scriptMatches[scriptMatches.length - 1][1];

window.eval(mainScript);

function testGcd(a, b, expected, description) {
    const result = window.eval(`gcd(${a}, ${b})`);
    try {
        assert.strictEqual(result, expected);
        console.log(`✅ Passed: ${description} (gcd(${a}, ${b}) -> ${expected})`);
    } catch (e) {
        console.error(`❌ Failed: ${description}`);
        console.error(`   Input: ${a}, ${b}`);
        console.error(`   Expected: ${expected}`);
        console.error(`   Actual: ${result}`);
        process.exit(1);
    }
}

console.log("Running Aspect Ratio gcd tests...");

testGcd(48, 18, 6, "Normal numbers");
testGcd(1920, 1080, 120, "Common resolution");
testGcd(16, 9, 1, "Coprime numbers");
testGcd(7, 0, 7, "Zero as second argument");
testGcd(0, 7, 7, "Zero as first argument");
testGcd(0, 0, 0, "Both arguments zero");
testGcd(100, 100, 100, "Same numbers");

console.log("All Aspect Ratio tests passed!");
process.exit(0);
