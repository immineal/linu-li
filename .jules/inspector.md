
### Smart Compressor (Image Compressor) - Edge Case Defenses
- When building vanilla JS file processing pipelines, always add defensive size checks (`file.size > 0`) early in the `handleFiles` logic to prevent zero-byte files from breaking WebAssembly compressors.
- For `<img>` elements driven by `URL.createObjectURL(file)`, always attach an `onerror` handler to catch corrupt or unsupported files that bypass basic MIME type filtering.
- In UI workflows with asynchronous processing (like sliders driving compression), use a `processId` variable (e.g., `let singleProcessId = 0`) to detect and discard stale Promise resolutions, preventing race conditions where a slow operation overrides a newer, faster one.
