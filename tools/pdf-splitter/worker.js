importScripts(
    '../../assets/vendor/pdf-lib.min.js',
    '../../assets/vendor/jszip.min.js'
);

self.onmessage = async function(e) {
    const { fileBuffer, fileName, indicesToExtract, totalPages } = e.data;

    try {
        const loadedPdfDoc = await PDFLib.PDFDocument.load(fileBuffer);
        const zip = new JSZip();
        const baseName = fileName.replace(/\.pdf$/i, '');

        for (let i = 0; i < indicesToExtract.length; i++) {
            const pageIndex = indicesToExtract[i];

            // Create new PDF for single page
            const newPdf = await PDFLib.PDFDocument.create();
            const [copiedPage] = await newPdf.copyPages(loadedPdfDoc, [pageIndex]);
            newPdf.addPage(copiedPage);

            const pdfBytes = await newPdf.save();
            const pageNum = pageIndex + 1;

            // Filename padding (e.g., page_01.pdf) for correct sorting
            const pad = totalPages > 99 ? 3 : (totalPages > 9 ? 2 : 1);
            const numStr = String(pageNum).padStart(pad, '0');

            const newFileName = `${baseName}_page_${numStr}.pdf`;
            zip.file(newFileName, pdfBytes);

            const percentage = Math.round(((i + 1) / indicesToExtract.length) * 90);
            self.postMessage({ type: 'progress', percentage: percentage });
        }

        self.postMessage({ type: 'progress', percentage: 95 });
        const zipBlob = await zip.generateAsync({ type: "blob" });
        self.postMessage({ type: 'progress', percentage: 100 });

        self.postMessage({ type: 'done', zipBlob: zipBlob });

    } catch (error) {
        self.postMessage({ type: 'error', message: error.message });
    }
};