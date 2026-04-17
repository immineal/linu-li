const assert = require('assert');
const { encodeBase64Chunk } = require('../tools/base64-converter/worker.js');

console.log("Running Base64 worker encode chunk tests...");

function testEncode(input, isLast, expectedOutput) {
    const bytes = new Uint8Array(input);
    const result = encodeBase64Chunk(bytes, isLast);
    assert.strictEqual(result, expectedOutput, "Failed for input " + JSON.stringify(input) + " isLast=" + isLast);
}

// 1. Empty string/bytes
testEncode([], true, "");
testEncode([], false, "");

// 2. Length multiples of 3 (no padding)
// "Man" -> "TWFu"
testEncode([77, 97, 110], true, "TWFu");
testEncode([77, 97, 110], false, "TWFu");

// 3. Length with remainder 1 (== padding)
// "M" -> "TQ=="
testEncode([77], true, "TQ==");
// 4. Length with remainder 2 (= padding)
// "Ma" -> "TWE="
testEncode([77, 97], true, "TWE=");

// 5. Chunk processing (not last chunk) with remainder
// If it's not the last chunk, the remainder bytes are dropped by the encoder logic
testEncode([77], false, "");
testEncode([77, 97], false, "");

// 6. Large input
const largeInput = new Array(300).fill(77); // 'M'
const largeExpected2 = "TU1N".repeat(100);
testEncode(largeInput, true, largeExpected2);

// 7. Binary/non-ascii bytes
testEncode([0, 255, 127], true, "AP9/");

// With remainder 1
testEncode([255], true, "/w==");

// With remainder 2
testEncode([255, 255], true, "//8=");

console.log("All chunk tests passed!");
