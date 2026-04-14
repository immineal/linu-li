
### PDF Splitter Debugging
* Unhandled promise rejections or logic errors (like a user entering an invalid range) in the UI state can leave elements locked. Always defensively reset buttons (`splitBtn.disabled = false`) and progress bars in `finally` blocks so users don't have to refresh the page.
* When working with filenames, avoid using simple string replacements like `replace('.pdf', '')` as they can falsely match the substring in the middle of a filename and are case-sensitive. Always use defensive regex matching the end of the string like `/\.pdf$/i`.
