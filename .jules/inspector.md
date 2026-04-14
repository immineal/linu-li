## Asset Extractor
* Large PDFs can cause OOM crashes due to loaded object URLs and cached pages. `page.cleanup()` and `pdf.destroy()` must be called.
* Object URLs generated via `URL.createObjectURL` are not garbage collected automatically. They must be explicitly revoked when resetting state.
* PDF streams can be corrupted, missing `width` or `height` attributes, leading to exceptions. Defensive programming is necessary (`if (!img || !img.width) return;`).
