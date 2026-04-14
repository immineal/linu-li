# Inspector Learnings

- **Alpha/Transparency and WCAG math**: Standard libraries like `tinycolor2` ignore the alpha channel in `readability` functions. To accurately test contrast with RGBA transparency, foreground and background colors must first be mathematically alpha-blended over a solid base (like the document's white background) using standard composite calculations before measuring contrast.
- **Floating Point Boundaries**: When calculating standard contrast boundaries (like 4.5 or 7.0), *never* compare `.toFixed(2)` string outputs against the threshold. `4.496` rounds to `"4.50"`, leading to a false pass. Always use raw unrounded numbers for logic.
- **Silent Defaults on Invalid Colors**: Invalid hex strings (like `#12`) input into `tinycolor` do not throw errors; instead, they silently parse as valid `#000000` (black). Always assert `.isValid()` on user input to avoid corrupting tool state.
