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

        await runTest("Cross-multiplication prevents precision drift", (document, window) => {
            const ratioW = document.getElementById('ratioW');
            const ratioH = document.getElementById('ratioH');
            const widthInput = document.getElementById('widthInput');
            const heightInput = document.getElementById('heightInput');

            // Float division of 16/9 is 1.7777777777777777
            // Setting a very large number tests if cross-multiplication maintains perfect integers
            ratioW.value = "16";
            ratioH.value = "9";
            ratioW.dispatchEvent(new window.Event('input'));

            widthInput.value = "192000";
            widthInput.dispatchEvent(new window.Event('input'));

            if (heightInput.value !== "108000") {
                throw new Error(`Expected height 108000 for 16:9 with w=192000, but got ${heightInput.value}`);
            }
        });

        await runTest("GCD function correctly simplifies ratios", (document, window) => {
            const gcd = window.gcd;
            if (!gcd || typeof gcd !== 'function') {
                 throw new Error("GCD function not exposed on window/script context");
            }
            if (gcd(1920, 1080) !== 120) {
                 throw new Error("GCD failed for 1920, 1080");
            }
            if (gcd(200, 100) !== 100) {
                 throw new Error("GCD failed for 200, 100");
            }
        });

        await runTest("Presets execute setRatio successfully", (document, window) => {
            const ratioW = document.getElementById('ratioW');
            const ratioH = document.getElementById('ratioH');

            // Try to click the 32:9 button
            const btn329 = Array.from(document.querySelectorAll('button')).find(b => b.textContent === '32:9');
            if (!btn329) throw new Error("Could not find 32:9 button");

            btn329.click();

            if (ratioW.value !== "32" || ratioH.value !== "9") {
                throw new Error(`Expected ratio 32:9, got ${ratioW.value}:${ratioH.value}`);
            }
        });

        console.log("All tests passed.");
    } catch (e) {
        console.error("Test suite failed.", e);
        process.exit(1);
    }
}

main();
