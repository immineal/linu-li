function countSyllables(word) {
    word = word.toLowerCase();
    word = word.replace(/[^a-z]/g, '');
    if (!word) return 0;
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');
    const syllables = word.match(/[aeiouy]{1,2}/g);
    return syllables ? syllables.length : 1;
}

const words = ["hello", "world", "beautiful", "sentence", "syllable", "the", "are", "some", "testing"];
words.forEach(w => console.log(w, countSyllables(w)));
