const fs = require('fs');
const assert = require('assert');

const htmlContent = fs.readFileSync(__dirname + '/index.html', 'utf8');

// Static-analysis test: the shape that survives a Reset mid-extract.
// The bug we are guarding: click Reset while a big PDF is being scanned,
// then the loop runs to completion, appends cards to a hidden grid, and
// pops a success toast on top of the fresh drop zone. This test locks in
// the runToken pattern so a future edit that removes it fails here.

try {
    // The token counter itself.
    assert.ok(/let\s+runToken\s*=\s*0/.test(htmlContent),
        'index.html should declare runToken');

    // resetTool must bump the token so an in-flight run sees it and returns.
    const resetToolMatch = htmlContent.match(/function\s+resetTool\s*\([\s\S]*?\n\s{8}\}/);
    assert.ok(resetToolMatch, 'resetTool function not found');
    assert.ok(/runToken\+\+/.test(resetToolMatch[0]),
        'resetTool must bump runToken so an in-flight run bails out');
    assert.ok(/currentPdf/.test(resetToolMatch[0]),
        'resetTool must drop the in-flight pdf loading task');
    assert.ok(/processBtn\.disabled\s*=\s*false/.test(resetToolMatch[0]),
        'resetTool must re-enable the Extract button');

    // The processBtn click handler must capture a token and check it after
    // every await, so cancel actually stops work rather than merely marking
    // it stale.
    const processHandler = htmlContent.match(/processBtn\.addEventListener\([\s\S]*?\n\s{8}\}\);/);
    assert.ok(processHandler, 'processBtn click handler not found');
    const body = processHandler[0];

    assert.ok(/const\s+token\s*=\s*\+\+runToken/.test(body),
        'process handler must capture a token by incrementing runToken');

    // Guards at natural break points: page loop iteration, after arrayBuffer,
    // after opening the pdf, after each inner await, before the final show.
    const guards = body.match(/if\s*\(\s*token\s*!==\s*runToken\s*\)/g) || [];
    assert.ok(guards.length >= 4,
        'process handler must check the token multiple times; found ' + guards.length);

    // The image-name dedup Set: fix for the 10s-hang-per-repeated-image bug.
    assert.ok(/seenImgNames/.test(body),
        'process handler must track seen image names to skip repeats');
    assert.ok(/seenImgNames\.has\(imgName\)/.test(body),
        'process handler must skip an imgName it has already tried');
    assert.ok(/seenImgNames\.add\(imgName\)/.test(body),
        'process handler must record every imgName it tries');

    console.log('pdf-extractor cancel-and-dedup guards present.');

} catch (error) {
    console.error('Test failed:', error.message);
    process.exit(1);
}

// pdf.js is asynchronous but bekommen() must keep its 10s escape hatch,
// so a genuinely absent object does not stall a run forever.
try {
    const bekommen = htmlContent.match(/function\s+bekommen\s*\([\s\S]*?\n\s{8}\}/);
    assert.ok(bekommen, 'bekommen helper not found');
    assert.ok(/setTimeout\([\s\S]*?10000\s*\)/.test(bekommen[0]),
        'bekommen must keep a 10s timeout so a missing object does not hang forever');
    console.log('bekommen timeout preserved.');
} catch (error) {
    console.error('Test failed:', error.message);
    process.exit(1);
}

console.log('All pdf-extractor tests passed.');
