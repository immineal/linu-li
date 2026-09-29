/* A stream you can read with `for await`. pdf.js 6 reads the text of a page
   that way, and in its worker the data it inflates, but Safari (WebKit, so
   every browser on an iPhone) cannot iterate a ReadableStream yet, and the
   "legacy" build of pdf.js does not fill that in. Without this the PDF
   extractor found no text at all in Safari. Loaded before pdf.js, in the page
   by assets/js/pdfjs.js and in the worker by pdfjs-worker.js. */
if (typeof ReadableStream === 'function' && !ReadableStream.prototype[Symbol.asyncIterator]) {
    ReadableStream.prototype[Symbol.asyncIterator] = async function* () {
        const reader = this.getReader();
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) return;
                yield value;
            }
        } finally {
            reader.releaseLock();
        }
    };
}
