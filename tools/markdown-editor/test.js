const { JSDOM } = require('jsdom');
const marked = require('marked');
const createDOMPurify = require('dompurify');
const assert = require('assert');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

function render(mdInputText) {
    try {
        const rawHtml = marked.parse(mdInputText);
        const cleanHtml = DOMPurify.sanitize(rawHtml, { ADD_ATTR: ['target'] });
        return cleanHtml;
    } catch (err) {
        return "<p style='color: red;'>This Markdown could not be rendered.</p>";
    }
}

// An event handler in raw HTML must not survive
const xssPayload = "<img src='x' onerror='alert(1)'>";
const output = render(xssPayload);
assert.ok(output.indexOf('onerror') === -1, "XSS mitigation failed: onerror attribute found");
assert.ok(output.includes('<img src="x">'), "XSS mitigation failed: image tag missing or incorrect");
console.log('PASS: onerror stripped');

const safePayload = "# Hello";
const output2 = render(safePayload);
assert.ok(output2.includes('<h1>Hello</h1>') || output2.includes('<h1 id="hello">Hello</h1>'), "Safe parsing failed");
console.log('PASS: plain Markdown renders');

const mermaidPayload = "```mermaid\ngraph TD;\n A-->B;\n```";
const output3 = render(mermaidPayload);
// The page finds diagrams by this class, so DOMPurify has to leave it on
assert.ok(output3.includes('class="language-mermaid"'), "Mermaid code block class stripped by DOMPurify");
console.log('PASS: language-mermaid class kept');

const targetPayload = '<a href="https://example.com" target="_blank">link</a>';
const output4 = render(targetPayload);
assert.ok(output4.includes('target="_blank"'), "Target attribute stripped by DOMPurify");
console.log('PASS: target attribute kept');
