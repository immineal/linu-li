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

        // --- Test 4: APCA Calculation ---
        // Black on White should be ~106, White on White should be 0
        window.eval(`
            colors.fg = "#000000";
            colors.bg = "#ffffff";
            updateContrast();
            window.__test_4a_apca = document.getElementById('apcaRatio').textContent;

            colors.fg = "#ffffff";
            colors.bg = "#ffffff";
            updateContrast();
            window.__test_4b_apca = document.getElementById('apcaRatio').textContent;
        `);
        assert.strictEqual(window.__test_4a_apca, "Lc 106", "Test 4a Failed: APCA calculation for Black/White incorrect.");
        assert.strictEqual(window.__test_4b_apca, "Lc 0", "Test 4b Failed: APCA calculation for White/White incorrect.");
        console.log("✅ Test 4 Passed: APCA math returns expected boundaries.");

        // --- Test 5: Auto-Suggest Accessible Colors ---
        // Red (#c44d3c) on Red (#c44d3c) should fail and provide suggestions
        window.eval(`
            colors.fg = "#c44d3c";
            colors.bg = "#c44d3c";
            updateContrast();
            window.__test_5_display = document.getElementById('suggestBox').style.display;
            window.__test_5_suggestions = Array.from(document.getElementById('suggestSwatches').children).map(el => el.textContent);
        `);
        assert.strictEqual(window.__test_5_display, "block", "Test 5 Failed: Suggest box should be visible when contrast fails.");
        assert.ok(window.__test_5_suggestions.length > 0, "Test 5 Failed: Suggestions were not generated.");

        // Let's verify the first suggestion actually passes 4.5 ratio
        window.eval(`
            const sug = tinycolor(window.__test_5_suggestions[0]);
            const bg = tinycolor("#c44d3c");
            window.__test_5_sug_ratio = tinycolor.readability(sug, bg);
        `);
        assert.ok(window.__test_5_sug_ratio >= 4.5, "Test 5 Failed: Suggested color does not pass WCAG 2.1 AA.");
        console.log("✅ Test 5 Passed: Auto-suggest mechanism provides passing accessible alternatives.");

        // --- Test 6: blendAlpha Unit Tests ---
        window.eval(`
            const fgSolid = tinycolor('rgb(255, 0, 0)');
            const bgSolid = tinycolor('rgb(0, 0, 255)');

            const fgTrans = tinycolor('rgba(255, 0, 0, 0.5)');
            const bgTrans = tinycolor('rgba(0, 0, 255, 0.5)');

            // 1. Solid over Solid
            const res1 = blendAlpha(fgSolid, bgSolid);
            window.__test_6_res1_fg = res1.fg.toRgbString();
            window.__test_6_res1_bg = res1.bg.toRgbString();

            // 2. Solid over Transparent
            const res2 = blendAlpha(fgSolid, bgTrans);
            window.__test_6_res2_fg = res2.fg.toRgbString();
            window.__test_6_res2_bg = res2.bg.toRgbString();

            // 3. Transparent over Solid
            const res3 = blendAlpha(fgTrans, bgSolid);
            window.__test_6_res3_fg = res3.fg.toRgbString();
            window.__test_6_res3_bg = res3.bg.toRgbString();

            // 4. Transparent over Transparent
            const res4 = blendAlpha(fgTrans, bgTrans);
            window.__test_6_res4_fg = res4.fg.toRgbString();
            window.__test_6_res4_bg = res4.bg.toRgbString();
        `);

        // Assertions for blendAlpha
        // 1. Solid over Solid -> no change to either
        assert.strictEqual(window.__test_6_res1_fg, "rgb(255, 0, 0)", "Test 6 Failed: Solid FG should remain unchanged.");
        assert.strictEqual(window.__test_6_res1_bg, "rgb(0, 0, 255)", "Test 6 Failed: Solid BG should remain unchanged.");

        // 2. Solid over Transparent -> BG blends with white, FG unchanged
        assert.strictEqual(window.__test_6_res2_fg, "rgb(255, 0, 0)", "Test 6 Failed: Solid FG should remain unchanged over trans BG.");
        assert.strictEqual(window.__test_6_res2_bg, "rgb(128, 128, 255)", "Test 6 Failed: Transparent BG should blend with white.");

        // 3. Transparent over Solid -> BG unchanged, FG blends over BG
        assert.strictEqual(window.__test_6_res3_fg, "rgb(128, 0, 128)", "Test 6 Failed: Transparent FG should blend over solid BG.");
        assert.strictEqual(window.__test_6_res3_bg, "rgb(0, 0, 255)", "Test 6 Failed: Solid BG should remain unchanged under trans FG.");

        // 4. Transparent over Transparent -> BG blends with white, FG blends over new BG
        assert.strictEqual(window.__test_6_res4_fg, "rgb(192, 64, 128)", "Test 6 Failed: Transparent FG should blend over solidified trans BG.");
        assert.strictEqual(window.__test_6_res4_bg, "rgb(128, 128, 255)", "Test 6 Failed: Transparent BG should blend with white under trans FG.");

        console.log("✅ Test 6 Passed: blendAlpha handles all transparency combinations correctly.");


        console.log("🎉 All Tests Passed!");

    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}, 500);
