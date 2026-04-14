const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.goto(`http://localhost:3000/tools/json-tools/index.html`, {waitUntil: 'networkidle0'});

  await page.evaluate(() => {
    document.getElementById('jsonInput').value = '{"store": {"book": [{"author": "Nigel Rees"}, {"author": "Evelyn Waugh"}]}}';
    document.getElementById('processBtn').click();
  });

  await new Promise(r => setTimeout(r, 1000));

  await page.evaluate(() => {
    const input = document.getElementById('jsonPathInput');
    input.value = '$.store.book[*].author';
    input.dispatchEvent(new Event('input'));
  });

  await new Promise(r => setTimeout(r, 1000));

  const text = await page.evaluate(() => document.getElementById('resultBox').innerText);
  console.log('ResultBox contains Nigel Rees:', text.includes('Nigel Rees'));

  await browser.close();
})();
