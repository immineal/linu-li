const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
    const filePath = path.join(__dirname, '../../', req.url === '/' ? 'index.html' : req.url);
    const extname = path.extname(filePath);
    let contentType = 'text/html';
    if (extname === '.js') contentType = 'text/javascript';
    if (extname === '.css') contentType = 'text/css';
    if (extname === '.svg') contentType = 'image/svg+xml';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end();
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(8080, async () => {
    let browser;
    try {
        browser = await puppeteer.launch();
        const page = await browser.newPage();

        await page.goto('http://localhost:8080/tools/svg-to-png/index.html');

        // 1. Test SVG without width/height but with viewBox
        console.log('Testing SVG with viewBox only...');
        const svgViewBox = `<svg viewBox="0 0 150 300" xmlns="http://www.w3.org/2000/svg"><rect width="150" height="300" fill="red"/></svg>`;

        await page.evaluate(async (svgString) => {
            const blob = new Blob([svgString], { type: 'image/svg+xml' });
            const file = new File([blob], 'test.svg', { type: 'image/svg+xml' });

            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            document.getElementById('fileInput').files = dataTransfer.files;
            document.getElementById('fileInput').dispatchEvent(new Event('change'));
        }, svgViewBox);

        await new Promise(r => setTimeout(r, 500));

        await page.evaluate(() => {
            document.getElementById('scaleSelect').value = '1';
            document.getElementById('convertBtn').click();
        });

        await new Promise(r => setTimeout(r, 1000));

        const dims1 = await page.evaluate(() => document.getElementById('finalDims').textContent);
        console.log('Final dimensions (1x):', dims1);
        if (!dims1.includes('150 x 300')) throw new Error('Expected 150x300, got ' + dims1);

        // 2. Test massive scale multiplier
        console.log('Testing massive scale multiplier...');
        await page.evaluate(() => {
            document.getElementById('scaleSelect').value = 'custom';
            document.getElementById('scaleSelect').dispatchEvent(new Event('change'));
            document.getElementById('customWidth').value = '50000'; // Huge width
            document.getElementById('convertBtn').click();
        });

        await new Promise(r => setTimeout(r, 3000));

        const dims2 = await page.evaluate(() => document.getElementById('finalDims').textContent);
        console.log('Final dimensions (Clamped):', dims2);
        if (!dims2.includes('8192') && !dims2.includes('16384')) throw new Error('Expected clamped dimensions, got ' + dims2);

        console.log('ALL TESTS PASSED');
    } catch (e) {
        console.error('TEST FAILED:', e);
        process.exitCode = 1;
    } finally {
        if (browser) await browser.close();
        server.close();
        process.exit();
    }
});
