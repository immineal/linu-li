const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const htmlPath = path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

function runTest(name, fn) {
    return new Promise((resolve, reject) => {
        const dom = new JSDOM(html, { runScripts: "dangerously" });
        const window = dom.window;
        const document = window.document;

        // Give it a tick to initialize inline scripts
        setTimeout(() => {
            try {
                fn(document, window);
                console.log(`[PASS] ${name}`);
                resolve();
            } catch (e) {
                console.error(`[FAIL] ${name}: ${e.message}`);
                reject(e);
            }
        }, 50);
    });
}

async function main() {
    try {
        await runTest("Division by Zero handled safely", (document, window) => {
            const ratioW = document.getElementById('ratioW');
            const ratioH = document.getElementById('ratioH');
            const heightInput = document.getElementById('heightInput');

            ratioW.value = "16";
            ratioH.value = "0";
            ratioH.dispatchEvent(new window.Event('input'));

            if (heightInput.value === "Infinity" || isNaN(parseFloat(heightInput.value))) {
                throw new Error("Ratio H = 0 evaluated to invalid height: " + heightInput.value);
            }
        });

        await runTest("Negative Pixel Inputs clamped", (document, window) => {
            const widthInput = document.getElementById('widthInput');
            const heightInput = document.getElementById('heightInput');

            widthInput.value = "-1920";
            widthInput.dispatchEvent(new window.Event('input'));

            if (parseInt(heightInput.value) < 0) {
                throw new Error(`Negative pixel inputs permitted (Height became ${heightInput.value})`);
            }
        });

        await runTest("Negative Ratio Inputs clamped", (document, window) => {
            const ratioW = document.getElementById('ratioW');
            const ratioH = document.getElementById('ratioH');
            const heightInput = document.getElementById('heightInput');

            ratioW.value = "-16";
            ratioH.value = "9";
            ratioW.dispatchEvent(new window.Event('input'));

            if (parseInt(heightInput.value) < 0) {
                throw new Error(`Negative ratio inputs permitted (Height became ${heightInput.value})`);
            }
        });

        await runTest("Odd Aspect Ratio Rounding is stable", (document, window) => {
            const ratioW = document.getElementById('ratioW');
            const ratioH = document.getElementById('ratioH');
            const widthInput = document.getElementById('widthInput');
            const heightInput = document.getElementById('heightInput');

            ratioW.value = "21";
            ratioH.value = "9";
            ratioW.dispatchEvent(new window.Event('input'));

            widthInput.value = "1000";
            widthInput.dispatchEvent(new window.Event('input'));

            if (heightInput.value !== "429") {
                throw new Error(`Expected height 429 for 21:9 with w=1000, but got ${heightInput.value}`);
            }
        });

        console.log("All tests passed.");
    } catch (e) {
        console.error("Test suite failed.", e);
        process.exit(1);
    }
}

main();
