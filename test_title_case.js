function convert(type, text) {
    if (!text) return '';

    let result = '';
    switch(type) {
        case 'title':
            // Instead of just spaces, hyphens, underscores, let's capitalize any letter that is NOT preceded by another letter or an apostrophe.
            // Lookbehind: (?<!['’\p{L}])\p{L}
            result = text.toLowerCase().replace(/(?<!['’\p{L}])\p{L}/gu, s => s.toUpperCase());
            break;
    }
    return result;
}

console.log('title "it\'s a test":', convert('title', "it's a test"));
console.log('title "hello \\"world\\"":', convert('title', 'hello "world"'));
console.log('title "(hello) /world/":', convert('title', '(hello) /world/'));
