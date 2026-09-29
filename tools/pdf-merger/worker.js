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

            // An encrypted file stays encrypted inside: copied over, its pages
            // come out unreadable, even when it opens without a password
            let pdf;
            try {
                pdf = await PDFDocument.load(fileArrayBuffer);
            } catch (err) {
                if (/encrypted/i.test(err.message)) throw new Error(`"${file.name}" is encrypted. Even when it opens without a password, its contents stay locked, and this tool cannot unlock them. It leaves the file alone rather than make pages nobody can read.`);
                throw err;
            }
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