## Case Converter
- Handling edge cases in case conversions using Regex requires strict attention to Unicode emojis, punctuation, and apostrophes.
- Used `(?<!['’\p{L}])\p{L}` with a negative lookbehind to handle title case successfully by capitalizing words that follow brackets or quotes but NOT apostrophes within words like "it's".
- `toWords` logic safely splits camelCase and number sequences using `replace(/([a-zA-Z])(\d)/g, '$1 $2').replace(/(\d)([a-zA-Z])/g, '$1 $2')` alongside preserving emojis via `\p{Emoji_Presentation}` and `\p{Extended_Pictographic}`.
