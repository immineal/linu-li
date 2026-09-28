const puppeteer = require('puppeteer');
const fs = require('fs');
const { execSync } = require('child_process');
const assert = require('assert');

(async () => {
    console.log('Starting Puppeteer...');
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();

    // Needs a server on port 3000.
    await page.goto('http://localhost:3000/tools/social-cropper/index.html', { waitUntil: 'networkidle2' });

    execSync('convert -size 400x300 xc:transparent test_spec_image.png');

    const fileInput = await page.$('#fileInput');
    await fileInput.uploadFile('test_spec_image.png');

    await page.waitForSelector('.cropper-container');
    console.log('Image loaded.');

    // The 16:9 button must pass the full float, not a rounded 1.78.
    await page.evaluate(() => {
        document.querySelector('button[data-ratio="1.7777777777777777"]').click();
    });
    let cropperRatio = await page.evaluate(() => cropper.options.aspectRatio);
    assert.strictEqual(cropperRatio, 1.7777777777777777, 'Aspect ratio should be exactly 1.7777777777777777');
    console.log('PASS: 16:9 ratio is exact');

    // The round mask forces 1:1 and gives the old ratio back when switched off.
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
    console.log('PASS: round mask forces 1:1 and restores the previous ratio');

    // Rotating a transparent image and cropping it must not throw.
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
    console.log('PASS: rotated crop shows a result');

    // Choosing another image clears the round mask.
    await page.evaluate(() => {
        document.querySelector('#circleToggle').click();
        document.querySelector('#btnClear').click();
    });

    const circleCheckedAfterClear = await page.evaluate(() => document.querySelector('#circleToggle').checked);
    assert.strictEqual(circleCheckedAfterClear, false, 'Circle toggle should be reset after clearing');
    console.log('PASS: round mask cleared by Choose Another');

    // The clear above destroyed the cropper; the next checks need one.
    const fileInputRestored = await page.$('#fileInput');
    await fileInputRestored.uploadFile('test_spec_image.png');
    await page.waitForSelector('.cropper-container');

    await page.evaluate(() => {
        const platformSelect = document.querySelector('#platformSelect');
        platformSelect.value = 'ig';
        platformSelect.dispatchEvent(new Event('change'));
    });

    const igRatiosCount = await page.evaluate(() => document.querySelectorAll('#ratioButtonsContainer button').length);
    assert.strictEqual(igRatiosCount, 4, 'Instagram platform should have 4 ratio templates');

    await page.evaluate(() => {
        const platformSelect = document.querySelector('#platformSelect');
        platformSelect.value = 'twitter';
        platformSelect.dispatchEvent(new Event('change'));
        // Header, 3:1
        document.querySelectorAll('#ratioButtonsContainer button')[1].click();
    });

    const twitterRatio = await page.evaluate(() => cropper.options.aspectRatio);
    assert.strictEqual(twitterRatio, 3, 'Aspect ratio should be exactly 3 for Twitter Header');
    console.log('PASS: platform templates replace the ratio buttons');

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
    console.log('PASS: WebP export gets a .webp name and an image/webp data URI');

    console.log('All social cropper tests passed.');

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