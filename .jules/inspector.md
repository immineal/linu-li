

## QR Code Creator
* **Bug:** Generating a QR code with an extremely long string and high error correction level caused the `qrcode` library to throw an uncaught exception, which failed to reset the UI state. The application remained stuck in a "loading" state with the previous QR code displayed and the download button still enabled for the old code. Also, format strings for vCard, Email, and WiFi had missing empty-state checks leading to malformed QR content.
* **Fix:** Wrapped the generation in robust state management: setting loading states *before* the attempt, clearing the canvas, and updating the UI accurately on `catch()`. Restructured the format building logic (`getQRData()`) to check for empty variables and properly format standard syntaxes.
* **Test:** Playwright UI test mimicking invalid input and verifying that the failure UI state correctly resets. Isolated JSDOM unit test mimicking the string formats.
