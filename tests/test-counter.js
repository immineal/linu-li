const assert = require('assert');

// The logic extracted from word-counter
const charSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
const sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
const spaceRegex = /^[\s\u200B-\u200D\uFEFF]+$/;

function getStats(text) {
    text = text || '';

    let charCount = 0;
    let charNoSpaceCount = 0;
    for (const s of charSegmenter.segment(text)) {
        charCount++;
        if (!spaceRegex.test(s.segment)) {
            charNoSpaceCount++;
        }
    }

    let wordCount = 0;
    for (const s of wordSegmenter.segment(text)) {
        if (s.isWordLike) wordCount++;
    }

    let sentenceCount = 0;
    for (const s of sentenceSegmenter.segment(text)) {
        if (s.segment.replace(/[\s\u200B-\u200D\uFEFF]/g, '').length > 0) {
            sentenceCount++;
        }
    }
    if (sentenceCount === 0 && charNoSpaceCount > 0) sentenceCount = 1;

    const minutes = Math.ceil(wordCount / 200) || 0;

    return {
        chars: charCount,
        charsNoSpace: charNoSpaceCount,
        words: wordCount,
        sentences: sentenceCount,
        readTime: minutes
    };
}

// Tests
function runTests() {
    console.log("Running Word & Char Counter Logic Tests...");

    // 1. Basic English
    let stats = getStats("Hello world. This is a test!");
    assert.strictEqual(stats.chars, 28);
    assert.strictEqual(stats.words, 6);
    assert.strictEqual(stats.sentences, 2);

    // 2. Emojis
    stats = getStats("👨‍👩‍👧‍👦 Hello 🌍");
    assert.strictEqual(stats.chars, 9); // 👨‍👩‍👧‍👦 (1), space (1), H (1), e (1), l (1), l (1), o (1), space (1), 🌍 (1)
    assert.strictEqual(stats.charsNoSpace, 7);
    assert.strictEqual(stats.words, 1);

    // 3. CJK Characters
    stats = getStats("你好世界。这是一个测试！");
    assert.strictEqual(stats.words, 6);
    assert.strictEqual(stats.sentences, 2);

    // 4. Zero-width spaces
    stats = getStats("hello\u200Bworld");
    assert.strictEqual(stats.chars, 11); // h, e, l, l, o, ZWS, w, o, r, l, d
    assert.strictEqual(stats.charsNoSpace, 10);
    assert.strictEqual(stats.words, 2);

    // 5. Empty string
    stats = getStats("");
    assert.strictEqual(stats.chars, 0);
    assert.strictEqual(stats.charsNoSpace, 0);
    assert.strictEqual(stats.words, 0);
    assert.strictEqual(stats.sentences, 0);

    // 6. Just spaces
    stats = getStats("   \n\t ");
    assert.strictEqual(stats.chars, 6);
    assert.strictEqual(stats.charsNoSpace, 0);
    assert.strictEqual(stats.words, 0);
    assert.strictEqual(stats.sentences, 0);

    // 7. No punctuation sentences
    stats = getStats("Wait what");
    assert.strictEqual(stats.sentences, 1);

    console.log("All tests passed!");
}

// For CJK test debugging
const cjkText = "你好世界。这是一个测试！";
let cjkWords = 0;
for (const s of wordSegmenter.segment(cjkText)) {
    if (s.isWordLike) {
        cjkWords++;
        console.log("CJK Word:", s.segment);
    }
}
console.log("Expected CJK Words:", cjkWords);

runTests();
