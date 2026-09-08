const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const crypto = require('crypto');

(async () => {
    console.log("Loading DOM...");
    const dom = await JSDOM.fromFile('tools/hash-generator/index.html', {
        runScripts: 'dangerously',
        resources: 'usable'
    });

    await new Promise(r => setTimeout(r, 1500)); // wait for crypto-js

    const window = dom.window;
    const document = window.document;

    const textInput = document.getElementById('textInput');
    const outSHA256 = document.getElementById('outSHA256');
    const outSHA512 = document.getElementById('outSHA512');
    const outMD5 = document.getElementById('outMD5');

    // Mock webcrypto if needed, though JSDOM has it
    if (!window.crypto.subtle) {
        window.crypto.subtle = {
            digest: async function(algo, data) {
                const alg = algo.toLowerCase().replace('-', '');
                const hash = crypto.createHash(alg).update(Buffer.from(data)).digest();
                return new Uint8Array(hash).buffer;
            }
        };
    }

    console.log("Testing Empty Text Input...");
    textInput.value = "";
    textInput.dispatchEvent(new window.Event('input'));

    await new Promise(r => setTimeout(r, 500));

    const expectedMD5 = "d41d8cd98f00b204e9800998ecf8427e";
    const expectedSHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    if (outMD5.value !== expectedMD5) throw new Error("Empty MD5 Failed! Got: " + outMD5.value);
    if (outSHA256.value !== expectedSHA256) throw new Error("Empty SHA256 Failed! Got: " + outSHA256.value);
    console.log("Empty Text OK");

    console.log("Testing Mock File Input (Chunking + ArrayBufferToWordArray)...");

    const ab = new Uint8Array([104, 101, 108, 108, 111]).buffer; // "hello"

    // To mock FileReader properly in JSDOM:
    class MockFileReader {
        readAsArrayBuffer(blob) {
            setTimeout(() => {
                this.result = blob._ab; // hacky access to mock blob data
                if (this.onload) this.onload({ target: this });
            }, 10);
        }
    }
    window.FileReader = MockFileReader;

    // Dispatch a mock file
    const fileInput = document.getElementById('fileInput');
    const mockFile = {
        name: "test.txt",
        size: 5,
        slice: function(start, end) {
            // return a blob mock
            return { _ab: ab.slice(start, end) };
        }
    };

    // The code uses `setupDropZone` which calls `handleFile(files)`.
    // Wait, the test can just call handleFile if it's exposed or we can trigger it via drop.
    // However, `handleFile` is not global.
    // Let's trigger the file input change event.
    Object.defineProperty(fileInput, 'files', {
        value: [mockFile]
    });
    fileInput.dispatchEvent(new window.Event('change'));

    await new Promise(r => setTimeout(r, 1000));

    const expectedHelloMD5 = "5d41402abc4b2a76b9719d911017c592";
    if (outMD5.value !== expectedHelloMD5) throw new Error("File MD5 Failed! Got: " + outMD5.value);

    console.log("File Hash OK!");
    console.log("All tests passed!");
    process.exit(0);
})().catch(e => {
    console.error(e);
    process.exit(1);
});
