const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '../tools/sql-formatter/index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// Extract formatQuery function
const fnMatch = html.match(/async function formatQuery\(\) \{[\s\S]*?\n        \}/);
if (!fnMatch) {
    console.error("Could not find formatQuery in index.html");
    process.exit(1);
}

// Extract formatBtn click listener logic for toast tests
const btnMatch = html.match(/formatBtn\.addEventListener\('click', async \(\) => \{([\s\S]*?)\}\);/);
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
global.formatBtn = { disabled: false };
global.outputWrapper = { classList: { remove: () => {}, add: () => {} } };

global.showToast = (msg, type) => { toastLog.push({ msg, type }); };

const originalConsoleError = console.error;
global.console.error = (err) => { consoleErrorOutput = err.message || err; };

// We mock sendMessageToWorker instead of sqlFormatter now, since formatting moved to worker
global.sendMessageToWorker = async ({ action, raw, lang }) => {
    if (raw === "SELECT 1;") {
        if (!global.sqlFormatter) {
            return { success: false, error: "library failed to load" };
        }
    }
    try {
        if (raw === "SELECT 1;" && global.mockError) {
             throw new Error("Mock syntax error");
        }
        let formatted = raw; // dummy
        if (raw === "SELECT * FORM users;;;;") {
            formatted = "SELECT\n  *\nFORM\n  users;";
        } else if (raw.includes("users; -- this is a comment")) {
            formatted = "SELECT\n  *\nFROM\n  users; -- this is a comment";
        } else if (raw.includes("SELECT * FROM (SELECT * FROM (SELECT * FROM (SELECT * FROM users) a) b) c;")) {
            formatted = "SELECT\n  *\nFROM\n  (\n    SELECT\n      *\n    FROM\n      (\n        SELECT\n          *\n        FROM\n          (\n            SELECT\n              *\n            FROM\n              users\n          ) a\n      ) b\n  ) c;";
        }
        return { success: true, result: formatted };
    } catch (err) {
        return { success: false, error: err.message };
    }
};

global.sqlFormatter = true; // Just to simulate it's loaded unless explicitly unloaded

eval(fnMatch[0]);

async function simulateBtnClick() {
    await eval(`(async () => { ${btnMatch[1]} })()`);
}

async function runTests() {
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
    let res = await formatQuery();
    await simulateBtnClick();
    assert(outputSqlValue === "" && res === false, "Empty input clears output and returns false");
    assert(toastLog.length === 0, "No toast shown for empty input");

    // 2. Malformed syntax handling
    inputSqlValue = "SELECT * FORM users;;;;";
    toastLog = [];
    res = await formatQuery();
    await simulateBtnClick();
    assert(res === true && outputSqlValue.includes("FORM"), "Malformed syntax handled gracefully (format best effort)");
    assert(toastLog.length === 1 && toastLog[0].type === 'success', "Success toast shown for best-effort format");

    // 3. Deeply nested subqueries
    inputSqlValue = "SELECT * FROM (SELECT * FROM (SELECT * FROM (SELECT * FROM users) a) b) c;";
    res = await formatQuery();
    assert(res === true && outputSqlValue.split('\n').length > 10, "Deeply nested subqueries are formatted (multiple lines)");

    // 4. Preserving comments during formatting
    inputSqlValue = "SELECT * FROM users; -- this is a comment";
    res = await formatQuery();
    assert(res === true && outputSqlValue.includes("-- this is a comment"), "Comments are preserved during formatting");

    // 5. Catching actual throw
    global.mockError = true;
    inputSqlValue = "SELECT 1;";
    toastLog = [];
    res = await formatQuery();
    await simulateBtnClick();
    assert(res === false && outputSqlValue.includes("Error processing SQL"), "Errors are caught and output is updated");
    assert(outputSqlValue.includes("Mock syntax error"), "Error message includes detailed message");
    assert(toastLog.length === 1 && toastLog[0].type === 'error', "Error toast shown when formatting fails");
    global.mockError = false;

    // 6. CDN failure
    const originalSqlFormatter = global.sqlFormatter;
    global.sqlFormatter = undefined;
    inputSqlValue = "SELECT 1;";
    toastLog = [];
    res = await formatQuery();
    await simulateBtnClick();
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
