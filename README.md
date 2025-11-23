# Linus Linhof Toolbox

A curated suite of **privacy-first** web utilities for developers, creatives, and everyday users.

**Live Site:** [linu.li](https://linu.li)

![Privacy](https://img.shields.io/badge/Privacy-100%25%20Client--Side-green)
![PWA](https://img.shields.io/badge/PWA-Offline%20Ready-blue)
![License](https://img.shields.io/badge/license-%20%20GNU%20GPLv3%20-lightgray)

## Philosophy

Most online tools (PDF mergers, image compressors) require you to upload your files to a remote server. This creates privacy risks and data compliance issues.

**This Toolbox is different.**
*   **No Server Uploads:** All processing happens locally in your browser using WebAssembly and JavaScript.
*   **No Tracking:** No analytics, no ads, no cookies.
*   **Offline Capable:** Installs as a PWA and works without an internet connection.

## The Tools

### PDF Tools
*   **PDF Merger:** Combine multiple documents with drag-and-drop reordering.
*   **PDF Splitter:** Explode documents or extract specific page ranges.
*   **Asset Extractor:** Scrape high-res images embedded inside PDFs.
*   **PDF 2-Up:** Arrange pages side-by-side (booklet mode).
*   **Grayscale Converter:** Rasterize pages to black & white for printing.
*   **Watermarker:** Stamp text overlays on documents.

### Image Tools
*   **Smart Compressor:** Intelligent WebP/AVIF compression via WebAssembly.
*   **Bulk Resizer:** Resize batches of images while maintaining aspect ratio.
*   **Social Cropper:** Crop and mask for social media (16:9, 4:5, Circle).
*   **EXIF Scrubber:** View and strip hidden metadata (GPS, Camera settings).
*   **Favicon Creator:** Generate `.ico` and `.png` icons from text or images.
*   **SVG Rasterizer:** Convert vector files to high-res PNGs.

### Text & Writing
*   **Word Counter:** Deep analysis with reading time estimation.
*   **Diff Checker:** Compare text/code to find changes.
*   **Markdown Live:** Editor with instant preview and HTML export.
*   **List Cleaner:** Deduplicate, sort, randomize, and trim lists.
*   **Case Converter:** Title Case, camelCase, snake_case, etc.
*   **Lorem Generator:** Generate text in Latin, Tech-babble, or Corporate-speak.

###  Developer Tools
*   **JSON Workbench:** Validate, repair, minify, and view JSON as a tree.
*   **SQL Prettifier:** Format messy SQL queries.
*   **JWT Debugger:** Decode tokens to inspect headers/payloads.
*   **URL Tools:** Encode/Decode and strip tracking parameters (UTM, fbclid).
*   **Base64 Converter:** File-to-Base64 and Text-to-Base64.
*   **Epoch Converter:** Unix timestamp translation.

### Daily Utilities
*   **Password Gen:** Cryptographically strong, client-side generation.
*   **QR Creator:** WiFi, vCard, and URL codes.
*   **Unit Converter:** Length, Weight, Temp, Speed, and Data storage.
*   **Hash Generator:** Calculate SHA-256, MD5, and SHA-512.
*   **Aspect Ratio:** Calculate dimensions for video/images.
*   **Color Tools:** Picker, converter, and WCAG contrast checker.

---

## Technical Stack

This project is built with **Vanilla HTML, CSS, and JavaScript**. No build steps (like Webpack or Vite) are required to run it, making it extremely lightweight and easy to host.

**Key Libraries:**
*   **PDF Manipulation:** `pdf-lib`, `pdf.js`, `jspdf`
*   **Image Processing:** `cropperjs`, `piexifjs`
*   **Time/Date:** `dayjs`
*   **Code/Text:** `marked` (Markdown), `sql-formatter`, `json5`, `jsdiff`
*   **Crypto:** Native Web Crypto API + `crypto-js` (legacy support)

## Local Development

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/linuslinhof/toolbox.git
    cd toolbox
    ```

2.  **Run a local server:**
    Because the project uses ES Modules and Service Workers, it must be served over HTTP, not `file://`.
    ```bash
    # Python 3
    python -m http.server 8000

    # OR Node.js
    npx serve .
    ```

3.  **Open in browser:**
    Go to `http://localhost:8000`

## Deployment

This project uses **GitHub Actions** to automatically deploy to **All-Inkl** hosting via FTP/FTPS.

### How it works:
1.  The workflow is defined in `.github/workflows/deploy.yml`.
2.  On every `push` to the `main` branch, the action triggers.
3.  It uses `SamKirkland/FTP-Deploy-Action` to sync only changed files to the server.

### Setup for Forkers:
If you want to deploy this to your own FTP server:
1.  Go to repository **Settings** > **Secrets and variables** > **Actions**.
2.  Add a new secret named `FTP_PASSWORD`.
3.  Update the `server` and `username` fields in `.github/workflows/deploy.yml`.

---

## Project Structure

```
/
├── assets/
│   ├── css/        # Global styles and variables
│   ├── js/         # Layout logic, PWA registration
│   └── fonts/      # Self-hosted fonts
├── tools/          # One folder per tool (index.html within each)
├── index.html      # Main dashboard
├── sw.js           # Service Worker for offline support
└── manifest.json   # PWA Manifest
```

## License

This project is open source and available under the [GNU GPL v3 License](LICENSE).
