const assert = require('assert');

// Mock PDF-lib logic testing purely math offset
const height = 500;
const posY = 0.5;
const fontSize = 50;

// Fake font mock
const helveticaFont = { heightAtSize: (size) => size };
const textHeight = helveticaFont.heightAtSize(fontSize);

// The actual bug fix formula:
const pdfY = height - (height * posY) - textHeight;

// Expected behavior: baseline drops by textHeight
assert.strictEqual(pdfY, 200, 'Baseline offset correctly calculated');
console.log('✅ Math offset logic verified');
