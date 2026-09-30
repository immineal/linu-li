if (typeof importScripts === 'function') {
    importScripts('../../assets/vendor/diff.min.js');
    importScripts('../../assets/vendor/highlight.min.js');
}

function formatCode(code, language) {
    if (!code || code.trim() === '') return code || ' ';
    try {
        if (language !== 'plaintext' && typeof hljs !== 'undefined') {
            return hljs.highlight(code, { language }).value;
        }
    } catch (e) { }
    return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Turn diff library output into a per-line, side-by-side row list. Word- and
// character-level highlights sit inside their original line, so a two-line
// input never comes back as fifty rows and the line numbers still match the
// input. `inner` is 'words', 'chars' or null.
function rowsFromLineDiff(linesDiff, inner, formatCodeFn, language, ignoreSpace) {
    const inlineRows = [];
    const sideRows = [];
    let lineNumLeft = 1;
    let lineNumRight = 1;

    // Split a chunk's value into its lines. The diff library ends non-trailing
    // parts with '\n', so a naive split leaves an empty tail — drop it.
    function splitLines(text) {
        const arr = text.split('\n');
        if (arr[arr.length - 1] === '') arr.pop();
        return arr;
    }

    // A tab against four spaces looks identical on screen. When the changed
    // segment is only whitespace, render tabs as → and spaces as · so the
    // difference is visible instead of a phantom highlight.
    function visualiseWhitespace(escaped) {
        return escaped
            .replace(/\t/g, '<span class="ws-marker">&#8594;</span>')
            .replace(/ /g, '<span class="ws-marker">&middot;</span>');
    }
    function innerHtml(left, right) {
        if (!inner) return { left: formatCodeFn(left, language), right: formatCodeFn(right, language) };
        const parts = (inner === 'chars')
            ? Diff.diffChars(left, right)
            : (ignoreSpace ? Diff.diffWords(left, right) : Diff.diffWordsWithSpace(left, right));
        let l = '', r = '';
        parts.forEach(p => {
            let esc = escapeHtml(p.value);
            // Only mark ws visibly if the whole diff chunk is whitespace, so
            // ordinary text keeps its normal look.
            const onlyWs = /^\s+$/.test(p.value);
            if (p.added) r += `<span class="inline-add">${onlyWs ? visualiseWhitespace(esc) : esc}</span>`;
            else if (p.removed) l += `<span class="inline-del">${onlyWs ? visualiseWhitespace(esc) : esc}</span>`;
            else { l += esc; r += esc; }
        });
        return { left: l, right: r };
    }

    let i = 0;
    while (i < linesDiff.length) {
        const part = linesDiff[i];
        const lines = splitLines(part.value);

        if (!part.added && !part.removed) {
            lines.forEach(line => {
                const html = formatCodeFn(line, language);
                inlineRows.push({ typeClass: 'diff-row-neutral', numL: lineNumLeft, numR: lineNumRight, codeHtml: html });
                sideRows.push({ type: 'neutral', numL: lineNumLeft, numR: lineNumRight, left: html, right: html });
                lineNumLeft++;
                lineNumRight++;
            });
            i++;
            continue;
        }

        if (part.removed) {
            const next = linesDiff[i + 1];
            const leftLines = lines;
            const rightLines = (next && next.added) ? splitLines(next.value) : [];
            const maxN = Math.max(leftLines.length, rightLines.length);
            for (let k = 0; k < maxN; k++) {
                const ll = leftLines[k];
                const rl = rightLines[k];
                if (ll !== undefined && rl !== undefined) {
                    const { left, right } = innerHtml(ll, rl);
                    inlineRows.push({ typeClass: 'diff-row-del', numL: lineNumLeft, numR: '', codeHtml: left });
                    inlineRows.push({ typeClass: 'diff-row-add', numL: '', numR: lineNumRight, codeHtml: right });
                    sideRows.push({ type: 'change', numL: lineNumLeft, numR: lineNumRight, left, right });
                    lineNumLeft++;
                    lineNumRight++;
                } else if (ll !== undefined) {
                    const h = formatCodeFn(ll, language);
                    inlineRows.push({ typeClass: 'diff-row-del', numL: lineNumLeft, numR: '', codeHtml: h });
                    sideRows.push({ type: 'del', numL: lineNumLeft, numR: '', left: h, right: null });
                    lineNumLeft++;
                } else {
                    const h = formatCodeFn(rl, language);
                    inlineRows.push({ typeClass: 'diff-row-add', numL: '', numR: lineNumRight, codeHtml: h });
                    sideRows.push({ type: 'add', numL: '', numR: lineNumRight, left: null, right: h });
                    lineNumRight++;
                }
            }
            i += (next && next.added) ? 2 : 1;
            continue;
        }

        // Only-added (no preceding removed)
        lines.forEach(line => {
            const h = formatCodeFn(line, language);
            inlineRows.push({ typeClass: 'diff-row-add', numL: '', numR: lineNumRight, codeHtml: h });
            sideRows.push({ type: 'add', numL: '', numR: lineNumRight, left: null, right: h });
            lineNumRight++;
        });
        i++;
    }

    return { inlineRows, sideRows };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { formatCode, rowsFromLineDiff };
}

if (typeof self !== 'undefined' && self.addEventListener) self.onmessage = function(e) {
    const { text1, text2, mode, ignoreSpace } = e.data;

    const formatCache = new Map();
    function cachedFormatCode(code, lang) {
        const key = lang + '|' + code;
        if (formatCache.has(key)) return formatCache.get(key);
        const res = formatCode(code, lang);
        formatCache.set(key, res);
        return res;
    }

    let linesDiff = null;
    let inner = null;
    let language = 'plaintext';

    // Language is guessed from the new version only, and from its first
    // thousand characters, because highlightAuto tries every grammar it has.
    if (text2 && typeof text2 === 'string') {
        try {
            const detected = hljs.highlightAuto(text2.slice(0, 1000));
            language = detected.language || 'plaintext';
        } catch (err) {
            console.error('Language detection failed', err);
        }
    }

    try {
        if (mode === 'json') {
            const j1 = text1 ? JSON.stringify(JSON.parse(text1), null, 4) : '';
            const j2 = text2 ? JSON.stringify(JSON.parse(text2), null, 4) : '';
            linesDiff = Diff.diffLines(j1, j2);
        } else if (mode === 'lines') {
            linesDiff = ignoreSpace ? Diff.diffTrimmedLines(text1, text2) : Diff.diffLines(text1, text2);
        } else if (mode === 'words') {
            // Line-diff first so the line numbers survive, then a word-level
            // inner diff inside each pair of changed lines.
            linesDiff = ignoreSpace ? Diff.diffTrimmedLines(text1, text2) : Diff.diffLines(text1, text2);
            inner = 'words';
        } else {
            linesDiff = ignoreSpace ? Diff.diffTrimmedLines(text1, text2) : Diff.diffLines(text1, text2);
            inner = 'chars';
        }
    } catch (e) {
        self.postMessage({ error: e.message || 'Error generating diff' });
        return;
    }

    const { inlineRows, sideRows } = rowsFromLineDiff(linesDiff, inner, cachedFormatCode, language, ignoreSpace);

    self.postMessage({ inlineRows, sideRows });
};
