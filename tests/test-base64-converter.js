const fs = require('fs');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const assert = require('assert');

// We need to inject setupDropZone before running the script
const layoutJs = fs.readFileSync('assets/js/layout.js', 'utf8');
const html = fs.readFileSync('tools/base64-converter/index.html', 'utf8');

// Provide url to JSDOM so localStorage won't fail with SecurityError
const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });

// Mock matchMedia and Worker
dom.window.matchMedia = () => ({ matches: false });
dom.window.Worker = class Worker {
    constructor(script) {
        this.script = script;
    }
    postMessage() {}
    terminate() {}
};

// Evaluate layout.js
dom.window.eval(layoutJs);

// Evaluate index.js inline script
const scripts = dom.window.document.querySelectorAll('script');
const inlineScript = scripts[scripts.length - 1].textContent;
dom.window.eval(inlineScript);

setTimeout(() => {
    const window = dom.window;
    const document = window.document;

    // Test text inputs
    const textInput = document.getElementById('textInput');
    const imagePreviewContainer = document.getElementById('imagePreviewContainer');

    console.log("Running Base64 Converter extension tests...");

    // Test Media Detection: PNG (Image)
    textInput.value = "iVBORw0KGgo";
    textInput.dispatchEvent(new window.Event('input'));
    let img = document.getElementById('imagePreview');
    assert.ok(img, "Image preview element should exist");
    assert.strictEqual(img.tagName, 'IMG', "Element should be an IMG tag");
    assert.ok(img.src.includes('data:image/png;base64,iVBORw0KGgo'), "Src should be a PNG data URI");

    // Test Media Detection: MP3 (Audio)
    textInput.value = "SUQzAAA";
    textInput.dispatchEvent(new window.Event('input'));
    let audio = document.getElementById('imagePreview');
    assert.ok(audio, "Audio preview element should exist");
    assert.strictEqual(audio.tagName, 'AUDIO', "Element should be an AUDIO tag");
    assert.ok(audio.src.includes('data:audio/mp3;base64,SUQzAAA'), "Src should be an MP3 data URI");

    // Test Media Detection: PDF
    textInput.value = "JVBERi0xLjQ=";
    textInput.dispatchEvent(new window.Event('input'));
    let pdf = document.getElementById('imagePreview');
    assert.ok(pdf, "PDF preview element should exist");
    assert.strictEqual(pdf.tagName, 'EMBED', "Element should be an EMBED tag");
    assert.ok(pdf.src.includes('data:application/pdf;base64,JVBERi0xLjQ='), "Src should be a PDF data URI");

    // Test Clear button clears preview
    const clearBtn = document.getElementById('clearTextBtn');
    clearBtn.click();
    assert.strictEqual(imagePreviewContainer.innerHTML, '', "Preview container should be empty after clear");
    assert.ok(imagePreviewContainer.classList.contains('hidden'), "Preview container should be hidden");

    console.log("All Base64 Converter tests passed!");
}, 500);
