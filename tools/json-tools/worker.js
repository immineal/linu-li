// Node's require() (used by tests/test-json-lossy-scan.js) has no
// importScripts — the browser worker still needs it, so guard the call.
if (typeof importScripts === 'function') {
    importScripts('../../assets/vendor/json5.min.js');
}

/* Scan the raw JSON text for things that get quietly dropped or rounded on the
   way through JSON.parse: numbers that lose precision or fall out of range,
   NaN/Infinity, and duplicate keys in the same object. Not a full parser — a
   small state machine over strings, numbers and object braces is enough to
   pick these out for a warning header. */
function scanForLossyBits(raw) {
    const warnings = [];
    let precisionLoss = false;
    let outOfRange = false;
    let sawNaNorInf = false;
    let sawNegZero = false;
    const duplicateKeys = [];

    // Stack entries mark the container we are in. Object entries carry a
    // key set and an expect state; array entries only exist so that a comma
    // inside an array does not flip the outer object's expect back to 'key'.
    const stack = [];
    let i = 0;
    const n = raw.length;

    function skipWs() { while (i < n && /\s/.test(raw[i])) i++; }

    // Skip line and block comments so JSON5 input does not trip the scanner
    function skipComments() {
        while (i < n) {
            skipWs();
            if (raw[i] === '/' && raw[i + 1] === '/') {
                while (i < n && raw[i] !== '\n') i++;
            } else if (raw[i] === '/' && raw[i + 1] === '*') {
                i += 2;
                while (i < n - 1 && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
                i += 2;
            } else {
                break;
            }
        }
    }

    function readString() {
        // Assumes raw[i] is a quote (either " or ')
        const quote = raw[i];
        let out = '';
        i++;
        while (i < n && raw[i] !== quote) {
            if (raw[i] === '\\') {
                out += raw[i];
                if (i + 1 < n) out += raw[i + 1];
                i += 2;
            } else {
                out += raw[i];
                i++;
            }
        }
        i++; // skip closing quote
        return out;
    }

    // A JSON5 unquoted key is an identifier
    function readUnquotedKey() {
        let out = '';
        while (i < n && /[A-Za-z0-9_$]/.test(raw[i])) { out += raw[i]; i++; }
        return out;
    }

    function readNumber() {
        let start = i;
        if (raw[i] === '-' || raw[i] === '+') i++;
        while (i < n && /[0-9.eE+\-]/.test(raw[i])) i++;
        return raw.substring(start, i);
    }

    function checkNumber(tok) {
        // NaN / Infinity handled elsewhere
        const num = Number(tok);
        if (!Number.isFinite(num)) { outOfRange = true; return; }
        if (num === 0 && /^-/.test(tok) && /^-?0*\.?0*(e|$)/i.test(tok.replace(/^-/, ''))) {
            // -0 tokens (e.g. "-0", "-0.0")
            if (/^-0*(?:\.0*)?(?:[eE][+\-]?\d+)?$/.test(tok)) sawNegZero = true;
        }
        // Integer precision: compare BigInt round-trip
        if (/^-?\d+$/.test(tok)) {
            try {
                const asBig = BigInt(tok);
                if (BigInt(Math.trunc(num)) !== asBig) precisionLoss = true;
            } catch (e) { /* ignore */ }
        }
    }

    while (i < n) {
        skipComments();
        if (i >= n) break;
        const c = raw[i];

        if (c === '{') {
            stack.push({ kind: 'obj', keys: new Set(), expect: 'key' });
            i++;
        } else if (c === '}') {
            stack.pop();
            i++;
        } else if (c === '[') {
            stack.push({ kind: 'arr' });
            i++;
        } else if (c === ']') {
            stack.pop();
            i++;
        } else if (c === ',') {
            const top = stack[stack.length - 1];
            if (top && top.kind === 'obj') top.expect = 'key';
            i++;
        } else if (c === ':') {
            const top = stack[stack.length - 1];
            if (top && top.kind === 'obj') top.expect = 'value';
            i++;
        } else if (c === '"' || c === "'") {
            const top = stack[stack.length - 1];
            const s = readString();
            if (top && top.kind === 'obj' && top.expect === 'key') {
                if (top.keys.has(s)) duplicateKeys.push(s);
                else top.keys.add(s);
                top.expect = 'colon';
            }
        } else if (/[A-Za-z_$]/.test(c)) {
            // NaN, Infinity, true, false, null, or an unquoted key
            const ident = readUnquotedKey();
            const top = stack[stack.length - 1];
            if (top && top.kind === 'obj' && top.expect === 'key') {
                if (top.keys.has(ident)) duplicateKeys.push(ident);
                else top.keys.add(ident);
                top.expect = 'colon';
            } else if (ident === 'NaN' || ident === 'Infinity') {
                sawNaNorInf = true;
            }
        } else if (c === '-' && /[A-Za-z]/.test(raw[i + 1])) {
            // -Infinity
            i++;
            const ident = readUnquotedKey();
            if (ident === 'Infinity') sawNaNorInf = true;
        } else if (/[-+0-9.]/.test(c)) {
            const tok = readNumber();
            checkNumber(tok);
        } else {
            i++;
        }
    }

    if (precisionLoss) warnings.push('Some integers were rounded off (JavaScript numbers lose precision past 2^53).');
    if (outOfRange) warnings.push('Numbers out of range became null.');
    if (sawNaNorInf) warnings.push('NaN and Infinity are not valid JSON and became null.');
    if (sawNegZero) warnings.push('-0 became 0.');
    if (duplicateKeys.length) {
        const list = duplicateKeys.slice(0, 3).map(k => JSON.stringify(k)).join(', ');
        warnings.push(`Duplicate keys were dropped: ${list}${duplicateKeys.length > 3 ? ', ...' : ''}. Only the last value was kept.`);
    }
    return warnings;
}

// Turn a "line:column" spot in the raw text into a snippet with a caret.
function makeErrorSnippet(raw, line, column) {
    if (!Number.isFinite(line) || line < 1) return null;
    const lines = raw.split('\n');
    const idx = line - 1;
    if (idx < 0 || idx >= lines.length) return null;
    const text = lines[idx];
    const col = Math.max(1, Math.min(text.length + 1, Number.isFinite(column) ? column : 1));
    const caret = ' '.repeat(col - 1) + '^';
    return `${text}\n${caret}`;
}

if (typeof self !== 'undefined' && self.addEventListener) self.addEventListener('message', (e) => {
    const { action, raw, indent, unescape, mode } = e.data;

    if (action === 'process') {
        try {
            let processedRaw = raw;
            let unescapeApplied = false;
            if (unescape) {
                try {
                    const temp = JSON.parse(processedRaw);
                    // Only unwrap when the inside also looks like a JSON
                    // container. A plain string literal like "hello" turning
                    // into hello was breaking parses that would otherwise work.
                    if (typeof temp === 'string' && /^\s*[\[{]/.test(temp)) {
                        processedRaw = temp;
                        unescapeApplied = true;
                    }
                } catch (e) { /* not a JSON string literal, so use it as it is */ }
            }

            // Close string values whose closing quote is missing before a line
            // break or a closing brace. JSON5 handles the rest (unquoted keys,
            // single quotes, trailing commas).
            const beforeRepair = processedRaw;
            processedRaw = processedRaw.replace(/:\s*"([^"]*?)(,\s*[\r\n]|\s*[\r\n])/g, ': "$1"$2');
            processedRaw = processedRaw.replace(/:\s*"([^"]*?)\s*}/g, ': "$1"}');
            const missingQuotesRepaired = processedRaw !== beforeRepair;

            const parsed = JSON5.parse(processedRaw);

            const warnings = [];
            // Only warn about lossy conversions if strict JSON.parse would have
            // accepted the input — otherwise the user knows something was odd.
            try {
                JSON.parse(processedRaw);
                warnings.push(...scanForLossyBits(processedRaw));
            } catch (strictErr) {
                warnings.push('Input was not strict JSON. It was repaired.');
                // Still scan for duplicate keys and precision even in repaired input
                const extra = scanForLossyBits(processedRaw);
                for (const w of extra) if (!warnings.includes(w)) warnings.push(w);
            }
            if (missingQuotesRepaired) {
                const msg = 'A missing closing quote was patched — check the result.';
                if (!warnings.includes(msg)) warnings.push(msg);
            }
            if (unescapeApplied) warnings.push('Unescape Strings was on: the input was unwrapped from a JSON string literal first.');

            if (mode === 'csv') {
                if (!Array.isArray(parsed)) {
                    throw new Error('CSV export needs an array at the top level');
                }
                const headers = Array.from(new Set(parsed.flatMap(o => o ? Object.keys(o) : [])));
                const csvRows = [headers.join(',')];
                for (const row of parsed) {
                    if (!row) continue;
                    const values = headers.map(header => {
                        let val = row[header];
                        if (val === null || val === undefined) return '';
                        // For nested cells: JSON.stringify keeps quotes as ", the
                        // generic quoting below doubles them once. Doubling here
                        // as well quadrupled the quotes.
                        if (typeof val === 'object') val = JSON.stringify(val);
                        val = String(val);
                        if (val.includes(',') || val.includes('"') || val.includes('\n')) val = `"${val.replace(/"/g, '""')}"`;
                        return val;
                    });
                    csvRows.push(values.join(','));
                }
                self.postMessage({ success: true, action: 'process', parsed, resultText: csvRows.join('\n'), warnings });
            } else {
                const space = indent === 'tab' ? '\t' : (indent === 'min' ? 0 : parseInt(indent));
                const jsonString = JSON.stringify(parsed, null, space);

                let highlightedHtml = null;
                if (indent !== 'min' && jsonString.length < 500000) { // the highlighting regex stalls on larger input
                    let html = jsonString.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    highlightedHtml = html.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
                        let cls = 'color: var(--ink);';
                        if (/^"/.test(match)) {
                            if (/:$/.test(match)) cls = 'color: #9c27b0; font-weight: 700;';
                            else cls = 'color: var(--accent-secondary);';
                        } else if (/true|false/.test(match)) cls = 'color: var(--accent); font-weight: bold;';
                        else if (/null/.test(match)) cls = 'color: var(--ink-secondary); font-style: italic;';
                        else cls = 'color: #d35400;';
                        return '<span style="' + cls + '">' + match + '</span>';
                    });
                }

                self.postMessage({ success: true, action: 'process', parsed, resultText: jsonString, highlightedHtml: highlightedHtml, warnings });
            }
        } catch (err) {
            let lineNumber = null;
            let columnNumber = null;

            if (err.lineNumber !== undefined) {
                lineNumber = err.lineNumber;
            }
            if (err.columnNumber !== undefined) {
                columnNumber = err.columnNumber;
            }

            const snippet = makeErrorSnippet(raw, lineNumber, columnNumber);

            self.postMessage({
                success: false,
                error: err.message,
                lineNumber: lineNumber,
                columnNumber: columnNumber,
                snippet: snippet
            });
        }
    } else if (action === 'formatOnly') {
        const { parsedData, indent, mode } = e.data;
        try {
            if (mode === 'csv') {
                if (!Array.isArray(parsedData)) {
                    throw new Error('CSV export needs an array at the top level');
                }
                const headers = Array.from(new Set(parsedData.flatMap(o => o ? Object.keys(o) : [])));
                const csvRows = [headers.join(',')];
                for (const row of parsedData) {
                    if (!row) continue;
                    const values = headers.map(header => {
                        let val = row[header];
                        if (val === null || val === undefined) return '';
                        // Same fix as above: leave the quote doubling to the
                        // generic escape step; a preemptive replace quadrupled them.
                        if (typeof val === 'object') val = JSON.stringify(val);
                        val = String(val);
                        if (val.includes(',') || val.includes('"') || val.includes('\n')) val = `"${val.replace(/"/g, '""')}"`;
                        return val;
                    });
                    csvRows.push(values.join(','));
                }
                self.postMessage({ success: true, action: 'formatOnly', parsed: parsedData, resultText: csvRows.join('\n') });
            } else {
                const space = indent === 'tab' ? '\t' : (indent === 'min' ? 0 : parseInt(indent));
                const jsonString = JSON.stringify(parsedData, null, space);

                let highlightedHtml = null;
                if (indent !== 'min' && jsonString.length < 500000) { // the highlighting regex stalls on larger input
                    let html = jsonString.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    highlightedHtml = html.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
                        let cls = 'color: var(--ink);';
                        if (/^"/.test(match)) {
                            if (/:$/.test(match)) cls = 'color: #9c27b0; font-weight: 700;';
                            else cls = 'color: var(--accent-secondary);';
                        } else if (/true|false/.test(match)) cls = 'color: var(--accent); font-weight: bold;';
                        else if (/null/.test(match)) cls = 'color: var(--ink-secondary); font-style: italic;';
                        else cls = 'color: #d35400;';
                        return '<span style="' + cls + '">' + match + '</span>';
                    });
                }

                self.postMessage({
                    success: true,
                    action: 'formatOnly',
                    parsed: parsedData,
                    resultText: jsonString,
                    highlightedHtml: highlightedHtml
                });
            }
        } catch (err) {
            self.postMessage({
                success: false,
                error: err.message
            });
        }
    }
});

// Exposed for the node-side unit tests, which run this file with require().
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { scanForLossyBits, makeErrorSnippet };
}
