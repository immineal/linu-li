## Word & Char Counter
* The naïve text `.length` and `.split` logic fails heavily on Emojis, Zero-width spaces, and CJK text.
* Used `Intl.Segmenter` for robust character (grapheme), word, and sentence splitting.
* Wrote `tests/test-counter.js` to assert segmenter behaviour against edge cases.
# JWT Debugger - Edge Cases and Reliability Learnings
- **Bug**: Invalid base64url padding exceptions, unhandled missing signature segments, and generic info toasts for expired tokens.
- **Consequence**: Valid but padded base64 tokens crash the decoder, unsigned tokens (`header.payload`) are falsely rejected as invalid format, and users are not explicitly warned when a token has already expired.
- **Fix**:
  - Stripped existing padding (`.replace(/=+$/, '')`) before recalculating base64url padding.
  - Relaxed segment validation to allow 2 or 3 segments, gracefully handling missing signatures.
  - Added a strict check against `Date.now()` to show a red "Expired on" error toast for expired tokens instead of the default "Expires" info toast.
- **Test**: Created a Node.js regression test script extracting the inline JavaScript and executing it with mock globals. Tests proved the correct handling of invalid input, missing signatures, padded base64 tokens, and token expiration highlighting.
