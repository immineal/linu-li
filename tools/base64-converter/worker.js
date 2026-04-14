self.onmessage = async function(e) {
    const { file } = e.data;
    const chunkSize = 3 * 1024 * 1024; // 3MB multiples for perfect Base64 padding (since 3 bytes = 4 b64 chars)
    let offset = 0;

    // Base64 chars
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

    function encodeBase64Chunk(bytes, isLast) {
        let result = '';
        const len = bytes.length;
        const remainder = len % 3;
        const end = len - remainder;

        // Process in multiples of 3
        for (let i = 0; i < end; i += 3) {
            result += chars[bytes[i] >> 2];
            result += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
            result += chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
            result += chars[bytes[i + 2] & 63];
        }

        // Handle padding for the final chunk
        if (isLast && remainder > 0) {
            if (remainder === 1) {
                result += chars[bytes[end] >> 2];
                result += chars[(bytes[end] & 3) << 4];
                result += '==';
            } else if (remainder === 2) {
                result += chars[bytes[end] >> 2];
                result += chars[((bytes[end] & 3) << 4) | (bytes[end + 1] >> 4)];
                result += chars[(bytes[end + 1] & 15) << 2];
                result += '=';
            }
        }
        return result;
    }

    try {
        while (offset < file.size) {
            const slice = file.slice(offset, offset + chunkSize);
            const buffer = await slice.arrayBuffer();
            const uint8Array = new Uint8Array(buffer);

            const isLast = (offset + chunkSize) >= file.size;
            const base64Chunk = encodeBase64Chunk(uint8Array, isLast);

            self.postMessage({ type: 'chunk', chunk: base64Chunk });
            offset += chunkSize;
        }

        self.postMessage({ type: 'done' });
    } catch (err) {
        self.postMessage({ type: 'error', error: err.message });
    }
};
