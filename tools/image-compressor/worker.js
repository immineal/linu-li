// tools/image-compressor/worker.js

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
                
                // AVIF Logic Update:
                // 'options.quality' contains the Speed value (0-10) directly from the slider.
                // We pass this directly to the 'speed' parameter.
                
                resultBuffer = await encode(imageData, {
                    // Standard visual quality baseline. 
                    // 33 is a balanced mid-point.
                    cqLevel: 33, 
                    
                    // Directly use the slider value (0-10)
                    speed: options.quality,
                    
                    // Force 4:2:0 subsampling to prevent Black & White issues
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