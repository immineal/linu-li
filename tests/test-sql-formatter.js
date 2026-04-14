const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '../tools/sql-formatter/index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// Extract formatQuery function
const fnMatch = html.match(/function formatQuery\(\) \{[\s\S]*?\n        \}/);
if (!fnMatch) {
    console.error("Could not find formatQuery in index.html");
    process.exit(1);
}

// Extract formatBtn click listener logic for toast tests
const btnMatch = html.match(/formatBtn\.addEventListener\('click', \(\) => \{([\s\S]*?)\}\);/);
if (!btnMatch) {
    console.error("Could not find formatBtn click listener");
    process.exit(1);
}

let outputSqlValue = "";
let inputSqlValue = "";
let languageSelectValue = "sql";
let consoleErrorOutput = "";
let toastLog = [];

global.inputSql = { get value() { return inputSqlValue; } };
global.outputSql = {
    set value(v) { outputSqlValue = v; },
    get value() { return outputSqlValue; }
};
global.languageSelect = { get value() { return languageSelectValue; } };

global.showToast = (msg, type) => { toastLog.push({ msg, type }); };

const originalConsoleError = console.error;
global.console.error = (err) => { consoleErrorOutput = err.message || err; };

// We load the actual sql-formatter to test the critical focus areas
const { format } = require('sql-formatter');
global.sqlFormatter = { format };

eval(fnMatch[0]);

function simulateBtnClick() {
    eval(btnMatch[1]);
}

function runTests() {
    let failed = 0;

    function assert(condition, message) {
        if (!condition) {
            originalConsoleError(`❌ TEST FAILED: ${message}`);
            failed++;
        } else {
            console.log(`✅ TEST PASSED: ${message}`);
        }
    }

    // 1. Empty input
    inputSqlValue = "   ";
    toastLog = [];
    let res = formatQuery();
    simulateBtnClick();
    assert(outputSqlValue === "" && res === false, "Empty input clears output and returns false");
    assert(toastLog.length === 0, "No toast shown for empty input");

    // 2. Malformed syntax handling
    inputSqlValue = "SELECT * FORM users;;;;";
    toastLog = [];
    res = formatQuery();
    simulateBtnClick();
    assert(res === true && outputSqlValue.includes("FORM"), "Malformed syntax handled gracefully (format best effort)");
    assert(toastLog.length === 1 && toastLog[0].type === 'success', "Success toast shown for best-effort format");

    // 3. Deeply nested subqueries
    inputSqlValue = "SELECT * FROM (SELECT * FROM (SELECT * FROM (SELECT * FROM users) a) b) c;";
    res = formatQuery();
    assert(res === true && outputSqlValue.split('\n').length > 10, "Deeply nested subqueries are formatted (multiple lines)");

    // 4. Preserving comments during formatting
    inputSqlValue = "SELECT * FROM users; -- this is a comment";
    res = formatQuery();
    assert(res === true && outputSqlValue.includes("-- this is a comment"), "Comments are preserved during formatting");

    // 5. Catching actual throw
    const originalFormat = global.sqlFormatter.format;
    global.sqlFormatter.format = () => { throw new Error("Mock syntax error"); };
    inputSqlValue = "SELECT 1;";
    toastLog = [];
    res = formatQuery();
    simulateBtnClick();
    assert(res === false && outputSqlValue.includes("Error formatting SQL"), "Errors are caught and output is updated");
    assert(outputSqlValue.includes("Mock syntax error"), "Error message includes detailed message");
    assert(toastLog.length === 1 && toastLog[0].type === 'error', "Error toast shown when formatting fails");
    global.sqlFormatter.format = originalFormat;

    // 6. CDN failure
    const originalSqlFormatter = global.sqlFormatter;
    global.sqlFormatter = undefined;
    inputSqlValue = "SELECT 1;";
    toastLog = [];
    res = formatQuery();
    simulateBtnClick();
    assert(res === false && outputSqlValue.includes("library failed to load"), "Missing sqlFormatter caught cleanly");
    assert(toastLog.length === 1 && toastLog[0].type === 'error', "Error toast shown when CDN fails");
    global.sqlFormatter = originalSqlFormatter;

    if (failed > 0) {
        originalConsoleError(`\n💥 ${failed} tests failed.`);
        process.exit(1);
    } else {
        console.log(`\n🎉 All tests passed successfully!`);
    }
}

runTests();
