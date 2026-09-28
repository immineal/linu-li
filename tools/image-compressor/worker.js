const CDN_BASE = 'https://esm.sh/@jsquash';

const modules = {};

async function loadModule(name) {
    if (modules[name]) return modules[name];
    try {
        const module = await import(`${CDN_BASE}/${name}?module`);
        modules[name] = module;
        return module;
    } catch (e) {
        throw new Error(`Failed to load codec ${name}: ${e.message}`);
    }
}

self.onmessage = async (e) => {
    const { id, imageData, format, options } = e.data;

    try {
        let resultBuffer;
        
        switch (format) {
            case 'image/webp': {
                const { encode } = await loadModule('webp');
                resultBuffer = await encode(imageData, {
                    quality: options.quality,
                    method: 3, 
                });
                break;
            }
            case 'image/avif': {
                const { encode } = await loadModule('avif');

                // For AVIF the page's slider sets encoder speed (0-10), not
                // quality, so options.quality arrives here as a speed.
                // Quality stays fixed at cqLevel 33.
                resultBuffer = await encode(imageData, {
                    cqLevel: 33,
                    speed: options.quality,
                    // 4:2:0. Without it some images came out black and white.
                    subsample: 1,
                });
                break;
            }
            case 'image/jpeg': {
                const { encode } = await loadModule('jpeg');
                resultBuffer = await encode(imageData, {
                    quality: options.quality,
                    optimizeCoding: true,
                    smoothing: 0,
                    colorSpace: 3,
                });
                break;
            }
            case 'image/png': {
                const { encode } = await loadModule('png');
                resultBuffer = await encode(imageData, {
                    level: 2, 
                    interlace: false,
                });
                break;
            }
            default:
                throw new Error(`Unsupported format: ${format}`);
        }

        self.postMessage({
            id,
            success: true,
            buffer: resultBuffer
        }, [resultBuffer]);

    } catch (error) {
        console.error("Worker Compression Error:", error);
        self.postMessage({
            id,
            success: false,
            error: error.message
        });
    }
};