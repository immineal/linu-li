
### PDF Splitter Debugging
* Unhandled promise rejections or logic errors (like a user entering an invalid range) in the UI state can leave elements locked. Always defensively reset buttons (`splitBtn.disabled = false`) and progress bars in `finally` blocks so users don't have to refresh the page.
* When working with filenames, avoid using simple string replacements like `replace('.pdf', '')` as they can falsely match the substring in the middle of a filename and are case-sensitive. Always use defensive regex matching the end of the string like `/\.pdf$/i`.

### List Sanitizer Debugging
* `String.split('\n')` on massive strings generates a huge array that can freeze the UI and consume too much memory. To safely count lines in large inputs without freezing, use a highly optimized regex like `(val.match(/\n/g) || []).length + 1` which traverses strings faster, along with a debounce to prevent locking the UI thread during repeated key events.
* When working with array randomizer functions, the native implementation `items.sort(() => Math.random() - 0.5)` produces biased pseudo-random sorts and behaves poorly on large arrays due to sorting engine heuristics. To ensure a robust, genuinely randomized sort, implement a modern Fisher-Yates shuffle algorithm instead.
