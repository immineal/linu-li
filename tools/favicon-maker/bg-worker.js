self.onmessage = function(e) {
    const { action, imageData, width, height, tolerance } = e.data;

    if (action === 'removeBackground') {
        const data = imageData.data;

        // The top-left pixel is taken as the background colour.
        const bgR = data[0];
        const bgG = data[1];
        const bgB = data[2];
        const bgA = data[3];

        // A corner that is already transparent means there is no background to remove.
        if (bgA < 10) {
            self.postMessage({ action: 'removeBackground', success: true, imageData });
            return;
        }

        // Colour distance is the Manhattan distance in RGB.
        const tol = tolerance || 30;

        // Flood fill from the edges, so a patch of the same colour inside the
        // subject stays.
        const stack = [[0, 0]];
        const visited = new Uint8Array(width * height);

        // All four corners, in case the subject touches one of them.
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

            const dist = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);

            if (dist <= tol && a > 10) {
                data[idx + 3] = 0;

                if (x > 0) stack.push([x - 1, y]);
                if (x < width - 1) stack.push([x + 1, y]);
                if (y > 0) stack.push([x, y - 1]);
                if (y < height - 1) stack.push([x, y + 1]);
            }
        }

        self.postMessage({ action: 'removeBackground', success: true, imageData });
    }
};
