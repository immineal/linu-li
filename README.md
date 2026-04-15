# linu-li

A bunch of browser-based tools for everyday stuff — PDF editing, image processing, dev utilities, etc. Everything runs locally in your browser, no uploads, no tracking.

**Live:** [linu.li](https://linu.li)

![Privacy](https://img.shields.io/badge/Privacy-100%25%20Client--Side-green)
![PWA](https://img.shields.io/badge/PWA-Offline%20Ready-blue)
![License](https://img.shields.io/badge/license-%20%20GNU%20GPLv3%20-lightgray)

## Why

Most online tools for things like PDF merging or image compression work by uploading your files to some server. I didn't really want that, so this is all client-side — WebAssembly and vanilla JS, nothing leaves your machine.

No analytics, no ads, no cookies. Also works offline as a PWA.

## Tools

### PDF
- **PDF Merger** — drag-and-drop, reorder pages, combine
- **PDF Splitter** — split by page ranges or explode into single pages
- **Asset Extractor** — pull embedded images out of PDFs
- **2-Up** — put two pages side by side (booklet-style)
- **Grayscale** — rasterize to B&W for printing
- **Watermarker** — stamp text onto pages

### Images
- **Smart Compressor** — WebP/AVIF compression via WASM
- **Bulk Resizer** — batch resize, keeps aspect ratio
- **Social Cropper** — crop for 16:9, 4:5, circle masks, etc.
- **EXIF Scrubber** — view and strip metadata (GPS, camera info)
- **Favicon Creator** — generate `.ico`/`.png` from text or image
- **SVG Rasterizer** — SVG to high-res PNG

### Text
- **Word Counter** — character/word/reading time stats
- **Diff Checker** — side-by-side or inline text diff
- **Markdown Live** — editor with live preview and HTML export
- **List Cleaner** — dedup, sort, shuffle, trim
- **Case Converter** — camelCase, snake_case, Title Case, etc.
- **Lorem Generator** — Latin, tech-babble, corporate-speak

### Dev
- **JSON Workbench** — validate, repair, minify, tree view
- **SQL Prettifier** — format messy queries
- **JWT Debugger** — decode headers/payloads, checks expiry
- **URL Tools** — encode/decode, strip tracking params (UTM, fbclid)
- **Base64** — file-to-base64, text-to-base64
- **Epoch Converter** — unix timestamp ↔ human readable

### Misc
- **Password Gen** — uses Web Crypto API, no bias
- **QR Creator** — WiFi, vCard, URL
- **Unit Converter** — length, weight, temp, speed, data
- **Hash Generator** — SHA-256, MD-5, SHA-512
- **Aspect Ratio** — calc dimensions for video/images
- **Color Tools** — picker, converter, WCAG contrast checker

---

## Stack

Plain HTML, CSS, JS. No build step, no bundler, no framework. Just open it.

Libraries used:
- `pdf-lib`, `pdf.js`, `jspdf` — PDF stuff
- `cropperjs`, `piexifjs` — image handling
- `dayjs` — dates
- `marked` — Markdown parsing
- `sql-formatter`, `json5`, `jsdiff` — text/code tools
- Web Crypto API + `crypto-js` — hashing/crypto

## Running locally

Needs to be served over HTTP (ES modules + service worker don't work on `file://`).

```bash
git clone https://github.com/immineal/linu-li.git
cd linu-li

# python
python -m http.server 8000

# or node
npx serve .
```

Then open `http://localhost:8000`.

## Deployment

GitHub Actions deploys to All-Inkl via FTP on every push to `main`. Config is in `.github/workflows/deploy.yml`.

If you want to use your own server: add an `FTP_PASSWORD` secret in the repo settings and update the `server`/`username` fields in the workflow file.

## Project structure

```
/
├── assets/
│   ├── css/        # global styles
│   ├── js/         # layout, PWA registration
│   └── fonts/      # self-hosted
├── tools/          # one folder per tool, each with its own index.html
├── index.html      # main dashboard
├── sw.js           # service worker
└── manifest.json   # PWA manifest
```

## License

[GNU GPL v3](LICENSE)
