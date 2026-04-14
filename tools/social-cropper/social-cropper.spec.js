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