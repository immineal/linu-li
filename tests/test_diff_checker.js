const fs = require('fs');
const { JSDOM } = require('jsdom');
const Diff = require('diff');

const html = fs.readFileSync('tools/diff-checker/index.html', 'utf8');

const dom = new JSDOM(html, { runScripts: "dangerously" });
const window = dom.window;
const document = window.document;

window.Diff = Diff;
window.showToast = (msg, type) => { console.log('Toast:', msg); };
window.HTMLElement.prototype.scrollIntoView = function() {};

const scriptContent = Array.from(document.querySelectorAll('script')).find(s => !s.src).textContent;

dom.window.eval(scriptContent);

const viewSideBtn = document.getElementById('viewSide');
const viewInlineBtn = document.getElementById('viewInline');

console.log("Switching view before any action:");
try {
  viewSideBtn.click();
  console.log("Success! No error thrown.");
} catch (e) {
  console.error("Error thrown:", e.message);
}

const clearBtn = document.getElementById('clearBtn');
const compareBtn = document.getElementById('compareBtn');
const inputOriginal = document.getElementById('inputOriginal');
const inputChanged = document.getElementById('inputChanged');

inputOriginal.value = 'a';
inputChanged.value = 'b';
compareBtn.click();
console.log("Compare executed. Table rows:", document.getElementById('diffTable').querySelectorAll('tr').length);

clearBtn.click();
console.log("Clear executed.");
try {
  viewInlineBtn.click();
  console.log("Switching view after clear: Success! No error thrown.");
} catch (e) {
  console.error("Switching view after clear Error thrown:", e.message);
}
