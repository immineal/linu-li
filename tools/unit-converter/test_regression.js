const fs = require('fs');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const path = require('path');

const htmlPath = path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// Mock fetch and localStorage before running scripts
const mockLocalStorage = {};

const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: 'http://localhost'
});
const window = dom.window;

// Define a safe mock for fetch
window.fetch = async (url) => {
    if (url.includes('er-api.com')) {
        return {
            json: async () => ({ rates: { EUR: 0.85, GBP: 0.75 } })
        };
    } else if (url.includes('coincap.io')) {
        return {
            json: async () => ({ data: [{ symbol: 'BTC', priceUsd: '50000' }] })
        };
    }
    return { json: async () => ({}) };
};

// Define mock for localStorage
window.localStorage = {
  getItem: key => mockLocalStorage[key] || null,
  setItem: (key, value) => mockLocalStorage[key] = String(value),
  removeItem: key => delete mockLocalStorage[key]
};

// Extract inline script and expose internal factors
const scriptElements = dom.window.document.querySelectorAll('script');
const inlineScript = scriptElements[1].textContent;
const evalCode = `
${inlineScript}
window.factors = factors;
window.setCategory = setCategory;
`;
dom.window.eval(evalCode);

const inputFrom = window.document.getElementById('inputFrom');
const nlpInput = window.document.getElementById('nlpInput');
const inputTo = window.document.getElementById('inputTo');
const unitFrom = window.document.getElementById('unitFrom');
const unitTo = window.document.getElementById('unitTo');

let passed = true;


function assertApprox(actual, expected, message, tolerance) {
    tolerance = tolerance || 1e-6;
    if (Math.abs(actual - expected) <= tolerance) {
        console.log('✅ PASS: ' + message);
    } else {
        console.error('❌ FAIL: ' + message + ' (Expected: ~' + expected + ', Actual: ' + actual + ')');
        passed = false;
    }
}

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

// 3. Test Currency and Local Caching Layers
window.setCategory('currency');
unitFrom.value = 'USD';
unitTo.value = 'EUR';
inputFrom.value = '100';
inputFrom.dispatchEvent(new window.Event('input'));
assertEqual(inputTo.value, '90', 'Fallback default rates working (100 USD -> 90 EUR)');

// Wait for async fetch in script to complete
setTimeout(() => {
    inputFrom.dispatchEvent(new window.Event('input'));
    assertEqual(inputTo.value, '85', 'Async fetch exchange rates update correctly (100 USD -> 85 EUR)');

    // Test NLP logic
    nlpInput.value = '5 km in miles';
    nlpInput.dispatchEvent(new window.Event('input'));
    assertEqual(inputFrom.value, '5', 'NLP correctly sets inputFrom value');
    assertEqual(unitFrom.value, 'km', 'NLP correctly sets unitFrom');
    assertEqual(unitTo.value, 'mi', 'NLP correctly sets unitTo');
    assertApprox(parseFloat(inputTo.value), 3.106856, 'NLP automatically triggers conversion', 0.0001);

    nlpInput.value = '100.5 USD in EUR';
    nlpInput.dispatchEvent(new window.Event('input'));
    assertEqual(inputFrom.value, '100.5', 'NLP sets inputFrom value for currency');
    assertEqual(unitFrom.value, 'USD', 'NLP sets unitFrom for currency');
    assertEqual(unitTo.value, 'EUR', 'NLP sets unitTo for currency');
    assertEqual(inputTo.value, '85.425', 'NLP converts currency using newly fetched rates');

    // 4. Test Extreme Formatting
    window.setCategory('data');
unitFrom.value = 'B';
unitTo.value = 'TB';
inputFrom.value = '1';
inputFrom.dispatchEvent(new window.Event('input'));
assertEqual(inputTo.value, '0', 'Extreme small value (1B -> TB) formats correctly (clamped to 0 by formatter)');

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
}, 500);
