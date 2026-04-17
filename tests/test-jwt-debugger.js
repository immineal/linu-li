const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const htmlPath = path.join(__dirname, '..', 'tools', 'jwt-debugger', 'index.html');
let htmlContent = fs.readFileSync(htmlPath, 'utf8');

// We need layout.js, but instead of evaluating it, we can just mock the required parts or use dangerously
// The code relies on Intl, which is natively available in node.
const { window } = new JSDOM(htmlContent, {
    url: "http://localhost",
    runScripts: "dangerously"
});

const document = window.document;

// Mock current Date to be predictable: 2024-01-01T12:00:00Z
const MOCK_TIME = new Date('2024-01-01T12:00:00Z').getTime();
const OriginalDate = window.Date;
window.Date = class extends OriginalDate {
    constructor(...args) {
        if (args.length === 0) {
            super(MOCK_TIME);
        } else {
            super(...args);
        }
    }
    static now() {
        return MOCK_TIME;
    }
};

try {
    console.log("Testing JWT Debugger formatJSONWithTimestamps...");

    const formatJSONWithTimestamps = window.formatJSONWithTimestamps;

    // Test 1: Basic JSON formatting without timestamps
    const basicObj = {
        sub: "1234567890",
        name: "John Doe",
        admin: true,
        score: 100,
        settings: null
    };

    const basicResult = formatJSONWithTimestamps(basicObj);
    assert.ok(basicResult.includes('<span class="json-key">&quot;sub&quot;:</span>'), 'Should format keys');
    assert.ok(basicResult.includes('<span class="json-string">&quot;1234567890&quot;</span>'), 'Should format strings');
    assert.ok(basicResult.includes('<span class="json-boolean">true</span>'), 'Should format booleans');
    assert.ok(basicResult.includes('<span class="json-number">100</span>'), 'Should format numbers');
    assert.ok(basicResult.includes('<span class="json-null">null</span>'), 'Should format null');

    // Test 2: Timestamp formatting for exp, iat, nbf
    const MOCK_TIME_SECS = Math.floor(MOCK_TIME / 1000);

    const tsObj = {
        exp: MOCK_TIME_SECS + 30, // in a few seconds
        iat: MOCK_TIME_SECS - 3600, // 1 hour ago
        nbf: MOCK_TIME_SECS + 86400 * 2, // in 2 days
        custom: MOCK_TIME_SECS // Should NOT be annotated
    };

    const tsResult = formatJSONWithTimestamps(tsObj);

    // custom should just be a number without a timestamp hint
    // We check that the custom key does not have a timestamp hint right after it
    assert.ok(!tsResult.includes(`// ${new Date(MOCK_TIME_SECS * 1000).toLocaleString()}`), 'custom should not have timestamp hint');

    // Check that we DO get annotations for the right keys
    // The implementation specifically matches `/"(exp|iat|nbf)"\s*:\s*$/` before the number.
    assert.ok(tsResult.includes('in a few seconds'), 'exp should be in a few seconds');
    assert.ok(tsResult.includes('1 hour ago'), 'iat should be 1 hour ago');
    assert.ok(tsResult.includes('in 2 days'), 'nbf should be in 2 days');

    // Check edge case for days (more than 1 day)
    const longTimeObj = {
        exp: MOCK_TIME_SECS + 86400 * 5 // in 5 days
    };
    const longTimeResult = formatJSONWithTimestamps(longTimeObj);
    assert.ok(longTimeResult.includes('in 5 days'), 'exp should be in 5 days');

    console.log('✅ JWT Debugger tests passed!');
    process.exit(0);
} catch (err) {
    console.error('❌ JWT Debugger tests failed:', err);
    process.exit(1);
}
