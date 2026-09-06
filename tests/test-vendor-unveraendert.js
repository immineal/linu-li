/**
 * The price of the year-long cache on assets/vendor/.
 *
 * Everything under assets/vendor/ is served with `max-age=31536000,
 * immutable` (see assets/vendor/.htaccess). That is the right trade for
 * 6.4 MB of third-party libraries that changed in two commits in the whole
 * history of this repository, while the site's own scripts changed in 167 —
 * revalidating 3.1 MB of mermaid on every page load would find nothing.
 *
 * But `immutable` is a promise, and a promise needs something keeping it.
 * Drop a new build of pdf-lib over the old file name and everyone who has
 * ever visited keeps the old one for a year, with no way to notice: the
 * service worker would pick it up, the browser would not, and nothing would
 * look broken until someone reported a bug that had been fixed months ago.
 *
 * So: a new version of a library gets a NEW FILE NAME.
 *
 *     assets/vendor/pdf-lib.min.js  ->  assets/vendor/pdf-lib-1.17.min.js
 *
 * This test carries the hash of every file in that directory. Changing one
 * under the same name fails. Renaming it, adding one and removing one all
 * pass as soon as tests/vendor-hashes.json is updated to match — which is
 * one deliberate edit, visible in the diff, instead of a silent one.
 *
 * To update the list after a deliberate change:
 *     node tests/test-vendor-unveraendert.js --schreiben
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VENDOR = path.join(ROOT, 'assets/vendor');
const LISTE = path.join(__dirname, 'vendor-hashes.json');

function hashesLesen() {
    const gefunden = {};
    for (const name of fs.readdirSync(VENDOR).sort()) {
        if (name.startsWith('.')) continue;
        const pfad = path.join(VENDOR, name);
        if (!fs.statSync(pfad).isFile()) continue;
        gefunden[name] = crypto.createHash('sha256')
            .update(fs.readFileSync(pfad)).digest('hex').slice(0, 16);
    }
    return gefunden;
}

const gefunden = hashesLesen();

/* Der Schreibmodus ist Absicht: er macht das Nachtragen zu einem Befehl statt
   zu einer Handarbeit, und der Diff zeigt trotzdem jede einzelne Zeile. */
if (process.argv.includes('--schreiben')) {
    fs.writeFileSync(LISTE, JSON.stringify(gefunden, null, 2) + '\n');
    console.log(`vendor-hashes.json neu geschrieben — ${Object.keys(gefunden).length} Dateien`);
    process.exit(0);
}

const erwartet = JSON.parse(fs.readFileSync(LISTE, 'utf8'));

let passed = 0;
function test(name, fn) {
    try {
        fn();
        passed += 1;
        console.log('  ok  ' + name);
    } catch (err) {
        console.error('  FAIL  ' + name + '\n        ' + err.message);
        process.exitCode = 1;
    }
}

test('every vendored library still has the contents it was listed with', () => {
    const geaendert = Object.keys(erwartet)
        .filter((name) => gefunden[name] && gefunden[name] !== erwartet[name]);
    assert.deepStrictEqual(geaendert, [],
        'these files changed under the same name, and everyone who visited before ' +
        'keeps the old copy for a year: ' + geaendert.join(', ') + '. ' +
        'Give the new version a new file name, then run ' +
        'node tests/test-vendor-unveraendert.js --schreiben');
});

test('no vendored library disappeared without the list being updated', () => {
    const fehlend = Object.keys(erwartet).filter((name) => !gefunden[name]);
    assert.deepStrictEqual(fehlend, [],
        'listed but no longer there: ' + fehlend.join(', '));
});

test('no vendored library arrived without the list being updated', () => {
    const neu = Object.keys(gefunden).filter((name) => !(name in erwartet));
    assert.deepStrictEqual(neu, [],
        'there but not listed: ' + neu.join(', '));
});

test('the directory carries the .htaccess that buys it the year', () => {
    const ht = fs.readFileSync(path.join(VENDOR, '.htaccess'), 'utf8');
    assert.ok(/max-age=31536000/.test(ht), 'no year in assets/vendor/.htaccess');
    assert.ok(/immutable/.test(ht), 'no immutable in assets/vendor/.htaccess');
});

if (!process.exitCode) console.log(`${passed} checks passed`);
