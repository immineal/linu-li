# Contributing

This is mostly a one-person project, but patches are welcome. Here is what will save you time.

## Running it

Any static server will do:

```
npx serve . --listen 3000
```

Opening `index.html` from the file system does not work. The service worker needs a real origin, and half the tools break without it.

## Tests

Three suites, and CI runs all of them before anything is deployed. A red run means nothing ships.

```
# Node only, no browser
node tests/test-buehnenbild.js

# Browser tests, need a server on port 3000
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome node tests/test-service-worker.js

# Playwright, needs a server on port 8000
python3 tests/test_ui.py
```

`.github/workflows/ci.yml` has the full list. If you add a browser test, add it in two places: as a skip in the jsdom job, and as a `run_test` in the Puppeteer job. Miss one and it runs in the wrong job and fails for a reason that has nothing to do with your test.

The Chrome path above is a local workaround. In CI, `npm ci` installs a browser and nothing needs setting.

## Four rules that live in tests

Each of these fails silently when broken, which is why none of them is left to memory.

A push that changes a file the website serves has to add a line to `assets/update-note.txt`. Returning visitors see the lines newer than their own version, and the deploy stops if a change turns up without one. Write `-` on its own if this change does not deserve a prompt.

A form field is remembered across reloads only if it carries `data-save`, and only `<select>` may carry it. The site used to store every text field on every page, which is how a WiFi password and a JWT signing secret ended up in localStorage. A dropdown can only hold what the source lists as an option, so nothing anyone types fits inside one.

A tool that holds a file sets `window.llHaeltArbeit` to a function saying so. Before reloading, the update prompt asks. A tool with no hook counts as holding nothing, so one that forgets throws away someone's file without a word.

A new version of a vendored library gets a new file name. Everything under `assets/vendor/` goes out with a year of cache and `immutable`, so changing a file under its old name leaves everyone who ever visited on the old copy.

## Comments

Comments here answer why, not what. When the obvious version was tried and broke, the comment says so, because the next person to read it will otherwise try the obvious version again. A few of the older files are terse; new code is not required to match them.
