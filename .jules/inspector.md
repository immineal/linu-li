## Word & Char Counter
* The naïve text `.length` and `.split` logic fails heavily on Emojis, Zero-width spaces, and CJK text.
* Used `Intl.Segmenter` for robust character (grapheme), word, and sentence splitting.
* Wrote `tests/test-counter.js` to assert segmenter behaviour against edge cases.
## JSON Workbench Render Optimization
Fixed a critical bug where rendering huge arrays or deeply nested objects in the JSON Workbench tree view threw 'Maximum call stack size exceeded' errors and froze the browser's main thread.
Instead of recursively computing and creating all DOM nodes upfront, we implemented a lazy-loading strategy. We attached a 'toggle' event listener to the details element so child nodes are only created when the user expands the node.
Furthermore, for nodes with thousands of children, we implemented chunked pagination (100 at a time) to append elements asynchronously without blocking UI interaction.
