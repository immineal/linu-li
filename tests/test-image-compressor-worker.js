const fs = require('fs');
const assert = require('assert');
const vm = require('vm');

console.log("Running Image Compressor worker tests...");

// Read worker script
let workerCodeOrig = fs.readFileSync(__dirname + '/../tools/image-compressor/worker.js', 'utf8');

// Replace dynamic import with a mockable global function for testing.
// If the worker ever writes its import differently, say without the
// template literal, the replacement quietly misses and every codec test
// then fails with "a dynamic import callback was not specified" — which
// blames the codec instead of this line. Say so plainly instead.
const patchedWorkerCode = workerCodeOrig.replace(/await import\(\`(.*?)\`\)/g, 'await global.mockImport(`$1`)');
assert.notStrictEqual(
    patchedWorkerCode,
    workerCodeOrig,
    "the dynamic import in tools/image-compressor/worker.js no longer matches the pattern this test rewrites — update the regex above"
);
workerCodeOrig = patchedWorkerCode;

function createSandbox(mockImportFn) {
    let lastMessage = null;
    const sandbox = {
        self: {
            onmessage: null,
            postMessage: (msg) => {
                lastMessage = msg;
            }
        },
        global: {
            mockImport: async (url) => {
                return mockImportFn(url);
            }
        },
        console: {
            error: () => {},
            log: () => {}
        },
        getLastMessage: () => lastMessage
    };
    vm.createContext(sandbox);
    vm.runInContext(workerCodeOrig, sandbox);
    return sandbox;
}

async function runTests() {
    let sandbox;

    // Test 1: Successful encode (WebP)
    sandbox = createSandbox(async (url) => {
        assert(url.includes('webp'), "Expected webp module load");
        return {
            encode: async (data, opts) => {
                assert.strictEqual(opts.quality, 80);
                assert.strictEqual(opts.method, 3);
                return `encoded_${data}_webp`;
            }
        };
    });
    await sandbox.self.onmessage({
        data: { id: 1, imageData: 'testdata', format: 'image/webp', options: { quality: 80 } }
    });
    let lastMessage = sandbox.getLastMessage();
    assert.strictEqual(lastMessage.success, true);
    assert.strictEqual(lastMessage.id, 1);
    assert.strictEqual(lastMessage.buffer, 'encoded_testdata_webp');

    // Test 2: Successful encode (AVIF)
    sandbox = createSandbox(async (url) => {
        assert(url.includes('avif'), "Expected avif module load");
        return {
            encode: async (data, opts) => {
                assert.strictEqual(opts.speed, 7);
                assert.strictEqual(opts.cqLevel, 33);
                assert.strictEqual(opts.subsample, 1);
                return `encoded_${data}_avif`;
            }
        };
    });
    await sandbox.self.onmessage({
        data: { id: 2, imageData: 'testdata2', format: 'image/avif', options: { quality: 7 } }
    });
    lastMessage = sandbox.getLastMessage();
    assert.strictEqual(lastMessage.success, true);
    assert.strictEqual(lastMessage.id, 2);
    assert.strictEqual(lastMessage.buffer, 'encoded_testdata2_avif');

    // Test 3: Successful encode (JPEG)
    sandbox = createSandbox(async (url) => {
        assert(url.includes('jpeg'), "Expected jpeg module load");
        return {
            encode: async (data, opts) => {
                assert.strictEqual(opts.quality, 85);
                assert.strictEqual(opts.optimizeCoding, true);
                assert.strictEqual(opts.smoothing, 0);
                assert.strictEqual(opts.colorSpace, 3);
                return `encoded_${data}_jpeg`;
            }
        };
    });
    await sandbox.self.onmessage({
        data: { id: 3, imageData: 'testdata3', format: 'image/jpeg', options: { quality: 85 } }
    });
    lastMessage = sandbox.getLastMessage();
    assert.strictEqual(lastMessage.success, true);
    assert.strictEqual(lastMessage.id, 3);
    assert.strictEqual(lastMessage.buffer, 'encoded_testdata3_jpeg');

    // Test 4: Successful encode (PNG)
    sandbox = createSandbox(async (url) => {
        assert(url.includes('png'), "Expected png module load");
        return {
            encode: async (data, opts) => {
                assert.strictEqual(opts.level, 2);
                assert.strictEqual(opts.interlace, false);
                return `encoded_${data}_png`;
            }
        };
    });
    await sandbox.self.onmessage({
        data: { id: 4, imageData: 'testdata4', format: 'image/png', options: {} }
    });
    lastMessage = sandbox.getLastMessage();
    assert.strictEqual(lastMessage.success, true);
    assert.strictEqual(lastMessage.id, 4);
    assert.strictEqual(lastMessage.buffer, 'encoded_testdata4_png');

    // Test 5: Unsupported format validation
    sandbox = createSandbox(async (url) => ({}));
    await sandbox.self.onmessage({
        data: { id: 5, imageData: 'data', format: 'image/bmp', options: {} }
    });
    lastMessage = sandbox.getLastMessage();
    assert.strictEqual(lastMessage.success, false);
    assert.strictEqual(lastMessage.id, 5);
    assert.strictEqual(lastMessage.error, "Unsupported format: image/bmp");

    // Test 6: Module load error
    sandbox = createSandbox(async (url) => {
        throw new Error("Network timeout");
    });
    await sandbox.self.onmessage({
        data: { id: 6, imageData: 'data', format: 'image/webp', options: { quality: 80 } }
    });
    lastMessage = sandbox.getLastMessage();
    assert.strictEqual(lastMessage.success, false);
    assert.strictEqual(lastMessage.id, 6);
    assert.strictEqual(lastMessage.error, "Failed to load codec webp: Network timeout");

    // Test 7: Encode error
    sandbox = createSandbox(async (url) => {
        return {
            encode: async () => {
                throw new Error("Encoding failed due to corrupt data");
            }
        };
    });
    await sandbox.self.onmessage({
        data: { id: 7, imageData: 'corrupt', format: 'image/jpeg', options: { quality: 80 } }
    });
    lastMessage = sandbox.getLastMessage();
    assert.strictEqual(lastMessage.success, false);
    assert.strictEqual(lastMessage.id, 7);
    assert.strictEqual(lastMessage.error, "Encoding failed due to corrupt data");

    console.log("All Image Compressor worker tests passed!");
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
