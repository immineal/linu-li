const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    beforeParse(window) {
        window.tinycolor = require('tinycolor2');
        // iro mock
        window.iro = {
            ColorPicker: class {
                constructor(el, opts) {
                    this.color = {
                        current: opts.color,
                        set: (c) => { this.color.current = c; },
                        get rgbString() { return window.tinycolor(this.current).toRgbString(); },
                    };
                }
                on() {}
                setOptions() {}
            },
            ui: { Wheel: {}, Slider: {}, Box: {} }
        };
    }
});

const window = dom.window;

setTimeout(() => {
    try {
        console.log("Running Color & Contrast Tests...");

        // --- Test 1: Invalid Hex Input ---
        // Invalid input should not be applied to colorPicker
        window.eval(`
            const valHex = document.getElementById('valHex');

            // Set initial valid color
            colorPicker.color.set("#ff0000");

            // Input invalid color
            valHex.value = "#12";
            valHex.dispatchEvent(new Event('input'));

            // Should not change the color to #000000
            window.__test_1_result = colorPicker.color.current;
        `);
        assert.strictEqual(window.__test_1_result, "#ff0000", "Test 1 Failed: Invalid input altered the color state incorrectly.");
        console.log("✅ Test 1 Passed: Invalid hex inputs are safely ignored.");


        // --- Test 2: Transparency / Alpha Handling ---
        // rgba(0,0,0,0.5) over #ffffff should be ~3.95 (not 21)
        window.eval(`
            colors.fg = "rgba(0,0,0,0.5)";
            colors.bg = "#ffffff";
            updateContrast();
            window.__test_2_ratio = document.getElementById('contrastRatio').textContent;
        `);
        assert.strictEqual(window.__test_2_ratio, "3.95", "Test 2 Failed: Alpha handling for transparency is incorrect.");
        console.log("✅ Test 2 Passed: Alpha blending for contrast calculations is accurate.");


        // --- Test 3: Boundary Logic (4.5 and 7.0) ---
        // 4.496 shouldn't pass AA even if rounded to "4.50"
        window.eval(`
            const originalReadability = tinycolor.readability;

            // Test AA Boundary
            tinycolor.readability = () => 4.496;
            updateContrast();
            window.__test_3a_display = document.getElementById('contrastRatio').textContent;
            window.__test_3a_badge = document.getElementById('badgeAA').textContent;

            // Test AAA Boundary
            tinycolor.readability = () => 6.996;
            updateContrast();
            window.__test_3b_display = document.getElementById('contrastRatio').textContent;
            window.__test_3b_badge = document.getElementById('badgeAAA').textContent;

            tinycolor.readability = originalReadability;
        `);
        assert.strictEqual(window.__test_3a_display, "4.50", "Test 3a Failed: Displayed ratio not rounded correctly.");
        assert.strictEqual(window.__test_3a_badge, "Fail", "Test 3a Failed: 4.496 falsely passed AA check.");

        assert.strictEqual(window.__test_3b_display, "7.00", "Test 3b Failed: Displayed ratio not rounded correctly.");
        assert.strictEqual(window.__test_3b_badge, "Fail", "Test 3b Failed: 6.996 falsely passed AAA check.");
        console.log("✅ Test 3 Passed: Exact boundary ratio logic works correctly without rounding inflation.");

        console.log("🎉 All Tests Passed!");

    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}, 500);
