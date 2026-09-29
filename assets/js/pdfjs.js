/* pdf.js for the PDF tools. Since version 4 it only comes as an ES module,
   and the tools' own scripts are plain ones, so this loads the module and
   hands it over as window.pdfjsLib.

   pdfOeffnen(options) is getDocument with the paths filled in: the wasm
   decoders for JPEG 2000 and JBIG2 images and for colour profiles, the CMYK
   profile, the standard fonts for PDFs that do not embed them and the
   character maps for CJK text. Each is only fetched when a PDF needs it.
   It resolves to the loading task, so callers still reach .promise and
   .destroy().

   JPEGs are decoded by pdf.js itself, not by the browser's ImageDecoder.
   Chrome's applies a colour profile embedded in the JPEG, where the PDF's own
   colour space is what counts; Firefox and every other viewer go by the PDF,
   so with the browser decoder the same page came out in other colours in
   Chrome than anywhere else.

   And no OffscreenCanvas. pdf.js prepares images on one when the browser has
   it, and in Safari (WebKit) images drawn that way can come out empty: with
   pdf.js 3 the compressor's preview lost whole photos, and with pdf.js 6 the
   extractor handed out small images that were fully transparent. Drawing on
   an ordinary canvas costs nothing noticeable. */
(function () {
    'use strict';
    const hier = document.currentScript.src;
    const basis = new URL('../vendor/pdfjs-6.3.289/', hier).href;

    window.pdfjsBereit = import(new URL('pdfjs-lesbar.js', hier).href)
        .then(() => import(basis + 'pdf.min.js'))
        .then((lib) => {
            lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-worker.js', hier).href;
            window.pdfjsLib = lib;
            return lib;
        });

    window.pdfOeffnen = async (options) => {
        const lib = await window.pdfjsBereit;
        return lib.getDocument({
            wasmUrl: basis + 'wasm/',
            iccUrl: basis + 'iccs/',
            standardFontDataUrl: basis + 'standard_fonts/',
            cMapUrl: basis + 'cmaps/',
            cMapPacked: true,
            isImageDecoderSupported: false,
            isOffscreenCanvasSupported: false,
            ...options,
        });
    };
})();
