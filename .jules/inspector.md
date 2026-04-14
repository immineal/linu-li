
### Unit Converter Edge Cases
- When formatting numbers in JavaScript, `.toFixed()` truncates extremely small values (e.g., `< 1e-6`) to zero. Conditionally use `.toPrecision()` to retain significant digits for extreme scale values while maintaining readability for standard numbers.
- In HTML5, programmatically setting the `.value` property of an `<input type="number">` to `NaN` or an invalid string via JavaScript results in an empty string (`""`), visually clearing the input.
- For bi-directional input fields (like unit converters), if an inputted value is bounded or clamped during calculation, explicitly update the source input field's value to reflect the clamped state so the UI accurately matches the underlying data.
