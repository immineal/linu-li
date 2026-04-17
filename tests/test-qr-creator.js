const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const htmlPath = path.join(__dirname, '../tools/qr-creator/index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// Strip layout.js script to prevent errors when running JSDOM
let testHtmlContent = htmlContent.replace(/<script src="..\/..\/assets\/js\/layout.js"><\/script>/g, '');

const dom = new JSDOM(testHtmlContent, {
    url: "http://localhost",
    runScripts: "dangerously",
    beforeParse(window) {
        window.URL.createObjectURL = () => "mock-url";
        window.workers = [];
        window.Worker = class {
            constructor(url) {
                this.url = url;
                this.messages = [];
                window.workers.push(this);
            }
            postMessage(msg) {
                this.messages.push(msg);
            }
        };
    }
});

const window = dom.window;
const document = window.document;

// Mock some things layout.js usually provides
window.showToast = function() {};
window.HTMLElement.prototype.scrollIntoView = function() {};

dom.window.addEventListener("load", () => {
    let failed = 0;

    function assert(condition, message) {
        if (!condition) {
            console.error(`❌ TEST FAILED: ${message}`);
            failed++;
        } else {
            console.log(`✅ TEST PASSED: ${message}`);
        }
    }

    try {
        console.log("Running QR Creator Logic Tests...");

        const getQRData = window.getQRData;
        const generateQR = window.generateQR;

        // --- getQRData Tests ---

        // 1. Text mode
        document.getElementById("qrMode").value = "text";
        document.getElementById("qrInput").value = "https://example.com";
        assert(getQRData() === "https://example.com", "getQRData returns correct text/url");

        // 2. WiFi mode
        document.getElementById("qrMode").value = "wifi";
        document.getElementById("wifiSSID").value = "MyNet";
        document.getElementById("wifiPass").value = "pass123";
        document.getElementById("wifiType").value = "WPA";
        document.getElementById("wifiHidden").value = "false";
        assert(getQRData() === "WIFI:S:MyNet;T:WPA;P:pass123;;", "getQRData returns correct WiFi WPA string");

        // WiFi WEP, hidden
        document.getElementById("wifiType").value = "WEP";
        document.getElementById("wifiHidden").value = "true";
        assert(getQRData() === "WIFI:S:MyNet;T:WEP;P:pass123;H:true;;", "getQRData returns correct WiFi WEP hidden string");

        // WiFi nopass
        document.getElementById("wifiType").value = "nopass";
        document.getElementById("wifiHidden").value = "false";
        assert(getQRData() === "WIFI:S:MyNet;T:nopass;;", "getQRData returns correct WiFi nopass string");

        // 3. Contact mode
        document.getElementById("qrMode").value = "contact";
        document.getElementById("vName").value = "John";
        document.getElementById("vLast").value = "Doe";
        document.getElementById("vPhone").value = "12345";
        document.getElementById("vEmail").value = "j@d.com";
        document.getElementById("vOrg").value = "Acme";

        const expectedVCard = "BEGIN:VCARD\nVERSION:3.0\nN:Doe;John;;;\nFN:John Doe\nORG:Acme\nTEL;TYPE=CELL:12345\nEMAIL:j@d.com\nEND:VCARD";
        assert(getQRData() === expectedVCard, "getQRData returns correct vCard string");

        // 4. Email mode
        document.getElementById("qrMode").value = "email";
        document.getElementById("mailTo").value = "test@test.com";
        document.getElementById("mailSub").value = "Hello";
        document.getElementById("mailBody").value = "World";

        assert(getQRData() === "mailto:test@test.com?subject=Hello&body=World", "getQRData returns correct mailto string");

        // --- generateQR Tests ---

        // Setup text for generateQR test
        document.getElementById("qrMode").value = "text";
        document.getElementById("qrInput").value = "test-qr";

        // Reset worker messages
        const worker = window.workers[0];
        worker.messages = [];

        generateQR();

        assert(worker.messages.length === 1, "generateQR posts a message to the Web Worker");
        const msg = worker.messages[0];
        assert(msg.text === "test-qr", "generateQR sends correct text to worker");
        assert(msg.targetLevel === document.getElementById("errorLevel").value, "generateQR sends correct error level to worker");

        // Test missing data (empty input)
        document.getElementById("qrInput").value = "";
        worker.messages = [];
        generateQR();

        assert(worker.messages.length === 0, "generateQR does not post message when data is empty");
        assert(document.getElementById("downloadPng").disabled === true, "generateQR disables download button on empty data");

        if (failed > 0) {
            console.error(`\n💥 ${failed} tests failed.`);
            process.exit(1);
        } else {
            console.log(`\n🎉 All tests passed successfully!`);
            process.exit(0);
        }
    } catch (e) {
        console.error('❌ Test execution failed:', e);
        process.exit(1);
    }
});
