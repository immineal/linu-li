const { test, expect } = require('@playwright/test');

test('PDF Grayscale - test transparency rendering is white instead of black', async ({ page }) => {
    // Generate a transparent PDF and process it
    await page.goto('http://localhost:8000/tools/pdf-grayscale/index.html');

    // Evaluate if pixel data correctly applies blending and opaque alpha
    const result = await page.evaluate(() => {
        let data = new Uint8ClampedArray([0, 0, 0, 0]); // transparent black
        window.processPixelData(data, false, 200, 50);
        return Array.from(data);
    });

    expect(result).toEqual([255, 255, 255, 255]); // Transparent black blended over white becomes white [255,255,255] and opaque [255]

    // Evaluate full PDF upload handling
    await page.locator('input[type="file"]').setInputFiles('test.pdf');
    await expect(page.locator('#statusText')).toBeHidden(); // wait for preview to load

    await page.locator('#convertBtn').click();
    await expect(page.locator('#resultBox')).toBeVisible({ timeout: 10000 });
});
