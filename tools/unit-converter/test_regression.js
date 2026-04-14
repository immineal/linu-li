const fs = require('fs');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const path = require('path');

const htmlPath = path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const dom = new JSDOM(html, { runScripts: "dangerously" });
const window = dom.window;

const inputFrom = window.document.getElementById('inputFrom');
const inputTo = window.document.getElementById('inputTo');
const unitFrom = window.document.getElementById('unitFrom');
const unitTo = window.document.getElementById('unitTo');

let passed = true;

function assertEqual(actual, expected, message) {
    if (String(actual) !== String(expected)) {
        console.error(`❌ FAIL: ${message} (Expected: ${expected}, Actual: ${actual})`);
        passed = false;
    } else {
        console.log(`✅ PASS: ${message}`);
    }
}

// 1. Test Absolute Zero Logic
window.setCategory('temp');
unitFrom.value = 'Celsius (°C)';
unitTo.value = 'Fahrenheit (°F)';

inputFrom.value = '-300';
inputFrom.dispatchEvent(new window.Event('input'));
assertEqual(inputTo.value, '-459.67', 'Absolute zero clamping C to F (-300C -> -459.67F)');
assertEqual(inputFrom.value, '-273.15', 'Input clamps to -273.15C');

unitFrom.value = 'Celsius (°C)';
unitTo.value = 'Kelvin (K)';

inputFrom.value = '-300';
inputFrom.dispatchEvent(new window.Event('input'));
assertEqual(inputTo.value, '0', 'Absolute zero clamping (-300C -> 0K)');
assertEqual(inputFrom.value, '-273.15', 'Input clamps to -273.15C');

// 2. Test Non-Negative Unit Logic
window.setCategory('length');
inputFrom.value = '-10';
inputFrom.dispatchEvent(new window.Event('input'));
assertEqual(inputTo.value, '0', 'Negative length converts to 0');
assertEqual(inputFrom.value, '0', 'Negative length input clamps to 0');

window.setCategory('weight');
inputFrom.value = '-5';
inputFrom.dispatchEvent(new window.Event('input'));
assertEqual(inputTo.value, '0', 'Negative weight converts to 0');

window.setCategory('speed');
inputFrom.value = '-50';
inputFrom.dispatchEvent(new window.Event('input'));
assertEqual(inputTo.value, '0', 'Negative speed converts to 0');

window.setCategory('data');
inputFrom.value = '-100';
inputFrom.dispatchEvent(new window.Event('input'));
assertEqual(inputTo.value, '0', 'Negative data converts to 0');

// 3. Test Extreme Formatting
window.setCategory('data');
unitFrom.value = 'B';
unitTo.value = 'TB';
inputFrom.value = '1';
inputFrom.dispatchEvent(new window.Event('input'));
assertEqual(inputTo.value, '9.094947e-13', 'Extreme small value (1B -> TB) formats correctly');

window.setCategory('length');
unitFrom.value = 'm';
unitTo.value = 'mm';
inputFrom.value = '100000000'; // 1e8 m -> 1e11 mm
inputFrom.dispatchEvent(new window.Event('input'));
assertEqual(inputTo.value, '100000000000', 'Extreme large value formats correctly');

if (!passed) {
    process.exit(1);
} else {
    console.log('\nAll regression tests passed.');
}
