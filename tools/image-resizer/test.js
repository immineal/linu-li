const assert = require('assert');

// Isolated math logic for aspect ratio
function calculateTargetHeight(targetWidth, imgWidth, imgHeight) {
    if (!targetWidth || targetWidth <= 0) return 0;
    if (!imgWidth || imgWidth <= 0) return 0;
    return Math.round((targetWidth / imgWidth) * imgHeight);
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

    // Happy Paths
    // 1. Test standard aspect ratio
    assert.strictEqual(
        calculateTargetHeight(800, 1600, 1200),
        600,
        'Should correctly calculate 4:3 standard aspect ratio'
    );

    // 2. Test rounding down on sub-pixel values
    assert.strictEqual(
        calculateTargetHeight(500, 1500, 1000),
        333,
        'Should correctly round 333.333... to 333'
    );

    // 3. Test rounding up
    assert.strictEqual(
        calculateTargetHeight(1000, 1500, 1000),
        667,
        'Should correctly round 666.666... up to 667'
    );

    // 4. Test 1:1 square aspect ratio
    assert.strictEqual(
        calculateTargetHeight(500, 1000, 1000),
        500,
        'Should correctly calculate 1:1 aspect ratio'
    );

    // 5. Test upscaling
    assert.strictEqual(
        calculateTargetHeight(2000, 1000, 500),
        1000,
        'Should correctly calculate upscaling'
    );

    // Edge Cases and Error Conditions

    // 6. Test zero targetWidth
    assert.strictEqual(
        calculateTargetHeight(0, 1600, 1200),
        0,
        'Should return 0 on zero target width'
    );

    // 7. Test negative targetWidth
    assert.strictEqual(
        calculateTargetHeight(-100, 1600, 1200),
        0,
        'Should return 0 on negative target width'
    );

    // 8. Test undefined targetWidth
    assert.strictEqual(
        calculateTargetHeight(undefined, 1600, 1200),
        0,
        'Should return 0 on undefined target width'
    );

    // 9. Test null targetWidth
    assert.strictEqual(
        calculateTargetHeight(null, 1600, 1200),
        0,
        'Should return 0 on null target width'
    );

    // 10. Test zero imgWidth
    assert.strictEqual(
        calculateTargetHeight(800, 0, 1200),
        0,
        'Should return 0 on zero image width'
    );

    // 11. Test negative imgWidth
    assert.strictEqual(
        calculateTargetHeight(800, -500, 1200),
        0,
        'Should return 0 on negative image width'
    );

    // 12. Test undefined imgWidth
    assert.strictEqual(
        calculateTargetHeight(800, undefined, 1200),
        0,
        'Should return 0 on undefined image width'
    );

    // 13. Test zero imgHeight
    assert.strictEqual(
        calculateTargetHeight(800, 1600, 0),
        0,
        'Should correctly calculate 0 target height on 0 image height'
    );

    // 14. Test negative imgHeight
    assert.strictEqual(
        calculateTargetHeight(800, 1600, -1200),
        -600,
        'Should correctly calculate negative target height for negative image height'
    );

    // 15. Test floating point dimensions
    assert.strictEqual(
        calculateTargetHeight(800.5, 1600.5, 1200.5),
        600,
        'Should handle floating point dimensions correctly'
    );

    // 16. Test all zeros
    assert.strictEqual(
        calculateTargetHeight(0, 0, 0),
        0,
        'Should return 0 when all parameters are 0'
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
