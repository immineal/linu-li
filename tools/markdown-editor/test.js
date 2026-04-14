const { JSDOM } = require('jsdom');
const marked = require('marked');
const createDOMPurify = require('dompurify');
const assert = require('assert');

// Simulate the DOM environment
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

// Function extracted from the fix in index.html
function render(mdInputText) {
    try {
        const rawHtml = marked.parse(mdInputText);
        const cleanHtml = DOMPurify.sanitize(rawHtml);
        return cleanHtml;
    } catch (err) {
        return "<p style='color: red;'>Error rendering Markdown.</p>";
    }
}

// 1. Test XSS Mitigation
const xssPayload = "<img src='x' onerror='alert(1)'>";
const output = render(xssPayload);
assert.ok(output.indexOf('onerror') === -1, "XSS mitigation failed: onerror attribute found");
assert.ok(output.includes('<img src="x">'), "XSS mitigation failed: image tag missing or incorrect");
console.log("✅ XSS Mitigation Test Passed");

// 2. Test Safe Parsing / Normal Output
const safePayload = "# Hello";
const output2 = render(safePayload);
assert.ok(output2.includes('<h1>Hello</h1>') || output2.includes('<h1 id="hello">Hello</h1>'), "Safe parsing failed");
console.log("✅ Safe Parsing Test Passed");

// 3. Test Mermaid Block Preservation
const mermaidPayload = "```mermaid\ngraph TD;\n A-->B;\n```";
const output3 = render(mermaidPayload);
// DOMPurify should allow the language-mermaid class for extensibility
assert.ok(output3.includes('class="language-mermaid"'), "Mermaid code block class stripped by DOMPurify");
console.log("✅ Mermaid Extensibility Support Test Passed");
