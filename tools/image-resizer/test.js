const assert = require('assert');

// Copies of the arithmetic in index.html, which has no module to import.
function calculateTargetHeight(targetWidth, imgWidth, imgHeight) {
    if (!targetWidth || targetWidth <= 0) return 0;
    if (!imgWidth || imgWidth <= 0) return 0;
    return Math.round((targetWidth / imgWidth) * imgHeight);
}

function calculateSmartCrop(targetWidth, targetHeight, imgWidth, imgHeight) {
    let sWidth = imgWidth;
    let sHeight = imgHeight;
    let sx = 0;
    let sy = 0;

    const targetAspect = targetWidth / targetHeight;
    const currentAspect = imgWidth / imgHeight;

    if (currentAspect > targetAspect) {
        sWidth = imgHeight * targetAspect;
        sHeight = imgHeight;
        sx = (imgWidth - sWidth) / 2;
    } else {
        sWidth = imgWidth;
        sHeight = imgWidth / targetAspect;
        sy = (imgHeight - sHeight) / 2;
    }

    return { sx, sy, sWidth, sHeight };
}

function parseNamingPattern(pattern, originalName, width, height, extension) {
    let newName = pattern
        .replace(/{original}/g, originalName)
        .replace(/{width}/g, width)
        .replace(/{height}/g, height)
        .replace(/{ext}/g, extension);

    if (!newName.endsWith('.' + extension)) {
        newName += '.' + extension;
    }
    return newName;
}

function escapeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function runTests() {
    console.log('Running math logic tests for Bulk Resizer...');

    assert.strictEqual(
        calculateTargetHeight(800, 1600, 1200),
        600,
        'Should correctly calculate 4:3 standard aspect ratio'
    );

    assert.strictEqual(
        calculateTargetHeight(500, 1500, 1000),
        333,
        'Should correctly round 333.333... to 333'
    );

    assert.strictEqual(
        calculateTargetHeight(1000, 1500, 1000),
        667,
        'Should correctly round 666.666... up to 667'
    );

    assert.strictEqual(
        calculateTargetHeight(500, 1000, 1000),
        500,
        'Should correctly calculate 1:1 aspect ratio'
    );

    assert.strictEqual(
        calculateTargetHeight(2000, 1000, 500),
        1000,
        'Should correctly calculate upscaling'
    );

    assert.strictEqual(
        calculateTargetHeight(0, 1600, 1200),
        0,
        'Should return 0 on zero target width'
    );

    assert.strictEqual(
        calculateTargetHeight(-100, 1600, 1200),
        0,
        'Should return 0 on negative target width'
    );

    assert.strictEqual(
        calculateTargetHeight(undefined, 1600, 1200),
        0,
        'Should return 0 on undefined target width'
    );

    assert.strictEqual(
        calculateTargetHeight(null, 1600, 1200),
        0,
        'Should return 0 on null target width'
    );

    assert.strictEqual(
        calculateTargetHeight(800, 0, 1200),
        0,
        'Should return 0 on zero image width'
    );

    assert.strictEqual(
        calculateTargetHeight(800, -500, 1200),
        0,
        'Should return 0 on negative image width'
    );

    assert.strictEqual(
        calculateTargetHeight(800, undefined, 1200),
        0,
        'Should return 0 on undefined image width'
    );

    assert.strictEqual(
        calculateTargetHeight(800, 1600, 0),
        0,
        'Should correctly calculate 0 target height on 0 image height'
    );

    assert.strictEqual(
        calculateTargetHeight(800, 1600, -1200),
        -600,
        'Should correctly calculate negative target height for negative image height'
    );

    assert.strictEqual(
        calculateTargetHeight(800.5, 1600.5, 1200.5),
        600,
        'Should handle floating point dimensions correctly'
    );

    assert.strictEqual(
        calculateTargetHeight(0, 0, 0),
        0,
        'Should return 0 when all parameters are 0'
    );

    const cropWide = calculateSmartCrop(500, 500, 1000, 500);
    assert.strictEqual(cropWide.sWidth, 500);
    assert.strictEqual(cropWide.sHeight, 500);
    assert.strictEqual(cropWide.sx, 250);
    assert.strictEqual(cropWide.sy, 0);

    const cropTall = calculateSmartCrop(500, 500, 500, 1000);
    assert.strictEqual(cropTall.sWidth, 500);
    assert.strictEqual(cropTall.sHeight, 500);
    assert.strictEqual(cropTall.sx, 0);
    assert.strictEqual(cropTall.sy, 250);

    const testName1 = parseNamingPattern("{original}_custom_{width}x{height}.{ext}", "photo", 1000, 800, "jpg");
    assert.strictEqual(testName1, "photo_custom_1000x800.jpg");

    const testName2 = parseNamingPattern("{original}_resized", "image", 800, 600, "png");
    assert.strictEqual(testName2, "image_resized.png", "Should append extension if missing");

    const xssPayload = `<script>alert('XSS "attack" & test');</script>`;
    const escapedPayload = escapeHTML(xssPayload);
    assert.strictEqual(
        escapedPayload,
        `&lt;script&gt;alert(&#039;XSS &quot;attack&quot; &amp; test&#039;);&lt;/script&gt;`,
        'Should properly escape all unsafe characters in filenames'
    );

    const normalName = `image.jpg`;
    assert.strictEqual(escapeHTML(normalName), normalName, 'Should not alter safe strings');

    assert.strictEqual(escapeHTML(''), '', 'Should handle empty strings');
    assert.strictEqual(escapeHTML(null), '', 'Should return an empty string for null');

    console.log('All resizer tests passed.');
}

runTests();
