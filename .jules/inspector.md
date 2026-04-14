## Word & Char Counter
* The naïve text `.length` and `.split` logic fails heavily on Emojis, Zero-width spaces, and CJK text.
* Used `Intl.Segmenter` for robust character (grapheme), word, and sentence splitting.
* Wrote `tests/test-counter.js` to assert segmenter behaviour against edge cases.
