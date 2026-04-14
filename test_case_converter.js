const fs = require('fs');
const assert = require('assert');

// Extract the functions from index.html to test them
const html = fs.readFileSync('tools/case-converter/index.html', 'utf8');
const scriptMatch = html.match(/<script>(.*?)<\/script>/s);

if (!scriptMatch) {
    console.error('No script found');
    process.exit(1);
}

let script = scriptMatch[1];
script = script.replace(/const .*? = document.getElementById\(.*?\);/g, '');
script = script.replace(/outputBox\.value = .*?;/g, 'return result;');
script = script.replace(/resultBox\.classList\..*?;/g, '');
script = script.replace(/resultBox\.scrollIntoView\(\{.*?\}\);/g, '');
script = script.replace(/copyBtn\.addEventListener[\s\S]*?(?=\n\s*$)/g, '');
script = script.replace(/function convert\(type\) \{/, 'function convert(type, text) {');
script = script.replace(/let text = textInput\.value;/g, '');
script = script.replace(/if \(!text\) return;/g, 'if (!text) return \"\";');
script = script + '\nmodule.exports = { convert, toWords };\n';
fs.writeFileSync('test_extracted.js', script);

const { convert, toWords } = require('./test_extracted.js');

// Test Suite
console.log('Running tests for Case Converter...');

// Test 1: Empty string
assert.strictEqual(convert('camel', ''), '', 'Empty string should return empty string');

// Test 2: camelCase
assert.strictEqual(convert('camel', 'hello, world!'), 'helloWorld', 'Should remove punctuation and camel case');
assert.strictEqual(convert('camel', 'hello123world'), 'hello123World', 'Should handle numbers inside words');
assert.strictEqual(convert('camel', 'emoji 🚀 123'), 'emoji🚀123', 'Should keep emojis');
assert.strictEqual(convert('camel', 'aLtErNaTiNg'), 'aLtErNaTiNg', 'Should handle alternating case correctly by breaking up words on capital letters');

// Test 3: snake_case
assert.strictEqual(convert('snake', 'hello, world!'), 'hello_world', 'Should use underscore without punctuation');
assert.strictEqual(convert('snake', 'hello123world'), 'hello_123_world', 'Should separate numbers and letters with underscore');
assert.strictEqual(convert('snake', 'emoji 🚀 123'), 'emoji_🚀_123', 'Should handle emojis correctly with underscores');

// Test 4: kebab-case
assert.strictEqual(convert('kebab', 'hello, world!'), 'hello-world', 'Should use hyphen without punctuation');
assert.strictEqual(convert('kebab', 'hello123world'), 'hello-123-world', 'Should separate numbers and letters with hyphen');

// Test 5: Title Case
assert.strictEqual(convert('title', 'hello, world!'), 'Hello, World!', 'Should title case each word but retain punctuation');
assert.strictEqual(convert('title', "it's a test"), "It's A Test", 'Should handle apostrophes properly without capitalizing the letter after');
assert.strictEqual(convert('title', 'hello "world" (test)'), 'Hello "World" (Test)', 'Should capitalize words properly when following quotes or brackets');

// Test 6: Sentence case
assert.strictEqual(convert('sentence', 'hello! 🚀 world. test'), 'Hello! 🚀 World. Test', 'Should capitalize first letter of each sentence, even if there are emojis');
assert.strictEqual(convert('sentence', '¿hello? ¡world!'), '¿Hello? ¡World!', 'Should handle sentence-starting punctuation');
assert.strictEqual(convert('sentence', '123 hello! 123 world. test'), '123 hello! 123 world. Test', 'Should skip numbers if they start sentences');

console.log('All tests passed successfully! ✅');
