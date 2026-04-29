importScripts('../../assets/vendor/diff.min.js');
importScripts('../../assets/vendor/highlight.min.js');

// Helper for Highlighting
function formatCode(code, language) {
    if (!code || code.trim() === '') return code || ' ';
    try {
        if (language !== 'plaintext' && typeof hljs !== 'undefined') {
            return hljs.highlight(code, { language }).value;
        }
    } catch (e) { }
    // Fallback: simple escape
    return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { formatCode };
}

self.onmessage = function(e) {
    const { text1, text2, mode, ignoreSpace } = e.data;

    let diffObj = null;
    let language = 'plaintext';

    // Detect Language for formatting (only if we have right side text)
    if (text2 && typeof text2 === 'string') {
        try {
            const detected = hljs.highlightAuto(text2.slice(0, 1000));
            language = detected.language || 'plaintext';
        } catch (err) {
            console.error("Worker highlight detection error", err);
        }
    }

    try {
        if (mode === 'json') {
            const j1 = text1 ? JSON.stringify(JSON.parse(text1), null, 4) : '';
            const j2 = text2 ? JSON.stringify(JSON.parse(text2), null, 4) : '';
            diffObj = Diff.diffLines(j1, j2);
        }
        else if (mode === 'lines') {
            diffObj = ignoreSpace ? Diff.diffTrimmedLines(text1, text2) : Diff.diffLines(text1, text2);
        }
        else if (mode === 'words') {
            diffObj = ignoreSpace ? Diff.diffWords(text1, text2) : Diff.diffWordsWithSpace(text1, text2);
        }
        else {
            diffObj = Diff.diffChars(text1, text2);
        }
    } catch (e) {
        self.postMessage({ error: e.message || 'Error generating diff' });
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
                codeHtml: formatCode(line, language)
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
                left: leftBuffer[i] !== undefined ? formatCode(leftBuffer[i], language) : null,
                right: rightBuffer[i] !== undefined ? formatCode(rightBuffer[i], language) : null
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
            lines.forEach(l => sideRows.push({ type: 'neutral', left: formatCode(l, language), right: formatCode(l, language) }));
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
