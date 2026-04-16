self.onmessage = function(e) {
    const { type, text } = e.data;
    if (!text) {
        self.postMessage({ result: '' });
        return;
    }

    let result = '';

    // We define the small words set here for Smart Title Case (AP style)
    const smallWords = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'en', 'for', 'if', 'in', 'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'v', 'vs', 'via']);

    function toWords(t) {
        return t
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/([a-zA-Z])(\d)/g, '$1 $2')
            .replace(/(\d)([a-zA-Z])/g, '$1 $2')
            .replace(/[^\p{L}\p{N}\p{Emoji_Presentation}\p{Extended_Pictographic}]+/gu, ' ')
            .trim()
            .split(/\s+/)
            .filter(w => w.length > 0);
    }

    function smartTitleCase(t) {
        // Matches sequence of letters/numbers (with internal hyphens/apostrophes) or sequence of non-letters/numbers
        const regex = /([\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*)|([^\p{L}\p{N}]+)/gu;

        let tokens = [];
        let match;
        while ((match = regex.exec(t)) !== null) {
            if (match[1]) tokens.push({ type: 'word', value: match[1] });
            else tokens.push({ type: 'nonword', value: match[2] });
        }

        let firstWordIdx = -1;
        let lastWordIdx = -1;
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].type === 'word') {
                if (firstWordIdx === -1) firstWordIdx = i;
                lastWordIdx = i;
            }
        }

        let forceCaps = true;
        let res = '';

        for (let i = 0; i < tokens.length; i++) {
            let token = tokens[i];
            if (token.type === 'word') {
                let lower = token.value.toLowerCase();
                // Check if it's not a small word, or it's first/last/forced
                if (i === firstWordIdx || i === lastWordIdx || forceCaps || !smallWords.has(lower)) {
                    res += lower.split('-').map(part => {
                        if (!part) return '';
                        return part.charAt(0).toUpperCase() + part.slice(1);
                    }).join('-');
                } else {
                    res += lower;
                }
                forceCaps = false;
            } else {
                res += token.value;
                // Force caps after terminal punctuation or start of quotes
                // The trim() isn't sufficient for single quotes right after space, e.g., " 'the"
                // token is " '"
                if (/[:.!?—]\s*$/.test(token.value) || /[\s"'([]*["'(][\s"'([]*$/.test(token.value)) {
                    forceCaps = true;
                }
            }
        }
        return res;
    }

    switch(type) {
        case 'upper':
            result = text.toUpperCase();
            break;
        case 'lower':
            result = text.toLowerCase();
            break;
        case 'smart-title':
            result = smartTitleCase(text);
            break;
        case 'title':
            result = text.toLowerCase().replace(/(?<!['’\p{L}])\p{L}/gu, s => s.toUpperCase());
            break;
        case 'sentence':
            result = text.toLowerCase().replace(/(^\s*|[.!?]\s*)([^a-z0-9\p{L}\p{N}]*)([a-z0-9\p{L}\p{N}])/gu, (match, p1, p2, p3) => p1 + p2 + p3.toUpperCase());
            break;
        case 'alternating':
            result = text.split('').map((c, i) => i % 2 === 0 ? c.toLowerCase() : c.toUpperCase()).join('');
            break;
        case 'camel':
            result = toWords(text)
                .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                .join('');
            break;
        case 'snake':
            result = toWords(text).map(w => w.toLowerCase()).join('_');
            break;
        case 'kebab':
            result = toWords(text).map(w => w.toLowerCase()).join('-');
            break;
    }

    self.postMessage({ result });
};
