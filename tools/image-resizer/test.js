const assert = require('assert');

// Isolated math logic for aspect ratio
function calculateTargetHeight(targetWidth, imgWidth, imgHeight) {
    if (imgWidth === 0 || imgHeight === 0) {
        throw new Error('Invalid image dimensions');
    }
    const scaleFactor = targetWidth / imgWidth;
    return Math.round(imgHeight * scaleFactor);
}

// Isolated math logic for Smart Crop
function calculateSmartCrop(targetWidth, targetHeight, imgWidth, imgHeight) {
    let sWidth = imgWidth;
    let sHeight = imgHeight;
    let sx = 0;
    let sy = 0;

    const targetAspect = targetWidth / targetHeight;
    const currentAspect = imgWidth / imgHeight;

    if (currentAspect > targetAspect) {
        // Image is wider than target aspect
        sWidth = imgHeight * targetAspect;
        sHeight = imgHeight;
        sx = (imgWidth - sWidth) / 2;
    } else {
        // Image is taller than target aspect
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

// Test Suite
function runTests() {
    console.log('Running math logic tests for Bulk Resizer...');

    // 1. Test standard aspect ratio
    assert.strictEqual(
        calculateTargetHeight(800, 1600, 1200),
        600,
        'Should correctly calculate 4:3 standard aspect ratio'
    );

    // 2. Test rounding on sub-pixel values
    // Without Math.round, this would be 333.333...
    assert.strictEqual(
        calculateTargetHeight(500, 1500, 1000),
        333,
        'Should correctly round 333.333... to 333'
    );

    // 3. Test rounding up
    // Without Math.round, this would be 666.666...
    assert.strictEqual(
        calculateTargetHeight(1000, 1500, 1000),
        667,
        'Should correctly round 666.666... up to 667'
    );

    // 4. Test zero width handling
    assert.throws(
        () => calculateTargetHeight(800, 0, 1200),
        { message: 'Invalid image dimensions' },
        'Should throw on zero width'
    );

    // 5. Test zero height handling
    assert.throws(
        () => calculateTargetHeight(800, 1600, 0),
        { message: 'Invalid image dimensions' },
        'Should throw on zero height'
    );

    // 6. Test Smart Crop (Wider image)
    const cropWide = calculateSmartCrop(500, 500, 1000, 500);
    assert.strictEqual(cropWide.sWidth, 500);
    assert.strictEqual(cropWide.sHeight, 500);
    assert.strictEqual(cropWide.sx, 250);
    assert.strictEqual(cropWide.sy, 0);

    // 7. Test Smart Crop (Taller image)
    const cropTall = calculateSmartCrop(500, 500, 500, 1000);
    assert.strictEqual(cropTall.sWidth, 500);
    assert.strictEqual(cropTall.sHeight, 500);
    assert.strictEqual(cropTall.sx, 0);
    assert.strictEqual(cropTall.sy, 250);

    // 8. Test Dynamic Naming Pattern Parsing
    const testName1 = parseNamingPattern("{original}_custom_{width}x{height}.{ext}", "photo", 1000, 800, "jpg");
    assert.strictEqual(testName1, "photo_custom_1000x800.jpg");

    const testName2 = parseNamingPattern("{original}_resized", "image", 800, 600, "png");
    assert.strictEqual(testName2, "image_resized.png", "Should append extension if missing");

    console.log('✅ All math logic tests passed successfully.');
}

runTests();