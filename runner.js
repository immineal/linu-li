const fs = require('fs');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;

const html = fs.readFileSync('test_regression_pdf2up.html', 'utf8');

// Use external pdf-lib via CDN or local minified
const dom = new JSDOM(html, {
  runScripts: "dangerously",
  resources: "usable",
  url: "http://localhost/"
});

dom.window.console.log = (...args) => console.log('JSDOM LOG:', ...args);
dom.window.console.error = (...args) => console.error('JSDOM ERROR:', ...args);

setTimeout(() => {
    if (dom.window.document.body.innerHTML.includes('All regression tests passed!')) {
        console.log("Success confirmed via runner");
        process.exit(0);
    } else {
        console.error("Test failure detected in runner");
        process.exit(1);
    }
}, 3000);
