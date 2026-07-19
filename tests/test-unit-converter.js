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

function testConvertTemp(val, from, to, expected, description) {
    const result = window.eval(`convertTemp(${val}, "${from}", "${to}")`);
    try {
        assert.strictEqual(result, expected);
        console.log(`✅ Passed: ${description} (${val} ${from} -> ${expected} ${to})`);
    } catch (e) {
        console.error(`❌ Failed: ${description}`);
        console.error(`   Input: ${val} ${from} to ${to}`);
        console.error(`   Expected: ${expected}`);
        console.error(`   Actual: ${result}`);
        process.exit(1);
    }
}

console.log("\nRunning Unit Converter convertTemp tests...");

// Standard Conversions
testConvertTemp(0, "Celsius", "Fahrenheit", "32", "0°C to °F");
testConvertTemp(100, "Celsius", "Fahrenheit", "212", "100°C to °F");
testConvertTemp(0, "Celsius", "Kelvin", "273.15", "0°C to K");
testConvertTemp(32, "Fahrenheit", "Celsius", "0", "32°F to °C");
testConvertTemp(212, "Fahrenheit", "Celsius", "100", "212°F to °C");
testConvertTemp(273.15, "Kelvin", "Celsius", "0", "273.15K to °C");

// Edge Cases (-40 overlap)
testConvertTemp(-40, "Celsius", "Fahrenheit", "-40", "-40°C to °F");
testConvertTemp(-40, "Fahrenheit", "Celsius", "-40", "-40°F to °C");

// Absolute Zero Clamping
testConvertTemp(-300, "Celsius", "Celsius", "-273.15", "Below Absolute Zero (Celsius)");
testConvertTemp(-500, "Fahrenheit", "Celsius", "-273.15", "Below Absolute Zero (Fahrenheit to Celsius)");
testConvertTemp(-10, "Kelvin", "Celsius", "-273.15", "Below Absolute Zero (Kelvin to Celsius)");
testConvertTemp(-300, "Celsius", "Fahrenheit", "-459.67", "Below Absolute Zero (Celsius to Fahrenheit)");
testConvertTemp(-300, "Celsius", "Kelvin", "0", "Below Absolute Zero (Celsius to Kelvin)");

console.log("\nAll Unit Converter tests passed!");
process.exit(0);
