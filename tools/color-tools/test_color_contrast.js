const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    beforeParse(window) {
        window.tinycolor = require('tinycolor2');
        // Stand-in for iro.js, which needs a real canvas.
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
        console.log("Running color and contrast tests...");

        // A half-typed hex value must not reach the picker.
        window.eval(`
            const valHex = document.getElementById('valHex');

            colorPicker.color.set("#ff0000");
            valHex.value = "#12";
            valHex.dispatchEvent(new Event('input'));

            window.__test_1_result = colorPicker.color.current;
        `);
        assert.strictEqual(window.__test_1_result, "#ff0000", "Test 1 Failed: Invalid input altered the color state incorrectly.");
        console.log("PASS: invalid hex input is ignored");


        // rgba(0,0,0,0.5) over #ffffff should be ~3.95 (not 21)
        window.eval(`
            colors.fg = "rgba(0,0,0,0.5)";
            colors.bg = "#ffffff";
            updateContrast();
            window.__test_2_ratio = document.getElementById('contrastRatio').textContent;
        `);
        assert.strictEqual(window.__test_2_ratio, "3.95", "Test 2 Failed: Alpha handling for transparency is incorrect.");
        console.log("PASS: a transparent text color is blended before measuring");


        // 4.496 shouldn't pass AA even if rounded to "4.50"
        window.eval(`
            const originalReadability = tinycolor.readability;

            tinycolor.readability = () => 4.496;
            updateContrast();
            window.__test_3a_display = document.getElementById('contrastRatio').textContent;
            window.__test_3a_badge = document.getElementById('badgeAA').textContent;

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
        console.log("PASS: the badges use the unrounded ratio");

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
        console.log("PASS: APCA gives Lc 106 for black on white and Lc 0 for white on white");

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

        // The first suggestion has to pass 4.5:1 itself.
        window.eval(`
            const sug = tinycolor(window.__test_5_suggestions[0]);
            const bg = tinycolor("#c44d3c");
            window.__test_5_sug_ratio = tinycolor.readability(sug, bg);
        `);
        assert.ok(window.__test_5_sug_ratio >= 4.5, "Test 5 Failed: Suggested color does not pass WCAG 2.1 AA.");
        console.log("PASS: failing pairs get suggestions that pass");


        // calcAPCA against reference values.
        window.eval(`
            window.__test_6_results = {
                blackOnWhite: calcAPCA(tinycolor("#000000"), tinycolor("#ffffff")),
                whiteOnBlack: calcAPCA(tinycolor("#ffffff"), tinycolor("#000000")),
                redOnWhite: calcAPCA(tinycolor("#ff0000"), tinycolor("#ffffff")),
                greenOnWhite: calcAPCA(tinycolor("#00ff00"), tinycolor("#ffffff")),
                sameColor: calcAPCA(tinycolor("#888888"), tinycolor("#888888"))
            };
        `);

        const apcaResults = window.__test_6_results;

        // A small epsilon for the float comparison. The measured deviations
        // are between 1e-7 and 8e-7, so 1e-5 leaves plenty of room without
        // letting a real change in the maths through.
        const assertCloseTo = (message, actual, expected, epsilon = 0.00001) => {
            assert.ok(Math.abs(actual - expected) < epsilon,
                `${message} Expected ~${expected}, but got ${actual}`);
        };

        // Reference values from the APCA-W3 specification (0.0.98G-4g):
        // black on white is Lc 106.04, white on black Lc -107.88. calcAPCA
        // returns them divided by 100. Taking the numbers from our own
        // output instead would only enshrine whatever it does today.
        assertCloseTo("Test 6 Failed: Black on White APCA incorrect.", apcaResults.blackOnWhite, 1.060406);
        assertCloseTo("Test 6 Failed: White on Black APCA incorrect.", apcaResults.whiteOnBlack, -1.078847);
        assertCloseTo("Test 6 Failed: Red on White APCA incorrect.", apcaResults.redOnWhite, 0.641262);
        assertCloseTo("Test 6 Failed: Green on White APCA incorrect.", apcaResults.greenOnWhite, 0.171301);
        assert.strictEqual(apcaResults.sameColor, 0, "Test 6 Failed: Same color APCA should be exactly 0.");

        console.log("PASS: calcAPCA matches the reference values");


        // blendAlpha with every mix of solid and transparent.
        window.eval(`
            const fgSolid = tinycolor('rgb(255, 0, 0)');
            const bgSolid = tinycolor('rgb(0, 0, 255)');

            const fgTrans = tinycolor('rgba(255, 0, 0, 0.5)');
            const bgTrans = tinycolor('rgba(0, 0, 255, 0.5)');

            // 1. Solid over Solid
            const res1 = blendAlpha(fgSolid, bgSolid);
            window.__test_7_res1_fg = res1.fg.toRgbString();
            window.__test_7_res1_bg = res1.bg.toRgbString();

            // 2. Solid over Transparent
            const res2 = blendAlpha(fgSolid, bgTrans);
            window.__test_7_res2_fg = res2.fg.toRgbString();
            window.__test_7_res2_bg = res2.bg.toRgbString();

            // 3. Transparent over Solid
            const res3 = blendAlpha(fgTrans, bgSolid);
            window.__test_7_res3_fg = res3.fg.toRgbString();
            window.__test_7_res3_bg = res3.bg.toRgbString();

            // 4. Transparent over Transparent
            const res4 = blendAlpha(fgTrans, bgTrans);
            window.__test_7_res4_fg = res4.fg.toRgbString();
            window.__test_7_res4_bg = res4.bg.toRgbString();
        `);

        // 1. Solid over Solid -> no change to either
        assert.strictEqual(window.__test_7_res1_fg, "rgb(255, 0, 0)", "Test 7 Failed: Solid FG should remain unchanged.");
        assert.strictEqual(window.__test_7_res1_bg, "rgb(0, 0, 255)", "Test 7 Failed: Solid BG should remain unchanged.");

        // 2. Solid over Transparent -> BG blends with white, FG unchanged
        assert.strictEqual(window.__test_7_res2_fg, "rgb(255, 0, 0)", "Test 7 Failed: Solid FG should remain unchanged over trans BG.");
        assert.strictEqual(window.__test_7_res2_bg, "rgb(128, 128, 255)", "Test 7 Failed: Transparent BG should blend with white.");

        // 3. Transparent over Solid -> BG unchanged, FG blends over BG
        assert.strictEqual(window.__test_7_res3_fg, "rgb(128, 0, 128)", "Test 7 Failed: Transparent FG should blend over solid BG.");
        assert.strictEqual(window.__test_7_res3_bg, "rgb(0, 0, 255)", "Test 7 Failed: Solid BG should remain unchanged under trans FG.");

        // 4. Transparent over Transparent -> BG blends with white, FG blends over new BG
        assert.strictEqual(window.__test_7_res4_fg, "rgb(192, 64, 128)", "Test 7 Failed: Transparent FG should blend over solidified trans BG.");
        assert.strictEqual(window.__test_7_res4_bg, "rgb(128, 128, 255)", "Test 7 Failed: Transparent BG should blend with white under trans FG.");

        console.log("PASS: blendAlpha");


        console.log("All color tools tests passed.");

    } catch(e) {
        console.error(e);
        process.exit(1);
    }
}, 500);
