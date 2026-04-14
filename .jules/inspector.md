## Learnings for Markdown Live
1. `marked.parse` natively allows raw HTML which can easily be an XSS vector. Always combine it with `DOMPurify.sanitize`.
2. When binding keyboard inputs to a heavy synchronous process like markdown parsing and DOM update, wrapping the logic in a debounce `setTimeout` prevents dropped frames and main thread blocking.
3. Added a basic regression test `tools/markdown-editor/test.js` to ensure the XSS and parsing logic remains robust.
