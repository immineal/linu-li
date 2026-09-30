const fs = require('fs');
const assert = require('assert');

const htmlContent = fs.readFileSync(__dirname + '/index.html', 'utf8');

// The QA sweep flagged "nearly every dynamic string" as untranslated.
// This test guards the ones that used to leak English into German mode:
// pause/resume, toast messages, the natural-language feedback, and the
// auto-detect hint. If a future edit removes the T(en, de) wrapper we
// notice here instead of in production.

const expectedPairs = [
    ["Resume", "Weiter"],
    ["Enter a timestamp first", "Erst einen Zeitstempel eingeben"],
    ["A timestamp is a whole number", "Ein Zeitstempel ist eine ganze Zahl"],
    ["Seconds", "Sekunden"],
    ["Milliseconds", "Millisekunden"],
    ["Microseconds", "Mikrosekunden"],
    ["Nanoseconds", "Nanosekunden"],
    ["That timestamp is out of the range a date can show",
     "Dieser Zeitstempel liegt außerhalb dessen, was ein Datum zeigen kann"],
    ["Pick a date first", "Erst ein Datum wählen"],
    ["That is not a valid date", "Das ist kein gültiges Datum"],
    ["Type a date first", "Erst ein Datum tippen"],
    ["Found a date", "Datum gefunden"],
    ["No date found in that", "Darin steckt kein Datum"],
    ["Parse", "Auslesen"]
];

try {
    for (const [en, de] of expectedPairs) {
        const enEscaped = en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const deEscaped = de.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Cover ' " and template literal quotes
        const re = new RegExp(
            `T\\([\\s\\S]{0,3}${enEscaped}[\\s\\S]{0,3}\\s*,\\s*[\\s\\S]{0,3}${deEscaped}`
        );
        assert.ok(re.test(htmlContent),
            `Missing T() pair: "${en}" / "${de}"`);
    }
    console.log('All T(en, de) pairs present.');
} catch (err) {
    console.error('Test failed:', err.message);
    process.exit(1);
}

// The clock and relative-time strings must go through Intl, not dayjs.
// dayjs's format('dddd') only speaks English, and its relativeTime plugin
// only speaks English — so putting them back would silently re-break DE.
try {
    assert.ok(/new Intl\.DateTimeFormat/.test(htmlContent),
        'Intl.DateTimeFormat must be used for the live clock');
    assert.ok(/new Intl\.RelativeTimeFormat/.test(htmlContent),
        'Intl.RelativeTimeFormat must be used for the relative-time line');
    assert.ok(!/now\.format\(['"`]dddd/.test(htmlContent),
        'dayjs.format("dddd, ...") must not creep back — Intl only handles German');
    assert.ok(!/dayObj\.fromNow\(\)/.test(htmlContent),
        'dayjs.fromNow() must not creep back — Intl only handles German');
    console.log('Intl formatters in place; dayjs English-only paths retired.');
} catch (err) {
    console.error('Test failed:', err.message);
    process.exit(1);
}

console.log('All time-converter tests passed.');
