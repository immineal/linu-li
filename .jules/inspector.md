# URL Cleaner & Encoder 🕵️ Inspector Notes
- **Bug/Vulnerability**: Missing explicit protocol handling caused `new URL()` to immediately crash and reject valid naked domains (e.g. `www.amazon.com`).
- **Edge Case**: Aggressively encoded URLs (`https%253A%252F%252F...`) failed because `decodeURIComponent` was only called once. Fixed by adding a bounded `while` loop (up to 5 attempts) to defensively decode.
- **Data Loss**: Custom platform URL reconstruction (for Amazon, YouTube, etc.) accidentally dropped hash fragments because `url.hash` was not explicitly appended to the interpolated template literal strings. Fixed by ensuring it is retained.
