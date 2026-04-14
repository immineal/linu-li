## Learnings from Lorem Ipsum Generator fix
- When dealing with user inputs specifying lengths or amounts, relying on standard integer parsing isn't enough, we need to specifically handle empty strings turning into `NaN`, protect against negative values, and ensure an upper bound is placed to avoid crashing browsers.
- `navigator.clipboard.writeText()` should be handled defensively with fallback mechanisms. In this case, wrapping the fallback inside `.catch()` ensures we can revert to `document.execCommand('copy')` if modern clipboards fail.
