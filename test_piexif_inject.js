const piexif = require('./assets/vendor/piexif.js');

const originalBytes = new Uint8Array([
    0xFF, 0xD8, // SOI
    0xFF, 0xDA, 0x00, 0x08, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, // SOS + data
    0xFF, 0xD9 // EOI
]);
const binaryStr = String.fromCharCode.apply(null, originalBytes);
const base64Str = "data:image/jpeg;base64," + Buffer.from(originalBytes).toString('base64');

const zeroth = {};
zeroth[piexif.ImageIFD.Copyright] = "A Test Copyright Notice";
const exifObj = {"0th": zeroth, "Exif": {}, "GPS": {}};
const exifbytes = piexif.dump(exifObj);
const newImgBase64 = piexif.insert(exifbytes, base64Str);

console.log(newImgBase64);
