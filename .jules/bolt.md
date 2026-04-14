## 2026-04-14 - [Auto-Save Debounce]
**Learning:** Found synchronous `localStorage.setItem` calls within an `input` event listener, which executes on every keystroke. This blocks the main thread and causes severe UI lag, especially in tools handling massive text blocks like JSON Workbench or Diff Checker.
**Action:** Always debounce synchronous I/O operations (like `localStorage` writes) tied to rapid user events (like typing) to prevent main thread blocking.
