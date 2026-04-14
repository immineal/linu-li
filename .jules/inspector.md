# Inspector Learnings - SQL Prettifier

- The tool was showing a "Success" toast message even when the format failed. To fix this, logic was added to check the return value of `formatQuery` before firing the success toast.
- The `sql-formatter` CDN library could potentially fail to load, leading to unhandled errors. A check for `typeof sqlFormatter === 'undefined'` was added.
- The actual error messages were swallowed and replaced with generic "Check syntax." messages. Now, `err.message` is properly displayed if available.
- For testing vanilla JS functions that interact with DOM elements (without a heavy test framework), the `eval()` approach is very helpful to inject the extracted logic into a mocked DOM environment.
