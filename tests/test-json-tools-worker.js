/**
 * JSON Workbench worker — unit tests for the bits we scoped out.
 *
 * The QA pass turned up a couple of quiet data losses that all say only
 * "Valid JSON" to the user. This exercises the scanner that catches them,
 * and the CSV export path that used to double-escape nested cells to four
 * quotes per quote.
 *
 * The worker imports json5 through importScripts and listens on `self`; both
 * are guarded so the file can also be required from Node.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const Module = require('module');

// json5 is pulled in via importScripts on the browser side; provide a shim so
// the worker's `JSON5.parse` still resolves when required from Node.
const JSON5_SRC = fs.readFileSync(path.join(__dirname, '..', 'assets', 'vendor', 'json5.min.js'), 'utf8');
const json5Sandbox = { module: { exports: {} }, exports: {}, globalThis: {} };
// json5 ships as UMD; run it under a scratch context to grab the export.
(new Function('module', 'exports', JSON5_SRC))(json5Sandbox.module, json5Sandbox.exports);
global.JSON5 = json5Sandbox.module.exports || json5Sandbox.exports;

const { scanForLossyBits } = require('../tools/json-tools/worker.js');

function assertHas(list, needle, label) {
    const hit = list.some(w => w.includes(needle));
    assert.ok(hit, `${label} — expected a warning containing "${needle}", got: ${JSON.stringify(list)}`);
}
function assertMissing(list, needle, label) {
    const hit = list.some(w => w.includes(needle));
    assert.ok(!hit, `${label} — did not expect a warning about "${needle}", got: ${JSON.stringify(list)}`);
}

console.log('Running JSON Workbench worker tests...');

// 1. Precision loss
{
    const w = scanForLossyBits('{"n": 9007199254740993}');
    assertHas(w, 'lose precision', 'precision loss on 2^53+1');
}
{
    const w = scanForLossyBits('{"n": 12345678901234567890}');
    assertHas(w, 'lose precision', 'precision loss on a 20-digit integer');
}
{
    const w = scanForLossyBits('{"n": 42}');
    assertMissing(w, 'precision', 'no precision warning on 42');
}

// 2. Out-of-range numbers
{
    const w = scanForLossyBits('{"n": 1e400}');
    assertHas(w, 'out of range', '1e400 became null');
}

// 3. Duplicate keys
{
    const w = scanForLossyBits('{"a": 1, "a": 2}');
    assertHas(w, 'Duplicate keys', 'duplicate keys detected');
}
{
    const w = scanForLossyBits('{"a": 1, "b": 2}');
    assertMissing(w, 'Duplicate keys', 'no duplicate warning on unique keys');
}
{
    // Nested — same key in inner and outer must not count as a duplicate.
    const w = scanForLossyBits('{"a": {"a": 1}, "b": 2}');
    assertMissing(w, 'Duplicate keys', 'inner and outer key with the same name should not count');
}
{
    // Array values with the same string in them must not be tallied as
    // duplicate keys of the enclosing object.
    const w = scanForLossyBits('{"arr": ["y", "y"], "y": 1}');
    assertMissing(w, 'Duplicate keys', 'strings inside an array must not be treated as object keys');
}

// 4. -0
{
    const w = scanForLossyBits('{"n": -0}');
    assertHas(w, '-0', '-0 collapsed to 0');
}

// 5. NaN / Infinity via JSON5
{
    const w = scanForLossyBits('{"n": NaN}');
    assertHas(w, 'NaN', 'NaN detected');
}
{
    const w = scanForLossyBits('{"n": Infinity}');
    assertHas(w, 'Infinity', 'Infinity detected');
}

// 6. CSV double-escape regression.
//
// The bug: nested cells came out with quadrupled quotes because the worker
// doubled them in the JSON.stringify branch AND doubled them again in the
// generic quoting step. This checks the fix end-to-end by driving the worker
// through its own message handler.
{
    // Build a minimal self stand-in and drive the message handler.
    let responses = [];
    global.self = {
        _handler: null,
        addEventListener(_ev, fn) { this._handler = fn; },
        postMessage(m) { responses.push(m); }
    };
    // Reload the worker so its addEventListener wires into our stand-in.
    delete require.cache[require.resolve('../tools/json-tools/worker.js')];
    require('../tools/json-tools/worker.js');
    global.self._handler({ data: {
        action: 'process',
        raw: '[{"a":1,"b":{"c":2}}]',
        indent: '2',
        unescape: false,
        mode: 'csv'
    }});
    const out = responses[0];
    assert.ok(out.success, 'CSV export succeeded');
    // Expected cell: "{""c"":2}"  — one level of doubling, wrapped in quotes.
    const lines = out.resultText.split('\n');
    assert.strictEqual(lines[0], 'a,b', 'header line');
    assert.strictEqual(lines[1], '1,"{""c"":2}"',
        `nested cell should be doubled once, not four times — got ${JSON.stringify(lines[1])}`);
    // And explicitly rule out the quadrupled form.
    assert.ok(!lines[1].includes('""""'),
        `nested cell must not contain """" (quadrupled quotes) — got ${JSON.stringify(lines[1])}`);
}

console.log('PASS: JSON Workbench worker tests');
