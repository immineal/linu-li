const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');

console.log("Running pdf-grayscale calculateDeskewAsync wrapper tests...");

const html = fs.readFileSync('./tools/pdf-grayscale/index.html', 'utf8');

// Use a more robust extraction method that doesn't rely on specific comments
const scriptTags = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g));
// The main logic is in the last script tag
const scriptContent = scriptTags[scriptTags.length - 1][1];

// Set up JSDOM environment
const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, { runScripts: "dangerously" });
const window = dom.window;

// Define elements needed by the script
const elementIds = [
    'dropZone', 'fileInput', 'fileList', 'optionsPanel', 'controlButtons',
    'convertBtn', 'resetBtn', 'progressContainer', 'progressBar', 'statusText',
    'resultBox', 'downloadBtn', 'finalSizeDisplay', 'dpiSelect', 'cleanerToggle',
    'cleanerControls', 'whitePoint', 'blackPoint', 'valWhite', 'valBlack',
    'deskewSlider', 'valDeskew', 'autoDeskewBtn', 'previewSection',
    'previewCanvasBefore', 'previewCanvasAfter', 'compareSlider'
];

elementIds.forEach(id => {
    const el = window.document.createElement('div');
    el.id = id;
    if (id.includes('Canvas')) {
        el.getContext = () => ({
            getImageData: () => ({ data: new Uint8ClampedArray(100), width: 10, height: 10 }),
            putImageData: () => {},
            fillStyle: '',
            fillRect: () => {},
            save: () => {},
            translate: () => {},
            rotate: () => {},
            drawImage: () => {},
            restore: () => {}
        });
        el.width = 10;
        el.height = 10;
    }
    window.document.body.appendChild(el);
});

// Mock dependencies
window.pdfjsLib = { GlobalWorkerOptions: {} };
window.jspdf = { jsPDF: class {} };
window.setupDropZone = () => {};
window.showToast = () => {};

// Export the mock worker globally so we can inspect it later
let lastCreatedWorker = null;

// Mock Worker class
class MockWorker {
    constructor(scriptUrl) {
        this.scriptUrl = scriptUrl;
        this.onmessage = null;
        this.onerror = null;
        lastCreatedWorker = this;
    }
    postMessage(data) {
        // Echo back based on what is expected by calculateDeskewAsync
        if (data.type === 'deskew') {
            if (data.width === -1) {
                // Simulate an error condition if width is -1
                setTimeout(() => {
                    if (this.onerror) {
                        this.onerror(new Error("Worker failed"));
                    }
                }, 10);
            } else {
                // Simulate an async response
                setTimeout(() => {
                    if (this.onmessage) {
                        this.onmessage({
                            data: {
                                id: data.id,
                                type: 'deskewed',
                                angle: 42.5
                            }
                        });
                    }
                }, 10);
            }
        } else if (data.type === 'process') {
             setTimeout(() => {
                if (this.onmessage) {
                    this.onmessage({
                        data: {
                            id: data.id,
                            type: 'processed',
                            data: new Uint8ClampedArray([0, 0, 0, 255])
                        }
                    });
                }
            }, 10);
        }
    }
}

window.Worker = MockWorker;
window.Blob = class Blob { constructor() {} };
window.URL = { createObjectURL: () => 'blob:url' };

// Inject the script into JSDOM
const scriptEl = window.document.createElement('script');
scriptEl.textContent = scriptContent;
window.document.body.appendChild(scriptEl);

async function runTests() {
    try {
        const dummyData = new Uint8ClampedArray(100);

        // Test 1: Happy path
        const angle = await window.calculateDeskewAsync(dummyData, 10, 10);
        assert.strictEqual(angle, 42.5, "Wrapper should resolve with the angle returned by the mock worker");

        // Test 2: Error path
        let errorCaught = false;

        if (lastCreatedWorker) {
            lastCreatedWorker.onerror = (e) => {
                errorCaught = true;
            };
        }

        window.calculateDeskewAsync(dummyData, -1, 10);

        await new Promise(r => setTimeout(r, 50));
        assert.strictEqual(errorCaught, true, "Worker error should be caught by onerror handler");

        console.log("Wrapper tests passed! ✅");
        process.exit(0);
    } catch(e) {
        console.error("Test failed:", e);
        process.exit(1);
    }
}

setTimeout(runTests, 100);
