const fs = require('fs');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const assert = require('assert');

// Load required scripts
const layoutJs = fs.readFileSync('assets/js/layout.js', 'utf8');
const html = fs.readFileSync('tools/exif-scrubber/index.html', 'utf8');
const piexifJs = fs.readFileSync('assets/vendor/piexif.js', 'utf8');

const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });

dom.window.eval(piexifJs);
dom.window.eval(layoutJs);

// Evaluate inline script
const scripts = dom.window.document.querySelectorAll('script');
const inlineScript = scripts[scripts.length - 1].textContent;
dom.window.eval(inlineScript);

setTimeout(async () => {
    const window = dom.window;
    const document = window.document;

    console.log("Running EXIF Scrubber tests...");

    // Create a dummy JPEG with fake APP1, APP13
    const dummyJpeg = new Uint8Array([
        0xFF, 0xD8, // SOI
        0xFF, 0xE1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66, // APP1
        0xFF, 0xED, 0x00, 0x04, 0x12, 0x34, // APP13
        0xFF, 0xDA, 0x00, 0x08, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, // SOS + data
        0xFF, 0xD9 // EOI
    ]);

    const blob = new window.Blob([dummyJpeg], { type: 'image/jpeg' });
    const file = new window.File([blob], "test.jpg", { type: 'image/jpeg' });

    try {
        // Test robust stripping without copyright
        const strippedBlob = await window.stripAllMetadataAndInject(file, "");
        const arrayBuffer = await strippedBlob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        let foundApp1 = false;
        let foundApp13 = false;

        for (let i = 2; i < bytes.length;) {
            if (bytes[i] === 0xFF) {
                const marker = bytes[i+1];
                if (marker === 0xE1) foundApp1 = true;
                if (marker === 0xED) foundApp13 = true;

                if (marker === 0xDA) break;

                const len = (bytes[i+2] << 8) | bytes[i+3];
                i += 2 + len;
            } else {
                break;
            }
        }

        assert.ok(!foundApp1, "APP1 should be completely stripped");
        assert.ok(!foundApp13, "APP13 should be completely stripped");

        // Test robust stripping WITH copyright
        const copyrightBlob = await window.stripAllMetadataAndInject(file, "Linus Linhof");

        // We'll read it back as dataURL to parse with piexif
        const reader = new window.FileReader();
        reader.onload = function() {
            try {
                const exifData = window.piexif.load(reader.result);
                assert.strictEqual(exifData["0th"][window.piexif.ImageIFD.Copyright], "Linus Linhof", "Copyright should be correctly injected");
                console.log("All EXIF Scrubber tests passed!");
            } catch (err) {
                console.error("Failed to parse injected EXIF:", err);
                process.exit(1);
            }
        };
        reader.readAsDataURL(copyrightBlob);

    } catch(err) {
        console.error("Test failed:", err);
        process.exit(1);
    }
}, 500);