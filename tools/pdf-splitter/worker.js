importScripts(
    '../../assets/vendor/pdf-lib.min.js',
    '../../assets/vendor/jszip.min.js'
);

self.onmessage = async function(e) {
    const data = e.data;

    try {
        if (data.action === 'extract') return await handleExtract(data);
        if (data.action === 'split')   return await handleSplit(data);
        if (data.action === 'each')    return await handleEach(data);
        self.postMessage({ type: 'error', message: 'Unknown action: ' + data.action });
    } catch (error) {
        self.postMessage({ type: 'error', message: error.message });
    }
};

async function handleExtract({ fileBuffer, indices, outputFileName, doneMessage }) {
    const srcDoc = await PDFLib.PDFDocument.load(fileBuffer);
    const outDoc = await PDFLib.PDFDocument.create();
    const copied = await outDoc.copyPages(srcDoc, indices);

    for (let i = 0; i < copied.length; i++) {
        outDoc.addPage(copied[i]);
        const percentage = Math.round(((i + 1) / copied.length) * 90);
        self.postMessage({ type: 'progress', percentage });
    }

    const bytes = await outDoc.save();
    self.postMessage({ type: 'progress', percentage: 100 });

    const outputBlob = new Blob([bytes], { type: 'application/pdf' });
    self.postMessage({ type: 'done', outputBlob, outputFileName, doneMessage });
}

async function handleSplit({ fileBuffer, parts, baseName, outputFileName, doneMessage }) {
    const srcDoc = await PDFLib.PDFDocument.load(fileBuffer);
    const zip = new JSZip();

    // Zero-pad part numbers so part_10 does not sort before part_2.
    const pad = parts.length > 99 ? 3 : (parts.length > 9 ? 2 : 1);

    for (let i = 0; i < parts.length; i++) {
        const { from, to } = parts[i];
        const indices = [];
        for (let p = from; p <= to; p++) indices.push(p - 1); // 0-based

        const partDoc = await PDFLib.PDFDocument.create();
        const copied = await partDoc.copyPages(srcDoc, indices);
        copied.forEach(page => partDoc.addPage(page));

        const bytes = await partDoc.save();
        const numStr = String(i + 1).padStart(pad, '0');
        const range = from === to ? `${from}` : `${from}-${to}`;
        zip.file(`${baseName}_part_${numStr}_pages_${range}.pdf`, bytes);

        const percentage = Math.round(((i + 1) / parts.length) * 90);
        self.postMessage({ type: 'progress', percentage });
    }

    self.postMessage({ type: 'progress', percentage: 95 });
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    self.postMessage({ type: 'progress', percentage: 100 });

    self.postMessage({ type: 'done', outputBlob: zipBlob, outputFileName, doneMessage });
}

async function handleEach({ fileBuffer, indices, totalPages, baseName, outputFileName, doneMessage }) {
    const srcDoc = await PDFLib.PDFDocument.load(fileBuffer);
    const zip = new JSZip();

    // Zero-pad by the source PDF's page count so page_10 does not sort before page_2.
    const pad = totalPages > 99 ? 3 : (totalPages > 9 ? 2 : 1);

    for (let i = 0; i < indices.length; i++) {
        const pageIndex = indices[i];

        const pageDoc = await PDFLib.PDFDocument.create();
        const [copiedPage] = await pageDoc.copyPages(srcDoc, [pageIndex]);
        pageDoc.addPage(copiedPage);

        const bytes = await pageDoc.save();
        const pageNum = pageIndex + 1;
        const numStr = String(pageNum).padStart(pad, '0');
        zip.file(`${baseName}_page_${numStr}.pdf`, bytes);

        const percentage = Math.round(((i + 1) / indices.length) * 90);
        self.postMessage({ type: 'progress', percentage });
    }

    self.postMessage({ type: 'progress', percentage: 95 });
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    self.postMessage({ type: 'progress', percentage: 100 });

    self.postMessage({ type: 'done', outputBlob: zipBlob, outputFileName, doneMessage });
}
