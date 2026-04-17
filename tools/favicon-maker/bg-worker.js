self.onmessage = function(e) {
    const { action, imageData, width, height, tolerance } = e.data;

    if (action === 'removeBackground') {
        const data = imageData.data;

        // Sample the top-left corner pixel as the background color
        const bgR = data[0];
        const bgG = data[1];
        const bgB = data[2];
        const bgA = data[3];

        // If the top-left pixel is already highly transparent, we might not have a background
        if (bgA < 10) {
            self.postMessage({ action: 'removeBackground', success: true, imageData });
            return;
        }

        // Fast simple color difference threshold based on Manhattan distance
        const tol = tolerance || 30;

        // Use a flood-fill algorithm to remove continuous background color
        // This avoids removing parts of the image that happen to match the background color but are inside the foreground.
        const stack = [[0, 0]]; // Start at top-left
        const visited = new Uint8Array(width * height);

        // Also add other corners to stack just in case
        stack.push([width - 1, 0]);
        stack.push([0, height - 1]);
        stack.push([width - 1, height - 1]);

        while (stack.length > 0) {
            const [x, y] = stack.pop();
            const idx = (y * width + x) * 4;
            const vIdx = y * width + x;

            if (visited[vIdx]) continue;
            visited[vIdx] = 1;

            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const a = data[idx + 3];

            // Calculate color distance
            const dist = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);

            if (dist <= tol && a > 10) {
                // Set pixel to transparent
                data[idx + 3] = 0;

                // Add neighbors
                if (x > 0) stack.push([x - 1, y]);
                if (x < width - 1) stack.push([x + 1, y]);
                if (y > 0) stack.push([x, y - 1]);
                if (y < height - 1) stack.push([x, y + 1]);
            }
        }

        self.postMessage({ action: 'removeBackground', success: true, imageData });
    }
};
