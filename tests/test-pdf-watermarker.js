const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

(async () => {
    let browser;
    try {
        browser = await puppeteer.launch();
        const page = await browser.newPage();

        page.on('console', msg => console.log('PAGE LOG:', msg.text()));

        // Start server in background or ensure one is running. Assuming server is running at port 3000
        await page.goto(`http://localhost:3000/tools/pdf-watermarker/index.html`, { waitUntil: 'networkidle0' });

        // 1. Use real dummy PDF files for testing
        const dummyPdfPath = path.join(__dirname, 'dummy.pdf');
        const dummyPdf2Path = path.join(__dirname, 'dummy2.pdf');

        // 2. Upload multiple files
        const fileInput = await page.$('#fileInput');
        await fileInput.uploadFile(dummyPdfPath, dummyPdf2Path);

        await new Promise(r => setTimeout(r, 1000));

        // 3. Trigger processing
        await page.evaluate(() => {
            document.getElementById('processBtn').click();
        });

        await new Promise(r => setTimeout(r, 2000));

        // 4. Verify download link
        const downloadData = await page.evaluate(() => {
            const link = document.getElementById('downloadLink');
            return {
                href: link.href,
                download: link.download,
                isVisible: !document.getElementById('resultBox').classList.contains('hidden')
            };
        });

        console.log('Download link generated:', !!downloadData.href);
        console.log('Download filename:', downloadData.download);
        console.log('Result box visible:', downloadData.isVisible);

        if (downloadData.download === 'watermarked-pdfs.zip' && downloadData.isVisible) {
            console.log('✅ Batch watermarking test passed.');
        } else {
            console.error('❌ Batch watermarking test failed.');
            process.exitCode = 1;
        }


    } catch (err) {
        console.error('Test error:', err);
        process.exitCode = 1;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
})();
