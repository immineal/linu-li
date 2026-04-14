const fs = require('fs');

function runTests() {
    console.log("Running URL Cleaner edge-case regression tests...");

    // Read the actual HTML file and extract the inline logic
    const html = fs.readFileSync('tools/url-tools/index.html', 'utf8');
    const match = html.match(/cleanBtn\.addEventListener\('click', \(\) => \{([\s\S]*?)\}\);\s*\/\/\s*Decode Logic/);
    const paramsMatch = html.match(/const paramsToRemove = new Set\(\[([\s\S]*?)\]\);/);

    if (!match || !paramsMatch) {
        console.error("Failed to extract cleaning logic from index.html");
        process.exit(1);
    }

    let passed = 0;
    let failed = 0;

    function testLogic(inputStr) {
        let result = '';
        let toast = '';

        const context = {
            inputData: { value: inputStr },
            showToast: (msg, type) => { toast = msg; },
            displayResult: (text) => { result = text; },
            document: {
                getElementById: () => null // mock to avoid failure when manipulating DOM
            },
            paramsToRemove: new Set(paramsMatch[1].replace(/['\n\r\s]/g, '').split(','))
        };

        // Prepend paramsToRemove definition so it is available in scope
        const scriptBody = `
            const paramsToRemove = this.paramsToRemove;
            const document = this.document;
            ${match[1]}
        `;

        const func = new Function('inputData', 'showToast', 'displayResult', scriptBody);
        func.call(context, context.inputData, context.showToast, context.displayResult);

        return { result, toast };
    }

    function assertResult(testName, input, expectedResult, expectedToastSubstring) {
        const out = testLogic(input);
        const success = out.result === expectedResult && out.toast.includes(expectedToastSubstring);
        if (success) {
            console.log(`✅ ${testName}`);
            passed++;
        } else {
            console.log(`❌ ${testName}`);
            console.log(`   Expected Result: '${expectedResult}', Got: '${out.result}'`);
            console.log(`   Expected Toast to include: '${expectedToastSubstring}', Got: '${out.toast}'`);
            failed++;
        }
    }

    assertResult(
        "Empty input",
        "   ",
        "",
        "Please enter a URL"
    );

    assertResult(
        "Missing Protocol (Amazon)",
        "www.amazon.com/dp/B001234567?ref=xyz#reviews",
        "https://www.amazon.com/dp/B001234567#reviews",
        "Amazon"
    );

    assertResult(
        "Double/Triple Encoded",
        "https%253A%252F%252Fexample.com%252Fpage%253Futm_source%253Dfoo",
        "https://example.com/page",
        "Tracking parameters removed"
    );

    assertResult(
        "Anchor retention (YouTube)",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=youtu.be#anchor",
        "https://youtu.be/dQw4w9WgXcQ#anchor",
        "YouTube"
    );

    assertResult(
        "Anchor retention (X/Twitter)",
        "https://twitter.com/user/status/1234567890?s=20#reply",
        "https://x.com/user/status/1234567890#reply",
        "Twitter"
    );

    assertResult(
        "Aggressive Tracking Removal",
        "https://example.com/shop?fbclid=123&utm_source=test&gclid=456&_hsenc=789&valid_param=keepme",
        "https://example.com/shop?valid_param=keepme",
        "Tracking parameters removed"
    );

    assertResult(
        "Bulk URL Processing",
        "https://example.com/?utm_source=a\nhttps://example.com/?fbclid=b",
        "https://example.com/\nhttps://example.com/",
        "Cleaned 2 URLs!"
    );

    console.log(`\nTests completed: ${passed} passed, ${failed} failed.`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests();
