importScripts('https://cdnjs.cloudflare.com/ajax/libs/jsdiff/5.1.0/diff.min.js');
importScripts('https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js');

self.onmessage = function(e) {
    const { text1, text2, mode, ignoreSpace } = e.data;

    let diffObj = null;
    let language = 'plaintext';

    // Parse JSON if needed BEFORE highlighting
    let rawA = text1 || '';
    let rawB = text2 || '';

    if (mode === 'json') {
        try {
            rawA = rawA ? JSON.stringify(JSON.parse(rawA), null, 4) : '';
        } catch(e) {}
        try {
            rawB = rawB ? JSON.stringify(JSON.parse(rawB), null, 4) : '';
        } catch(e) {}
    }

    // Detect Language for formatting
    if (rawB && typeof rawB === 'string') {
        try {
            const detected = hljs.highlightAuto(rawB.slice(0, 1000));
            language = detected.language || 'plaintext';
        } catch (err) {
            console.error("Worker highlight detection error", err);
        }
    }

    // Helper to safely highlight or escape
    const processCode = (code) => {
        if (!code || code.trim() === '') return code || ' ';
        try {
            if (language !== 'plaintext') {
                return hljs.highlight(code, { language }).value;
            }
        } catch (err) { }
        // Fallback: full escape including quotes
        return code.replace(/[&<>'"]/g, tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag));
    };

    let hlA = processCode(rawA);
    let hlB = processCode(rawB);

    try {
        if (mode === 'lines' || mode === 'json') {
            diffObj = ignoreSpace ? Diff.diffTrimmedLines(hlA, hlB) : Diff.diffLines(hlA, hlB);
        }
        else if (mode === 'words') {
            diffObj = ignoreSpace ? Diff.diffWords(hlA, hlB) : Diff.diffWordsWithSpace(hlA, hlB);
        }
        else {
            diffObj = Diff.diffChars(hlA, hlB);
        }
    } catch (err) {
        self.postMessage({ error: err.message || 'Error generating diff' });
        return;
    }

    // Calculate Inline Rows
    const inlineRows = [];
    let lineNumLeft = 1;
    let lineNumRight = 1;

    diffObj.forEach(part => {
        const lines = part.value.split('\n');
        if (lines.length > 1 && lines[lines.length-1] === '') lines.pop();

        const typeClass = part.added ? 'diff-row-add' : (part.removed ? 'diff-row-del' : 'diff-row-neutral');

        lines.forEach(line => {
            inlineRows.push({
                typeClass,
                numL: part.added ? '' : lineNumLeft++,
                numR: part.removed ? '' : lineNumRight++,
                codeHtml: line || ' '
            });
        });
    });

    // Calculate Side-by-Side Rows
    let sideRows = [];
    let leftBuffer = [];
    let rightBuffer = [];

    function flushBuffers() {
        const max = Math.max(leftBuffer.length, rightBuffer.length);
        for (let i = 0; i < max; i++) {
            sideRows.push({
                type: (leftBuffer[i] !== undefined && rightBuffer[i] !== undefined) ? 'change' : (leftBuffer[i] !== undefined ? 'del' : 'add'),
                left: leftBuffer[i] !== undefined ? (leftBuffer[i] || ' ') : null,
                right: rightBuffer[i] !== undefined ? (rightBuffer[i] || ' ') : null
            });
        }
        leftBuffer.length = 0;
        rightBuffer.length = 0;
    }

    diffObj.forEach(part => {
        const lines = part.value.split('\n');
        if (lines.length > 1 && lines[lines.length-1] === '') lines.pop();

        if (part.removed) {
            leftBuffer.push(...lines);
        } else if (part.added) {
            rightBuffer.push(...lines);
        } else {
            flushBuffers();
            lines.forEach(l => sideRows.push({ type: 'neutral', left: l || ' ', right: l || ' ' }));
        }
    });
    flushBuffers();

    let sLineL = 1;
    let sLineR = 1;
    sideRows = sideRows.map(row => {
        return {
            ...row,
            numL: row.left !== null ? sLineL++ : '',
            numR: row.right !== null ? sLineR++ : ''
        };
    });

    self.postMessage({
        inlineRows,
        sideRows
    });
};
