const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE LOG:', msg.text()));

  await page.goto(`http://localhost:3000/tools/json-tools/index.html`, {waitUntil: 'networkidle0'});

  await page.evaluate(() => {
    document.getElementById('jsonInput').value = '{"a": 1}';
    document.getElementById('processBtn').click();
  });

  await new Promise(r => setTimeout(r, 1000));

  await page.evaluate(() => {
    document.getElementById('viewTreeBtn').click();
  });

  await new Promise(r => setTimeout(r, 500));
  const treeHtml = await page.evaluate(() => document.getElementById('treeBox').innerHTML);
  console.log('Tree Box contains a:', treeHtml.includes('"a":'));

  await browser.close();
})();
