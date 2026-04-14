## 2026-04-14 - [PDF Watermarker Baseline Alignment]
**Bug:** PDF Y coordinates map top-down from HTML percentages, but \`pdf-lib\` draws text from the bottom-left baseline.
**Action:** Subtract the embedded font's \`heightAtSize(fontSize)\` from the PDF Y coordinate to perfectly align the watermark with the HTML preview.
