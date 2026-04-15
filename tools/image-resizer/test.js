const assert = require('assert');

// Isolated math logic for aspect ratio
function calculateTargetHeight(targetWidth, imgWidth, imgHeight) {
    if (imgWidth === 0 || imgHeight === 0) {
        throw new Error('Invalid image dimensions');
    }
    const scaleFactor = targetWidth / imgWidth;
    return Math.round(imgHeight * scaleFactor);
}

// Test Suite
function runTests() {
    console.log('Running Inspector math logic tests for Bulk Resizer...');

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

    console.log('✅ All math logic tests passed successfully.');
}

runTests();