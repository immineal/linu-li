const assert = require('assert');
const fs = require('fs');

const workerCode = fs.readFileSync('./tools/case-converter/worker.js', 'utf8');

// We simulate the worker thread to test its logic synchronously in node.js
const workerScript = `
const messages = [];
const self = {
    postMessage: (data) => messages.push(data)
};

${workerCode.replace('self.onmessage = function(e)', 'function handleMessage(e)')}

// Extract toWords so it can be exported
const toWordsRegex = /function toWords\\(t\\) \\{[\\s\\S]*?\\n    \\}/;
const toWordsFuncStr = handleMessage.toString().match(toWordsRegex)[0];
const toWords = eval('(' + toWordsFuncStr + ')');

module.exports = {
    postMessage: function(data) {
        messages.length = 0;
        handleMessage({ data });
        return messages[0].result;
    },
    toWords: toWords
};
`;

fs.writeFileSync('./temp_worker_test.js', workerScript);

const workerMock = require('./temp_worker_test.js');

console.log('Running worker logic tests...');

assert.strictEqual(workerMock.postMessage({ type: 'upper', text: 'hello' }), 'HELLO');
assert.strictEqual(workerMock.postMessage({ type: 'lower', text: 'HELLO' }), 'hello');

// Smart Title tests
assert.strictEqual(workerMock.postMessage({ type: 'smart-title', text: "the lord of the rings: the fellowship of the ring" }), "The Lord of the Rings: The Fellowship of the Ring");
assert.strictEqual(workerMock.postMessage({ type: 'smart-title', text: "hello: an apple in the box. out of the box—a new era. 'the last of us'" }), "Hello: An Apple in the Box. Out of the Box—A New Era. 'The Last of Us'");
assert.strictEqual(workerMock.postMessage({ type: 'smart-title', text: "a tale of two cities" }), "A Tale of Two Cities");
assert.strictEqual(workerMock.postMessage({ type: 'smart-title', text: "emoji 🚀 123 in a box" }), "Emoji 🚀 123 in a Box");

// Title Case tests
assert.strictEqual(workerMock.postMessage({ type: 'title', text: "it's a test" }), "It's A Test");

// Camel Case tests
assert.strictEqual(workerMock.postMessage({ type: 'camel', text: "hello, world!" }), "helloWorld");
assert.strictEqual(workerMock.postMessage({ type: 'camel', text: "emoji 🚀 123" }), "emoji🚀123");

// toWords helper tests
console.log('Running toWords helper tests...');
assert.deepStrictEqual(workerMock.toWords('camelCase'), ['camel', 'Case']);
assert.deepStrictEqual(workerMock.toWords('PascalCase'), ['Pascal', 'Case']);
assert.deepStrictEqual(workerMock.toWords('snake_case'), ['snake', 'case']);
assert.deepStrictEqual(workerMock.toWords('kebab-case'), ['kebab', 'case']);
assert.deepStrictEqual(workerMock.toWords('hello 🚀 world'), ['hello', '🚀', 'world']);
assert.deepStrictEqual(workerMock.toWords('UPPER_CASE'), ['UPPER', 'CASE']);
assert.deepStrictEqual(workerMock.toWords('number123text'), ['number', '123', 'text']);
assert.deepStrictEqual(workerMock.toWords('123number'), ['123', 'number']);
assert.deepStrictEqual(workerMock.toWords('mixedCamel_and-snakeCase123'), ['mixed', 'Camel', 'and', 'snake', 'Case', '123']);

console.log('Worker logic tests passed successfully! ✅');
fs.unlinkSync('./temp_worker_test.js');
