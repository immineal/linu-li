const fs = require('fs');
const piexif = require('./assets/vendor/piexif.js');

const zeroth = {};
const exif = {};
const gps = {};
zeroth[piexif.ImageIFD.Make] = "Make";
zeroth[piexif.ImageIFD.Copyright] = "My Copyright";
const exifObj = {"0th": zeroth, "Exif": exif, "GPS": gps};
const exifbytes = piexif.dump(exifObj);
console.log(exifbytes.slice(0, 50));
