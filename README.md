# linu-li

Small tools that run in a browser tab. Merging a PDF, stripping the GPS out of a photo, decoding a JWT: the sort of thing you look up, use once, and close again.

Live at [linu.li](https://linu.li).

## Why

Search for "merge PDF" and every result wants the file uploaded first. For a scanned contract or a photo of somebody's passport that is an odd thing to agree to, and the sites that ask usually surround the button with three ads and a newsletter box.

Browsers have been able to do this work by themselves for years, so these do. The file you pick never goes anywhere. There are no accounts, no analytics and no cookies, and once you have opened the site it keeps working on a train with no signal.

Five things do reach outside, and none of them carries your file. The EXIF tool and the Bonn map load map tiles from OpenStreetMap. The image compressor pulls its WebP and AVIF codecs from esm.sh. The timestamp tool fetches a date parser from jsDelivr the first time you ask it to read plain language. The unit converter asks two servers for exchange rates, always the whole table, so the request says nothing about what you are converting. The contact form posts to Formspree. [The privacy policy](https://linu.li/privacy.html) names all five and says what each one receives.

## The tools

### PDF

- [Merger](tools/pdf-merger/) combines files and lets you drag pages into order first
- [Splitter](tools/pdf-splitter/) cuts by page range, or explodes a file into one PDF per page
- [Image extractor](tools/pdf-extractor/) pulls out every image embedded in a PDF
- [2-up](tools/pdf-2up/) puts two pages on one sheet for booklets
- [Grayscale](tools/pdf-grayscale/) flattens colour to black and white, which also cleans up phone scans
- [Watermarker](tools/pdf-watermarker/) stamps text across every page

### Images

- [Compressor](tools/image-compressor/) shrinks photos to WebP or AVIF with a before-and-after slider
- [Bulk resizer](tools/image-resizer/) resizes a whole batch and keeps the aspect ratio
- [Social cropper](tools/social-cropper/) crops to the ratios Instagram, Twitter and LinkedIn expect
- [EXIF remover](tools/exif-scrubber/) shows the location and camera data hidden in a photo before it strips it
- [Favicon generator](tools/favicon-maker/) builds `.ico` and `.png` icons from text, an emoji or an image
- [SVG to PNG](tools/svg-to-png/) renders a vector file at whatever resolution you need

### Text

- [Word counter](tools/word-counter/) counts words, characters and sentences, and estimates reading time
- [Diff checker](tools/diff-checker/) highlights what changed between two texts, side by side or inline
- [Markdown editor](tools/markdown-editor/) previews as you type and exports HTML
- [List cleaner](tools/list-cleaner/) removes duplicates, sorts, shuffles and trims
- [Case converter](tools/case-converter/) moves text between camelCase, snake_case, Title Case and the rest
- [Lorem generator](tools/lorem-generator/) makes filler text in Latin, tech jargon or corporate speak

### Developer

- [JSON tools](tools/json-tools/) validate, repair, minify and show a collapsible tree
- [SQL formatter](tools/sql-formatter/) tidies up a query you inherited
- [JWT decoder](tools/jwt-debugger/) reads the header and payload and tells you whether it has expired
- [URL tools](tools/url-tools/) encode, decode, and strip tracking junk such as `utm_source` and `fbclid`
- [Base64](tools/base64-converter/) converts text or a whole file, both directions
- [Timestamp converter](tools/time-converter/) turns Unix epochs into dates and back, across time zones
- [Hash generator](tools/hash-generator/) gives you SHA-256, SHA-512 or MD5 of text or a file
- [Password generator](tools/pw-generator/) uses the Web Crypto API, so the randomness is real

### Everything else

- [QR generator](tools/qr-creator/) for links, WiFi credentials and contact cards
- [Colour tools](tools/color-tools/) pick, convert between HEX, RGB and HSL, and check WCAG contrast
- [Aspect ratio calculator](tools/aspect-ratio/) works out the missing side
- [Unit converter](tools/unit-converter/) handles length, weight, temperature, speed, storage and currency
- [Future euro banknotes](tools/future-bank-notes/) is a German gallery of the ten ECB design proposals, with a way to compare and rate them

### Two bigger ones

The [Bühnenbild-Planer](tools/buehnenbild/) is a German planner for stage crews and the largest thing here. You build a running order of scenes, name the places a piece keeps returning to, and lay props out on a stage with wings and curtains. Out of that it prints two documents: A4 ground plans carrying nothing but the drawing, and an *Umbauplan*, a table of what gets struck, set up and moved between every pair of scenes. Props come with oblique illustrations as well as plan-view symbols. There is a guided setup on the first visit and an explanation behind every setting, because the people using it are not the people who built it.

The [Bonn Sperrmüll map](tools/sperrmuell/) shows which streets get a bulky-waste collection on which day, from the city's open data. It covers 185 dates in 2026. It sits with the other tools but stays its own app, with its own build and its own service worker, so it comes up on a phone while you are standing in front of the pile with no signal.

## Addresses

Every tool answers at two of them: `linu.li/tools/qr-creator/` and the short `linu.li/qr-creator/`, which redirects to the first. Nothing has to be registered for that — the server checks whether a directory of that name sits under `tools/` — so a new tool is reachable both ways the day it lands. The sitemap names one address per tool, the long one.

The Bonn map used to live at `linu.li/sperrmuell/` and now answers under `tools/` like everything else. The old address redirects, with a single exception: `/sperrmuell/sw.js` still serves a small worker whose only job is to unregister the one that address installed. A service worker script is never fetched through a redirect — the browser reads that as a failed update and keeps what it has — so without that file the old worker would go on serving the old copy of the map out of its cache and never learn about the move.

## How it is built

Plain HTML, CSS and JavaScript. No bundler, no framework, no build step: what is in the repository is what the server sends, and each tool is one self-contained `index.html`. The Bonn map is the exception, a Vite build whose output is committed.

Libraries sit in `assets/vendor/` and are served from here rather than a CDN, so a tool keeps working on a day when someone else's CDN does not. pdf-lib, pdf.js and jsPDF do the PDF work. Cropper.js and piexif handle images, marked and DOMPurify render Markdown safely, jsdiff finds the differences between two texts, sql-formatter reprints queries, and JSONPath runs the queries in the JSON tool. Leaflet draws the map in the EXIF tool. Day.js does dates, JSZip packs up downloads of more than one file, and hashing goes through the Web Crypto API, with crypto-js and sha3 filling in algorithms the browser does not offer. Both fonts, Libre Baskerville and Space Grotesk, are self-hosted as well.

## Running it locally

It has to be served over HTTP. Service workers and ES modules do not work from `file://`, and without the service worker a good half of the site behaves oddly.

```bash
git clone https://github.com/immineal/linu-li.git
cd linu-li
npx serve . --listen 3000
```

Then open `http://localhost:3000`.

There are three test suites, and four conventions that will bite you if nobody warned you about them. Both are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Deployment

A push to `main` runs the tests. If they come back green, a second workflow mirrors the checkout to All-Inkl over FTP. The two used to run alongside each other, which meant a red test run never stopped anything from going live. Now the deploy waits.

It needs three secrets: `FTP_SERVER`, `FTP_USER` and `FTP_PASSWORD`. The rest is in `.github/workflows/deploy.yml`, including the step that stamps the deployed commit into the service worker. Without that stamp the worker is byte-identical after every deploy, the browser sees no reason to fetch a new one, and people keep running whatever they downloaded the first time. That is how this site spent the better part of a year serving code it had already fixed.

## Layout

```
assets/
  css/          global styles
  fonts/        Libre Baskerville and Space Grotesk, self-hosted
  js/           shared layout, service worker registration, update prompt
  vendor/       third-party libraries
  manifest.json PWA manifest
tools/          one folder per tool, each a standalone page
  sperrmuell/   the Bonn map, its own app with its own build and worker
sperrmuell/     the map's old address: one worker that retires itself
tests/          the suites, see CONTRIBUTING.md
index.html      the front page
sw.js           service worker, has to sit at the root to cover the whole site
```

## License

[GNU GPL v3](LICENSE).
