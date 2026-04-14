

## Epoch Converter
- When dynamically categorizing timestamp inputs as seconds or milliseconds based on magnitude limits (e.g. `< 10 billion = seconds`), ensure `Math.abs()` is applied to the timestamp before checking the limit. Otherwise, valid negative millisecond epochs (dates before 1970) will evaluate as `true` and incorrectly be treated as seconds, drastically shifting the parsed date into the past.
- If JSDOM hangs or times out while loading external CDN scripts for testing, a reliable fallback for unit testing vanilla JS logic is to read the target HTML file, extract the specific logic block using regular expressions, and evaluate it directly in a Node.js script using temporarily installed dependencies.
