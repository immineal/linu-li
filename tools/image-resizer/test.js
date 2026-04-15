const assert = require('assert');

// Isolated math logic for aspect ratio
function calculateTargetHeight(targetWidth, imgWidth, imgHeight) {
    if (!targetWidth || targetWidth <= 0) return 0;
    if (!imgWidth || imgWidth <= 0) return 0;
    return Math.round((targetWidth / imgWidth) * imgHeight);
}

// Test Suite
function runTests() {
    console.log('Running Inspector math logic tests for Bulk Resizer...');

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

    console.log('✅ All math logic tests passed successfully.');
}

runTests();
