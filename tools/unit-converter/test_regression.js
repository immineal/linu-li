const fs = require('fs');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const path = require('path');

const htmlPath = path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// fetch and localStorage are replaced before the page script runs.
const mockLocalStorage = {};

const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: 'http://localhost'
});
const window = dom.window;

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

window.localStorage = {
  getItem: key => mockLocalStorage[key] || null,
  setItem: (key, value) => mockLocalStorage[key] = String(value),
  removeItem: key => delete mockLocalStorage[key]
};

// The page script keeps these in its own scope; the tests need them on window.
// Pick by content, not by index: the head grew two more <script src="…">
// tags (i18n.js and layout.js) when the language switch was added, and the
// old scriptElements[1] pointed at layout.js after that.
const scriptElements = dom.window.document.querySelectorAll('script');
const inlineScriptEl = Array.from(scriptElements).find((el) => {
    const src = el.getAttribute('src');
    return !src && /factors/.test(el.textContent);
});
if (!inlineScriptEl) throw new Error('unit-converter: could not find its inline setup script');
const inlineScript = inlineScriptEl.textContent;
const evalCode = `
${inlineScript}
window.factors = factors;
window.setCategory = setCategory;
window.fetchExchangeRates = fetchExchangeRates;
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
        console.log('ok   ' + message);
    } else {
        console.error('FAIL ' + message + ' (Expected: ~' + expected + ', Actual: ' + actual + ')');
        passed = false;
    }
}

function assertEqual(actual, expected, message) {
    if (String(actual) !== String(expected)) {
        console.error(`FAIL ${message} (Expected: ${expected}, Actual: ${actual})`);
        passed = false;
    } else {
        console.log(`ok   ${message}`);
    }
}

// Temperatures stop at absolute zero — output side. The source field is
// clamped only on blur/change; while typing, "-300" stays "-300" so the user
// can finish the number.
window.setCategory('temp');
unitFrom.value = 'Celsius (°C)';
unitTo.value = 'Fahrenheit (°F)';

inputFrom.value = '-300';
inputFrom.dispatchEvent(new window.Event('input'));
assertEqual(inputTo.value, '-459.67', 'Absolute zero clamping C to F (-300C -> -459.67F)');
assertEqual(inputFrom.value, '-300', 'Input is left alone while typing');

inputFrom.dispatchEvent(new window.Event('change'));
assertEqual(inputFrom.value, '-273.15', 'Input clamps to -273.15C on change');

unitFrom.value = 'Celsius (°C)';
unitTo.value = 'Kelvin (K)';

inputFrom.value = '-300';
inputFrom.dispatchEvent(new window.Event('input'));
assertEqual(inputTo.value, '0', 'Absolute zero clamping (-300C -> 0K)');
assertEqual(inputFrom.value, '-300', 'Input is left alone while typing (Kelvin)');
inputFrom.dispatchEvent(new window.Event('change'));
assertEqual(inputFrom.value, '-273.15', 'Input clamps to -273.15C on change (Kelvin)');

// Lengths, weights, speeds and sizes cannot go below zero — output side.
// Source field is left alone until the user commits.
window.setCategory('length');
inputFrom.value = '-10';
inputFrom.dispatchEvent(new window.Event('input'));
assertEqual(inputTo.value, '0', 'Negative length converts to 0');
assertEqual(inputFrom.value, '-10', 'Negative length input is left alone while typing');
inputFrom.dispatchEvent(new window.Event('change'));
assertEqual(inputFrom.value, '0', 'Negative length input clamps on change');

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

// Currency: built-in rates first, fetched ones after.
window.setCategory('currency');
unitFrom.value = 'USD';
unitTo.value = 'EUR';
inputFrom.value = '100';
inputFrom.dispatchEvent(new window.Event('input'));
assertEqual(inputTo.value, '90', 'Fallback default rates working (100 USD -> 90 EUR)');

// The page only fetches when asked, so ask.
window.fetchExchangeRates();

setTimeout(() => {
    inputFrom.dispatchEvent(new window.Event('input'));
    assertEqual(inputTo.value, '85', 'Async fetch exchange rates update correctly (100 USD -> 85 EUR)');

    // Typed queries such as "5 km in miles".
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

    const resetState = () => {
        window.setCategory('length');
        inputFrom.value = '1';
        unitFrom.value = 'm';
        unitTo.value = 'ft';
    };

    resetState();
    nlpInput.value = 'just some random text';
    nlpInput.dispatchEvent(new window.Event('input'));
    assertEqual(inputFrom.value, '1', 'NLP ignores random text');

    resetState();
    nlpInput.value = '';
    nlpInput.dispatchEvent(new window.Event('input'));
    assertEqual(inputFrom.value, '1', 'NLP ignores empty string');

    resetState();
    nlpInput.value = '5 KM To MILES';
    nlpInput.dispatchEvent(new window.Event('input'));
    assertEqual(inputFrom.value, '5', 'NLP handles case insensitivity (value)');
    assertEqual(unitFrom.value, 'km', 'NLP handles case insensitivity (unitFrom)');
    assertEqual(unitTo.value, 'mi', 'NLP handles case insensitivity (unitTo)');

    resetState();
    nlpInput.value = '5 km to kg';
    nlpInput.dispatchEvent(new window.Event('input'));
    assertEqual(inputFrom.value, '1', 'NLP ignores mismatched categories (km to kg)');
    assertEqual(unitFrom.value, 'm', 'NLP maintains state on mismatch');

    resetState();
    nlpInput.value = '5 km to foo';
    nlpInput.dispatchEvent(new window.Event('input'));
    assertEqual(inputFrom.value, '1', 'NLP ignores unrecognized units (foo)');

    resetState();
    nlpInput.value = '0.5 meters per second in mph';
    nlpInput.dispatchEvent(new window.Event('input'));
    assertEqual(inputFrom.value, '0.5', 'NLP parses synonyms and floats');
    assertEqual(unitFrom.value, 'm/s', 'NLP sets correct synonym unit (m/s)');
    assertEqual(unitTo.value, 'mph', 'NLP sets correct synonym unit (mph)');

    // Very small and very large results.
    window.setCategory('data');
    unitFrom.value = 'B';
    unitTo.value = 'TiB';
    inputFrom.value = '1';
    inputFrom.dispatchEvent(new window.Event('input'));
    // 1 / 1024^4 in scientific notation, six sig figs after the point.
    assertEqual(inputTo.value, '9.094947e-13', 'Extreme small value (1 B -> TiB) shows in scientific notation');

    // Round-trip: 1024 B is exactly 1 KiB, 1 KiB is exactly 1024 B.
    unitFrom.value = 'B';
    unitTo.value = 'KiB';
    inputFrom.value = '1024';
    inputFrom.dispatchEvent(new window.Event('input'));
    assertEqual(inputTo.value, '1', 'Binary data: 1024 B -> KiB is exactly 1');

    unitFrom.value = 'KiB';
    unitTo.value = 'B';
    inputFrom.value = '1';
    inputFrom.dispatchEvent(new window.Event('input'));
    assertEqual(inputTo.value, '1024', 'Binary data: 1 KiB -> B is exactly 1024');

    // Improved physical factors: kg -> lb, km/h -> mph.
    window.setCategory('weight');
    unitFrom.value = 'kg';
    unitTo.value = 'lb';
    inputFrom.value = '1';
    inputFrom.dispatchEvent(new window.Event('input'));
    assertApprox(parseFloat(inputTo.value), 2.20462262185, 'kg -> lb uses the international pound', 1e-8);

    window.setCategory('speed');
    unitFrom.value = 'km/h';
    unitTo.value = 'mph';
    inputFrom.value = '100';
    inputFrom.dispatchEvent(new window.Event('input'));
    assertApprox(parseFloat(inputTo.value), 62.1371192237, '100 km/h -> mph uses exact factors', 1e-6);

    window.setCategory('length');
    unitFrom.value = 'm';
    unitTo.value = 'mm';
    inputFrom.value = '100000000'; // 1e8 m -> 1e11 mm
    inputFrom.dispatchEvent(new window.Event('input'));
    assertEqual(inputTo.value, '100000000000', 'Extreme large value formats correctly');

    // Quick-convert now handles temperature, and stays tolerant of shapes
    // like "100km" (no space), "1,5" (comma decimal), "50 mph in kmh", and
    // "convert … please" framing.
    window.setCategory('length');
    inputFrom.value = '1'; unitFrom.value = 'm'; unitTo.value = 'ft';

    nlpInput.value = '20 c to f';
    nlpInput.dispatchEvent(new window.Event('input'));
    assertEqual(unitFrom.value, 'Celsius (°C)', 'NLP handles temperature (C to F: source)');
    assertEqual(unitTo.value, 'Fahrenheit (°F)', 'NLP handles temperature (C to F: target)');
    assertEqual(inputTo.value, '68', 'NLP converts 20 C to 68 F');

    nlpInput.value = '100km to miles';
    nlpInput.dispatchEvent(new window.Event('input'));
    assertEqual(unitFrom.value, 'km', 'NLP handles "100km" with no space');
    assertApprox(parseFloat(inputTo.value), 62.1371192237, 'NLP converts 100 km to miles', 1e-6);

    nlpInput.value = '1,5 km to miles';
    nlpInput.dispatchEvent(new window.Event('input'));
    assertApprox(parseFloat(inputFrom.value), 1.5, 'NLP accepts comma decimal (1,5)', 1e-9);

    nlpInput.value = 'convert 100 km to miles please';
    nlpInput.dispatchEvent(new window.Event('input'));
    assertEqual(unitFrom.value, 'km', 'NLP handles "convert … please" framing');

    nlpInput.value = '5kg in pounds';
    nlpInput.dispatchEvent(new window.Event('input'));
    assertEqual(unitFrom.value, 'kg', 'NLP handles "5kg" with no space');
    assertEqual(unitTo.value, 'lb', 'NLP handles "pounds" synonym');

    nlpInput.value = '50 mph in kmh';
    nlpInput.dispatchEvent(new window.Event('input'));
    assertEqual(unitTo.value, 'km/h', 'NLP handles "kmh" synonym');

    // A parse that fails wipes the stale result rather than leaving it up.
    window.setCategory('length');
    inputFrom.value = '1'; unitFrom.value = 'm'; unitTo.value = 'ft';
    inputFrom.dispatchEvent(new window.Event('input'));
    const notice = window.document.getElementById('nlpNotUnderstood');
    nlpInput.value = '5 km ';
    nlpInput.dispatchEvent(new window.Event('input'));
    assertEqual(notice.style.display, 'block', 'A partial query shows the "not understood" notice');
    assertEqual(inputTo.value, '', 'A partial query drops the stale conversion');

    if (!passed) {
        process.exit(1);
    } else {
        console.log('\nAll regression tests passed.');
    }
}, 500);
