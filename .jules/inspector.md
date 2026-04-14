# Inspector Learnings

- **Crypto Randomness:** When generating cryptographically secure random characters in JavaScript using `crypto.getRandomValues` and a modulo operator, eliminate modulo bias by implementing rejection sampling to ensure a uniform distribution and true randomness.
- **Crypto Limits:** To prevent `QuotaExceededError` when using `window.crypto.getRandomValues`, defensively cap the requested array size, as the API enforces a maximum limit of 65536 bytes per call (e.g., a maximum length of 16384 for a `Uint32Array`).
- **Defensive Copying:** When implementing "copy to clipboard" functionality from an output display, ensure error messages or placeholder text are explicitly excluded to prevent confusing the user.
