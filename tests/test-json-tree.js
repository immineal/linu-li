const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const htmlPath = path.join(__dirname, '..', 'tools', 'json-tools', 'index.html');
let htmlContent = fs.readFileSync(htmlPath, 'utf8');

// Strip out layout.js to avoid issues in JSDOM testing
htmlContent = htmlContent.replace(/<script src="..\/..\/assets\/js\/layout\.js"><\/script>/g, '');

const { window } = new JSDOM(htmlContent, {
    url: "http://localhost",
    runScripts: "dangerously"
});

const document = window.document;

try {
    console.log("Testing JSON Workbench renderTree and buildTreeElement...");

    const buildTreeElement = window.buildTreeElement;
    const renderTree = window.renderTree;
    const treeBox = document.getElementById('treeBox');

    // Helper to simulate toggle event on <details>
    function triggerToggle(element) {
        element.open = true;
        element.dispatchEvent(new window.Event('toggle'));
    }

    // --- Test Primitives ---

    // null
    let nullNode = buildTreeElement('myNull', null);
    assert.strictEqual(nullNode.tagName.toLowerCase(), 'div', 'Null should be a div');
    assert.ok(nullNode.querySelector('.jt-null'), 'Should contain jt-null span');
    assert.strictEqual(nullNode.querySelector('.jt-null').textContent, 'null', 'Null text content should be "null"');
    assert.ok(nullNode.querySelector('.jt-key'), 'Should contain key');
    assert.strictEqual(nullNode.querySelector('.jt-key').textContent, '"myNull": ', 'Key should be formatted correctly');

    // boolean
    let boolNode = buildTreeElement('myBool', true);
    assert.ok(boolNode.querySelector('.jt-bool'), 'Should contain jt-bool span');
    assert.strictEqual(boolNode.querySelector('.jt-bool').textContent, 'true', 'Boolean text content should be "true"');

    // number
    let numNode = buildTreeElement('myNum', 42);
    assert.ok(numNode.querySelector('.jt-num'), 'Should contain jt-num span');
    assert.strictEqual(numNode.querySelector('.jt-num').textContent, '42', 'Number text content should be "42"');

    // string
    let strNode = buildTreeElement('myStr', 'hello');
    assert.ok(strNode.querySelector('.jt-string'), 'Should contain jt-string span');
    assert.strictEqual(strNode.querySelector('.jt-string').textContent, '"hello"', 'String text content should be in quotes');


    // --- Test Objects & Arrays ---

    // Object
    let objNode = buildTreeElement('myObj', { a: 1, b: 2 });
    assert.strictEqual(objNode.tagName.toLowerCase(), 'details', 'Object should be a details element');
    assert.strictEqual(objNode.querySelector('.jt-meta').textContent, '{ 2 }', 'Meta should indicate size 2');

    // Simulate open to trigger lazy loading
    triggerToggle(objNode);
    let objUl = objNode.querySelector('ul');
    assert.ok(objUl, 'Should contain ul for children');
    assert.strictEqual(objUl.children.length, 2, 'Should have 2 li elements');
    assert.ok(objUl.children[0].querySelector('.jt-key').textContent.includes('a'), 'First child should be a');
    assert.ok(objUl.children[1].querySelector('.jt-key').textContent.includes('b'), 'Second child should be b');

    // Array
    let arrNode = buildTreeElement('myArr', [10, 20, 30]);
    assert.strictEqual(arrNode.tagName.toLowerCase(), 'details', 'Array should be a details element');
    assert.strictEqual(arrNode.querySelector('.jt-meta').textContent, '[ 3 ]', 'Meta should indicate size 3');

    // Simulate open
    triggerToggle(arrNode);
    let arrUl = arrNode.querySelector('ul');
    assert.strictEqual(arrUl.children.length, 3, 'Should have 3 li elements');
    // Array items don't typically have explicit keys shown in this specific tree implementation
    // unless the function logic creates keys for them. The code says: childKey = isArray ? null : k;
    assert.ok(!arrUl.children[0].querySelector('.jt-key'), 'Array items should not have keys displayed');
    assert.strictEqual(arrUl.children[0].querySelector('.jt-num').textContent, '10', 'First item should be 10');


    // --- Test Pagination / Chunking ---

    let largeArray = Array.from({ length: 150 }, (_, i) => i);
    let largeNode = buildTreeElement('largeArr', largeArray);

    triggerToggle(largeNode);
    let largeUl = largeNode.querySelector('ul');

    // Should render 100 items + 1 "Load more" button wrapper li
    assert.strictEqual(largeUl.children.length, 101, 'Should chunk to 100 items + 1 load more button');

    let loadMoreLi = largeUl.children[100];
    let loadMoreBtn = loadMoreLi.querySelector('button');
    assert.ok(loadMoreBtn, 'Load more button should exist');
    assert.ok(loadMoreBtn.textContent.includes('50 left'), 'Button should indicate 50 items left');

    // Simulate clicking load more
    loadMoreBtn.click();
    assert.strictEqual(largeUl.children.length, 150, 'Should load remaining 50 items and remove load more button');


    // --- Test renderTree function ---

    const testData = { success: true, count: 5 };
    renderTree(testData);

    assert.strictEqual(treeBox.children.length, 1, 'treeBox should have 1 child (root)');
    const rootNode = treeBox.children[0];
    assert.strictEqual(rootNode.tagName.toLowerCase(), 'details', 'Root should be details');
    // The root node uses key='root' which doesn't show a key span according to the logic
    assert.ok(!rootNode.querySelector('summary > .jt-key'), 'Root should not have a key displayed');
    assert.strictEqual(rootNode.querySelector('.jt-meta').textContent, '{ 2 }', 'Root meta should indicate size 2');
    assert.ok(rootNode.open, 'Root node should be open by default');

    console.log('✅ JSON Workbench tests passed!');
    process.exit(0);
} catch (err) {
    console.error('❌ JSON Workbench tests failed:', err);
    process.exit(1);
}
