importScripts('../../assets/vendor/pdf-lib.min.js');

self.onmessage = async (e) => {
    const files = e.data.files;
    if (!files || files.length < 2) {
        self.postMessage({ type: 'error', message: 'Please select at least 2 PDFs to merge.' });
        return;
    }

    try {
        const { PDFDocument } = PDFLib;
        const mergedPdf = await PDFDocument.create();
        const totalFiles = files.length;

        for (let i = 0; i < totalFiles; i++) {
            const file = files[i];
            const fileArrayBuffer = await file.arrayBuffer();

            // Load the source PDF, ignoring encryption to bypass owner passwords
            const pdf = await PDFDocument.load(fileArrayBuffer, { ignoreEncryption: true });
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());

            // Add each page to the new document
            copiedPages.forEach((page) => mergedPdf.addPage(page));

            // Send progress update
            const percent = Math.round(((i + 1) / totalFiles) * 90);
            self.postMessage({ type: 'progress', percent });
        }

        // Serialize the PDFDocument to bytes
        const mergedPdfBytes = await mergedPdf.save();

        // Send the final result back
        self.postMessage({ type: 'done', data: mergedPdfBytes });

    } catch (error) {
        self.postMessage({ type: 'error', message: error.message });
    }
};