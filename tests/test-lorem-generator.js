const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const htmlPath = path.join(__dirname, '../tools/lorem-generator/index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// Strip layout.js script to prevent errors when running JSDOM
let testHtmlContent = htmlContent.replace(/<script src="..\/..\/assets\/js\/layout.js"><\/script>/g, '');

const dom = new JSDOM(testHtmlContent, {
    url: "http://localhost",
    runScripts: "dangerously"
});

const window = dom.window;

// Mock some things layout.js usually provides
window.showToast = function() {};
window.HTMLElement.prototype.scrollIntoView = function() {};

dom.window.addEventListener("load", () => {
    let failed = 0;

    function assert(condition, message) {
        if (!condition) {
            console.error(`❌ TEST FAILED: ${message}`);
            failed++;
        } else {
            console.log(`✅ TEST PASSED: ${message}`);
        }
    }

    try {
        console.log("Running Lorem Ipsum Generator Logic Tests...");

        const generateParagraph = window.generateParagraph;

        // --- generateParagraph Tests ---

        // 1. Returns a string
        const p1 = generateParagraph('latin', 3);
        assert(typeof p1 === 'string', "generateParagraph returns a string");

        // 2. Generates the exact number of sentences
        const p2 = generateParagraph('tech', 5);
        const sentences2 = p2.match(/\./g) || [];
        assert(sentences2.length === 5, "generateParagraph generates exactly 5 sentences");

        // 3. Handles 0 sentences
        const p3 = generateParagraph('corporate', 0);
        assert(p3 === '', "generateParagraph returns empty string for 0 sentences");

        // 4. Sentences end with a period
        const p4 = generateParagraph('latin', 1);
        assert(p4.endsWith('.'), "generateParagraph ends with a period");

        // 5. Generates text corresponding to requested theme
        const p5 = generateParagraph('corporate', 10);
        const corporateWords = ['agile', 'benchmark', 'circle-back', 'deliverables', 'empower'];
        const containsCorporate = corporateWords.some(w => p5.toLowerCase().includes(w));
        assert(containsCorporate, "generateParagraph uses corporate vocabulary for 'corporate' theme");

        // 6. Test with negative sentences
        const p6 = generateParagraph('latin', -1);
        assert(p6 === '', "generateParagraph handles negative sentences gracefully");

        // 7. Text doesn't start or end with extra spaces
        const p7 = generateParagraph('tech', 3);
        assert(p7 === p7.trim(), "generateParagraph output does not have leading/trailing whitespace");

        if (failed > 0) {
            console.error(`\n💥 ${failed} tests failed.`);
            process.exit(1);
        } else {
            console.log(`\n🎉 All tests passed successfully!`);
            process.exit(0);
        }
    } catch (e) {
        console.error('❌ Test execution failed:', e);
        process.exit(1);
    }
});