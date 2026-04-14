importScripts('https://unpkg.com/json5@2/dist/index.min.js');

self.addEventListener('message', (e) => {
    const { action, raw, indent, unescape, mode } = e.data;

    if (action === 'process') {
        try {
            let processedRaw = raw;
            if (unescape) {
                try {
                    const temp = JSON.parse(processedRaw);
                    if (typeof temp === 'string') processedRaw = temp;
                } catch (e) { /* Ignore */ }
            }

            // Aggressive Repair
            processedRaw = processedRaw.replace(/:\s*"([^"]*?)(,\s*[\r\n]|\s*[\r\n])/g, ': "$1"$2');
            processedRaw = processedRaw.replace(/:\s*"([^"]*?)\s*}/g, ': "$1"}');

            const parsed = JSON5.parse(processedRaw);

            if (mode === 'csv') {
                if (!Array.isArray(parsed)) {
                    throw new Error('CSV requires an Array');
                }
                const headers = Array.from(new Set(parsed.flatMap(o => o ? Object.keys(o) : [])));
                const csvRows = [headers.join(',')];
                for (const row of parsed) {
                    if (!row) continue;
                    const values = headers.map(header => {
                        let val = row[header];
                        if (val === null || val === undefined) return '';
                        if (typeof val === 'object') val = JSON.stringify(val).replace(/"/g, '""');
                        val = String(val);
                        if (val.includes(',') || val.includes('"') || val.includes('\n')) val = `"${val.replace(/"/g, '""')}"`;
                        return val;
                    });
                    csvRows.push(values.join(','));
                }
                self.postMessage({ success: true, action: 'process', parsed, resultText: csvRows.join('\n') });
            } else {
                const space = indent === 'tab' ? '\t' : (indent === 'min' ? 0 : parseInt(indent));
                const jsonString = JSON.stringify(parsed, null, space);

                let highlightedHtml = null;
                if (indent !== 'min' && jsonString.length < 500000) { // Only syntax highlight if reasonable size (~500kb)
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

                self.postMessage({ success: true, action: 'process', parsed, resultText: jsonString, highlightedHtml: highlightedHtml });
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

            self.postMessage({
                success: false,
                error: err.message,
                lineNumber: lineNumber,
                columnNumber: columnNumber
            });
        }
    } else if (action === 'formatOnly') {
        const { parsedData, indent, mode } = e.data;
        try {
            if (mode === 'csv') {
                if (!Array.isArray(parsedData)) {
                    throw new Error('CSV requires an Array');
                }
                const headers = Array.from(new Set(parsedData.flatMap(o => o ? Object.keys(o) : [])));
                const csvRows = [headers.join(',')];
                for (const row of parsedData) {
                    if (!row) continue;
                    const values = headers.map(header => {
                        let val = row[header];
                        if (val === null || val === undefined) return '';
                        if (typeof val === 'object') val = JSON.stringify(val).replace(/"/g, '""');
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
                if (indent !== 'min' && jsonString.length < 500000) { // Only syntax highlight if reasonable size (~500kb)
                    // Basic syntax highlight in worker
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
