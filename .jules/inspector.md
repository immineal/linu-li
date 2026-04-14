# Inspector Learnings

## EXIF Scrubber
- **Piexifjs Edge Cases**: The `piexif.remove()` function expects a valid JPEG structure. If a non-JPEG or a severely malformed file is passed (e.g. extension spoofing), it throws an error (e.g. "Given data isn't JPEG."). This can crash an entire batch processing loop if not handled individually per file.
- **Batch Processing Error Boundaries**: When processing an array of files via async functions (`try...catch` block), always wrap the processing of *each individual file* in a `try...catch`. If a single file fails and the error propagates to the outer block, it aborts the entire loop, leaving the user with a broken state and no access to successfully processed files.
- **Privacy First Approach**: In a privacy tool context, if an error happens when trying to scrub a file, the file must be completely omitted from the resulting payload. Falling back to the unscrubbed original file is a severe privacy violation.
- **FileReader Rejections**: The `FileReader` API doesn't throw synchronous errors. To prevent Promises from hanging indefinitely when file reading fails, always bind `reader.onerror` to `reject`.
