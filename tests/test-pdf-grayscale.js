const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync('tools/pdf-grayscale/index.html', 'utf8');
const workerCodeMatch = html.match(/const workerCode = `([\s\S]*?)`;/);
const workerCode = workerCodeMatch[1];
const extractedCode = workerCode.replace(/self\.onmessage\s*=\s*function\(e\)\s*{[\s\S]*?};/, '');
eval(extractedCode);

function createTestImage(width, height, drawLine) {
    const data = new Uint8Array(width * height * 4);
    // Fill with white (bg)
    for (let i = 0; i < data.length; i += 4) {
        data[i] = 255;
        data[i+1] = 255;
        data[i+2] = 255;
        data[i+3] = 255;
    }

    // Draw black line(s)
    drawLine(data, width, height);
    return data;
}

function setPixel(data, width, x, y, r, g, b, a = 255) {
    if (x >= 0 && x < width && y >= 0 && y < (data.length / 4 / width)) {
        const i = (y * width + x) * 4;
        data[i] = r;
        data[i+1] = g;
        data[i+2] = b;
        data[i+3] = a;
    }
}

function drawRotatedTextLines(data, w, h, angleDeg) {
    const angleRad = angleDeg * Math.PI / 180;
    const cx = w/2, cy = h/2;

    // Several "text" lines spanning across
    for (let offset = -100; offset <= 100; offset += 30) {
        // Draw dashed lines to simulate words better than solid line
        for(let x = 50; x < w - 50; x++) {
            if (x % 20 < 5) continue; // word gaps
            const y = Math.round(cy + offset + (x - cx) * Math.tan(angleRad));
            setPixel(data, w, x, y, 0, 0, 0);
            setPixel(data, w, x, y+1, 0, 0, 0);
        }
    }
}

let imgData, angle;

console.log("Testing calculateDeskewAngle...");

// 1. 0 deg
imgData = createTestImage(400, 400, (data, w, h) => drawRotatedTextLines(data, w, h, 0));
angle = calculateDeskewAngle(imgData, 400, 400);
console.log("0 deg angle:", angle);
assert.ok(Math.abs(angle) < 0.5, "0 degree input should return angle near 0");

// 2. +2 deg (returns angle that straightens it -> -2)
imgData = createTestImage(400, 400, (data, w, h) => drawRotatedTextLines(data, w, h, 2));
angle = calculateDeskewAngle(imgData, 400, 400);
console.log("+2 deg line straightened angle:", angle);
assert.ok(Math.abs(angle + 2) < 0.5, "+2 degree input should return angle near -2");

// 3. -3 deg (returns angle that straightens it -> +3)
imgData = createTestImage(400, 400, (data, w, h) => drawRotatedTextLines(data, w, h, -3));
angle = calculateDeskewAngle(imgData, 400, 400);
console.log("-3 deg line straightened angle:", angle);
assert.ok(Math.abs(angle - 3) < 0.5, "-3 degree input should return angle near +3");

// 4. Blank image (should return 0)
imgData = createTestImage(400, 400, () => {}); // blank
angle = calculateDeskewAngle(imgData, 400, 400);
console.log("Blank image angle:", angle);
assert.ok(Math.abs(angle) < 0.1, "Blank image should return 0");

console.log("All calculateDeskewAngle tests passed.");
