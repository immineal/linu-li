importScripts('../../assets/vendor/pdf-lib.min.js');

self.onmessage = async (e) => {
    const files = e.data.files;
    if (!files || files.length < 2) {
        self.postMessage({ type: 'error', message: 'Add at least two PDFs.' });
        return;
    }

    try {
        const { PDFDocument } = PDFLib;
        const mergedPdf = await PDFDocument.create();
        const totalFiles = files.length;

        for (let i = 0; i < totalFiles; i++) {
            const file = files[i];
            const fileArrayBuffer = await file.arrayBuffer();

            // ignoreEncryption lets through files that only carry an owner password (no printing, no copying)
            const pdf = await PDFDocument.load(fileArrayBuffer, { ignoreEncryption: true });
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());

            copiedPages.forEach((page) => mergedPdf.addPage(page));

            // The last 10% is left for save()
            const percent = Math.round(((i + 1) / totalFiles) * 90);
            self.postMessage({ type: 'progress', percent });
        }

        const mergedPdfBytes = await mergedPdf.save();

        self.postMessage({ type: 'done', data: mergedPdfBytes });

    } catch (error) {
        self.postMessage({ type: 'error', message: error.message });
    }
};