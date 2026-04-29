self.importScripts("../../assets/vendor/crypto-js.min.js");
self.importScripts("../../assets/vendor/sha3.min.js");
self.importScripts("blake2.min.js");

self.onmessage = function (e) {
    const file = e.data.file;
    if (!file) return;

    const chunkSize = 5 * 1024 * 1024; // 5MB chunks
    const md5Algo = CryptoJS.algo.MD5.create();
    const sha256Algo = CryptoJS.algo.SHA256.create();
    const sha512Algo = CryptoJS.algo.SHA512.create();
    const sha1Algo = CryptoJS.algo.SHA1.create();

    const sha3_256Algo = self.sha3_256.create();
    const sha3_512Algo = self.sha3_512.create();

    // blake2b context (512 bit = 64 bytes)
    const blake2bCtx = self.blakejs.blake2bInit(64, null);

    const reader = new FileReaderSync();
    let offset = 0;

    try {
        while (offset < file.size) {
            const slice = file.slice(offset, offset + chunkSize);
            const arrayBuffer = reader.readAsArrayBuffer(slice);

            // CryptoJS needs WordArray
            const wordArray = arrayBufferToWordArray(arrayBuffer);

            md5Algo.update(wordArray);
            sha256Algo.update(wordArray);
            sha512Algo.update(wordArray);
            sha1Algo.update(wordArray);

            // js-sha3 and blakejs can take ArrayBuffer directly
            sha3_256Algo.update(arrayBuffer);
            sha3_512Algo.update(arrayBuffer);

            self.blakejs.blake2bUpdate(blake2bCtx, new Uint8Array(arrayBuffer));

            offset += chunkSize;

            // Calculate progress
            const progress = Math.min(100, Math.round((offset / file.size) * 100));
            self.postMessage({ type: 'progress', progress });
        }

        self.postMessage({
            type: 'done',
            hashes: {
                sha256: sha256Algo.finalize().toString(),
                sha512: sha512Algo.finalize().toString(),
                sha1: sha1Algo.finalize().toString(),
                md5: md5Algo.finalize().toString(),
                sha3_256: sha3_256Algo.hex(),
                sha3_512: sha3_512Algo.hex(),
                blake2b: uint8ArrayToHex(self.blakejs.blake2bFinal(blake2bCtx))
            }
        });
    } catch (err) {
        self.postMessage({ type: 'error', message: err.toString() });
    }
};

function arrayBufferToWordArray(ab) {
    const u8 = new Uint8Array(ab);
    const len = u8.length;
    const words = [];
    for (let i = 0; i < len; i += 4) {
        words.push(
            (u8[i] << 24) |
            ((u8[i + 1] || 0) << 16) |
            ((u8[i + 2] || 0) << 8) |
            (u8[i + 3] || 0)
        );
    }
    return CryptoJS.lib.WordArray.create(words, len);
}

function uint8ArrayToHex(uint8arr) {
    let hexStr = '';
    for (let i = 0; i < uint8arr.length; i++) {
        let hex = (uint8arr[i] & 0xff).toString(16);
        hex = (hex.length === 1) ? '0' + hex : hex;
        hexStr += hex;
    }
    return hexStr;
}
