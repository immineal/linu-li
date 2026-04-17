const fs = require('fs');

function stripAllMetadataAndInjectCopyright(arrayBuffer, copyrightText) {
    const bytes = new Uint8Array(arrayBuffer);
    let segments = [];
    let i = 0;

    if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
        throw new Error("Not a valid JPEG");
    }

    segments.push(bytes.slice(0, 2));
    i = 2;

    while (i < bytes.length) {
        if (bytes[i] === 0xFF) {
            let marker = bytes[i + 1];

            if (marker === 0xFF) {
                i++;
                continue;
            }

            if ((marker >= 0xD0 && marker <= 0xD9) || marker === 0x01) {
                segments.push(bytes.slice(i, i + 2));
                i += 2;
                if (marker === 0xD9) break; // EOI
                continue;
            }

            if (marker === 0xDA) {
                segments.push(bytes.slice(i));
                break;
            }

            let length = (bytes[i + 2] << 8) | bytes[i + 3];

            let keep = true;
            if (marker === 0xE1) { // APP1 (EXIF, XMP)
                keep = false;
            } else if (marker === 0xED) { // APP13 (IPTC / Photoshop)
                keep = false;
            } else if (marker === 0xFE) { // COM (Comment)
                keep = false;
            }

            if (keep) {
                segments.push(bytes.slice(i, i + 2 + length));
            }

            i += 2 + length;
        } else {
            segments.push(bytes.slice(i));
            break;
        }
    }

    let totalLen = segments.reduce((sum, seg) => sum + seg.length, 0);
    let cleanBytes = new Uint8Array(totalLen);
    let offset = 0;
    for (let seg of segments) {
        cleanBytes.set(seg, offset);
        offset += seg.length;
    }

    return cleanBytes;
}

// Generate a dummy JPEG
const dummyJpeg = new Uint8Array([
    0xFF, 0xD8, // SOI
    0xFF, 0xE1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66, // APP1
    0xFF, 0xED, 0x00, 0x04, 0x12, 0x34, // APP13
    0xFF, 0xDA, 0x00, 0x08, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, // SOS + data
    0xFF, 0xD9 // EOI
]);

try {
    const res = stripAllMetadataAndInjectCopyright(dummyJpeg.buffer, "");
    console.log("Original length:", dummyJpeg.length);
    console.log("Stripped length:", res.length);
    console.log("Hex:", Buffer.from(res).toString('hex'));
} catch (e) {
    console.error(e);
}
