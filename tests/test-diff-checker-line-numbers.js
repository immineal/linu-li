/**
 * Diff Checker — Word- and Character-mode line numbers.
 *
 * The old worker split every diff chunk on \n and treated each piece as its
 * own line, so `the quick brown fox` vs `the slow brown fox` in Word mode
 * came back as three rows and character mode broke a single line into one
 * row per glyph. The fix keeps the diff on original lines and moves the
 * word/character detail into an inline highlight inside each line.
 *
 * `rowsFromLineDiff` is what does that work — the message handler just calls
 * Diff.diff*, hands the result over, and posts what comes back.
 */
const assert = require('assert');
const path = require('path');
const Diff = require('diff');

global.Diff = Diff;
// A tiny hljs stand-in — the row-builder only asks for hljs when a language
// is not 'plaintext', and here we let the plaintext branch handle escaping.
global.hljs = { highlight() { return { value: '' }; }, highlightAuto() { return { language: 'plaintext' }; } };

const { rowsFromLineDiff, formatCode } = require('../tools/diff-checker/worker.js');

function collectLineNums(rows) {
    return rows.map(r => [r.numL, r.numR]);
}

console.log('Running Diff Checker line-number tests...');

// 1. Word mode over a one-line pair.
{
    const linesDiff = Diff.diffLines('the quick brown fox', 'the slow brown fox');
    const { inlineRows, sideRows } = rowsFromLineDiff(linesDiff, 'words', formatCode, 'plaintext', false);
    // Side-by-side: one paired row, both L1 and R1.
    assert.strictEqual(sideRows.length, 1, `side-by-side should have 1 row, got ${sideRows.length}`);
    assert.strictEqual(sideRows[0].numL, 1, 'left line number');
    assert.strictEqual(sideRows[0].numR, 1, 'right line number');
    assert.ok(sideRows[0].left.includes('inline-del'),
        'the changed word should be highlighted with inline-del on the left');
    assert.ok(sideRows[0].right.includes('inline-add'),
        'the changed word should be highlighted with inline-add on the right');
    // Inline: two rows, one del + one add, still line 1 on each side.
    assert.strictEqual(inlineRows.length, 2, 'inline: one del + one add row for a changed line');
    assert.strictEqual(inlineRows[0].numL, 1);
    assert.strictEqual(inlineRows[0].numR, '');
    assert.strictEqual(inlineRows[1].numL, '');
    assert.strictEqual(inlineRows[1].numR, 1);
}

// 2. Char mode over `cat` vs `cut`.
{
    const linesDiff = Diff.diffLines('cat', 'cut');
    const { inlineRows, sideRows } = rowsFromLineDiff(linesDiff, 'chars', formatCode, 'plaintext', false);
    assert.strictEqual(sideRows.length, 1, 'a one-line pair is one side-by-side row');
    assert.strictEqual(sideRows[0].numL, 1, 'left line number is 1');
    assert.strictEqual(sideRows[0].numR, 1, 'right line number is 1');
    assert.strictEqual(inlineRows.length, 2, 'inline: one del + one add');
    assert.strictEqual(inlineRows[0].numL, 1, `unexpected numL: ${JSON.stringify(collectLineNums(inlineRows))}`);
    assert.strictEqual(inlineRows[1].numR, 1);
}

// 3. Multi-line input keeps its own line numbers.
{
    const a = 'alpha\nbeta\ngamma';
    const b = 'alpha\nBETA\ngamma';
    const linesDiff = Diff.diffLines(a, b);
    const { inlineRows, sideRows } = rowsFromLineDiff(linesDiff, 'words', formatCode, 'plaintext', false);
    // 3 side rows: neutral / change / neutral. Line numbers must match input.
    assert.strictEqual(sideRows.length, 3);
    assert.strictEqual(sideRows[0].numL, 1); assert.strictEqual(sideRows[0].numR, 1);
    assert.strictEqual(sideRows[1].numL, 2); assert.strictEqual(sideRows[1].numR, 2);
    assert.strictEqual(sideRows[2].numL, 3); assert.strictEqual(sideRows[2].numR, 3);
    // Inline mirrors that: neutral, del, add, neutral.
    const nums = collectLineNums(inlineRows);
    assert.deepStrictEqual(nums, [[1, 1], [2, ''], ['', 2], [3, 3]],
        `inline row numbers ${JSON.stringify(nums)}`);
}

// 4. Deletion-only spanning several lines.
{
    const a = 'x\ny\nz';
    const b = 'x';
    const linesDiff = Diff.diffLines(a, b);
    const { sideRows } = rowsFromLineDiff(linesDiff, 'words', formatCode, 'plaintext', false);
    // 1 neutral + 2 removed
    assert.strictEqual(sideRows.length, 3);
    assert.strictEqual(sideRows[0].numL, 1);
    assert.strictEqual(sideRows[1].type, 'del');
    assert.strictEqual(sideRows[1].numL, 2);
    assert.strictEqual(sideRows[2].numL, 3);
}

console.log('PASS: Diff Checker line-number tests');
