const puppeteer = require('puppeteer');
const fs = require('fs');
const { execSync } = require('child_process');
const assert = require('assert');

(async () => {
    console.log('Starting Puppeteer...');
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();

    // We expect a local server running on port 3000
    await page.goto('http://localhost:3000/tools/social-cropper/index.html', { waitUntil: 'networkidle2' });

    // --- TEST SETUP: Generate a test image ---
    execSync('convert -size 400x300 xc:transparent test_spec_image.png');

    const fileInput = await page.$('#fileInput');
    await fileInput.uploadFile('test_spec_image.png');

    await page.waitForSelector('.cropper-container');
    console.log('Image loaded successfully.');

    // --- TEST 1: Aspect Ratio Precision ---
    await page.evaluate(() => {
        document.querySelector('button[data-ratio="1.7777777777777777"]').click();
    });
    let cropperRatio = await page.evaluate(() => cropper.options.aspectRatio);
    assert.strictEqual(cropperRatio, 1.7777777777777777, 'Aspect ratio should be exactly 1.7777777777777777');
    console.log('Test 1 Passed: Aspect Ratio is precise.');

    // --- TEST 2: Circular Mask State Toggling ---
    await page.evaluate(() => {
        document.querySelector('#circleToggle').click();
    });

    let isCircleChecked = await page.evaluate(() => document.querySelector('#circleToggle').checked);
    assert.strictEqual(isCircleChecked, true, 'Circle toggle should be checked');

    let currentRatio = await page.evaluate(() => cropper.options.aspectRatio);
    assert.strictEqual(currentRatio, 1, 'Aspect ratio should be forced to 1:1 for circular mask');

    await page.evaluate(() => {
        document.querySelector('#circleToggle').click();
    });

    isCircleChecked = await page.evaluate(() => document.querySelector('#circleToggle').checked);
    assert.strictEqual(isCircleChecked, false, 'Circle toggle should be unchecked');

    currentRatio = await page.evaluate(() => cropper.options.aspectRatio);
    assert.strictEqual(currentRatio, 1.7777777777777777, 'Aspect ratio should be restored to previous value after turning off circular mask');
    console.log('Test 2 Passed: Circular mask state toggles correctly.');

    // --- TEST 3: Rotation and Transparency Crop (No Crash) ---
    await page.evaluate(() => {
        const range = document.querySelector('#rotateRange');
        range.value = -45;
        range.dispatchEvent(new Event('input'));
    });

    const rotation = await page.evaluate(() => cropper.getData().rotate);
    assert.strictEqual(rotation, -45, 'Rotation should be -45 degrees');

    await page.evaluate(() => {
        document.querySelector('#btnCrop').click();
    });

    const isResultVisible = await page.evaluate(() => !document.querySelector('#resultBox').classList.contains('hidden'));
    assert.strictEqual(isResultVisible, true, 'Result box should be visible after successful crop');
    console.log('Test 3 Passed: Crop completes without crash, result box is visible.');

    // --- TEST 4: Reset on "Upload New" ---
    await page.evaluate(() => {
        document.querySelector('#circleToggle').click(); // toggle on
        document.querySelector('#btnClear').click(); // click upload new
    });

    const circleCheckedAfterClear = await page.evaluate(() => document.querySelector('#circleToggle').checked);
    assert.strictEqual(circleCheckedAfterClear, false, 'Circle toggle should be reset after clearing');
    console.log('Test 4 Passed: States reset correctly on "Upload New".');

    // Restore cropper for subsequent tests
    const fileInputRestored = await page.$('#fileInput');
    await fileInputRestored.uploadFile('test_spec_image.png');
    await page.waitForSelector('.cropper-container');

    // --- TEST 5: Platform Selector updates aspect ratios ---
    await page.evaluate(() => {
        const platformSelect = document.querySelector('#platformSelect');
        platformSelect.value = 'ig';
        platformSelect.dispatchEvent(new Event('change'));
    });

    const igRatiosCount = await page.evaluate(() => document.querySelectorAll('#ratioButtonsContainer button').length);
    assert.strictEqual(igRatiosCount, 4, 'Instagram platform should have 4 ratio templates');

    // Test Twitter ratio update (e.g. Header 3:1)
    await page.evaluate(() => {
        const platformSelect = document.querySelector('#platformSelect');
        platformSelect.value = 'twitter';
        platformSelect.dispatchEvent(new Event('change'));
        // Click second button (Header 3:1)
        document.querySelectorAll('#ratioButtonsContainer button')[1].click();
    });

    const twitterRatio = await page.evaluate(() => cropper.options.aspectRatio);
    assert.strictEqual(twitterRatio, 3, 'Aspect ratio should be exactly 3 for Twitter Header');
    console.log('Test 5 Passed: Platform selector updates UI and aspect ratios correctly.');

    // --- TEST 6: WebP format export extension ---
    await page.evaluate(() => {
        const formatSelect = document.querySelector('#formatSelect');
        formatSelect.value = 'webp';
        formatSelect.dispatchEvent(new Event('change'));
        document.querySelector('#btnCrop').click();
    });

    const downloadFileName = await page.evaluate(() => document.querySelector('#btnDownload').download);
    assert.strictEqual(downloadFileName, 'cropped-image.webp', 'Download file name should have .webp extension');

    const downloadHref = await page.evaluate(() => document.querySelector('#btnDownload').href);
    assert.strictEqual(downloadHref.startsWith('data:image/webp'), true, 'Download link should contain image/webp data URI');
    console.log('Test 6 Passed: Export format properly updates file extension and data URI.');

    console.log('All tests passed successfully!');

    await browser.close();
    if (fs.existsSync('test_spec_image.png')) {
        fs.unlinkSync('test_spec_image.png');
    }
    process.exit(0);
})().catch(err => {
    console.error('Test Failed:', err);
    if (fs.existsSync('test_spec_image.png')) {
        fs.unlinkSync('test_spec_image.png');
    }
    process.exit(1);
});