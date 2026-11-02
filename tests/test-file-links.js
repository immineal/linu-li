/**
 * linu.li/f/<name>, the files handed out as plain links.
 *
 * What this guards fails quietly. A worker that catches these downloads still
 * delivers them, and only the visitor's offline store fills up with audio. An
 * unsafe file type looks like any other file until someone opens it.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { MAX_BYTES, nameFehler, nameAus } = require('../src/publish-file.js');

const ROOT = path.join(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

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

/* Runs the real worker and asks whether it takes a request. A pattern match
   on the source would still pass if the check moved below the code it is
   meant to skip. */
function workerNimmt(url, mode, accept) {
    const hoerer = {};
    const umgebung = {
        self: { addEventListener: (typ, fn) => { hoerer[typ] = fn; }, location: { origin: 'https://linu.li' } },
        caches: { match: async () => undefined, open: async () => ({ put: async () => {} }) },
        fetch: async () => ({ status: 404 }),
        URL,
    };
    vm.runInNewContext(lies('sw.js'), umgebung);

    let genommen = false;
    hoerer.fetch({
        request: { method: 'GET', url, mode, headers: { get: () => accept } },
        respondWith: (antwort) => { genommen = true; Promise.resolve(antwort).catch(() => {}); },
        waitUntil: () => {},
    });
    return genommen;
}

test('the worker leaves a download alone', () => {
    assert.strictEqual(workerNimmt('https://linu.li/f/new.mp3', 'navigate', 'text/html'), false,
        'a click on a link goes into the offline cache, so every download lands in Cache Storage');
    assert.strictEqual(workerNimmt('https://linu.li/f/new.mp3', 'no-cors', '*/*'), false,
        'an audio element pointed at a file goes through the worker, which cannot store a range response');
});

test('the worker still takes everything else', () => {
    assert.strictEqual(workerNimmt('https://linu.li/privacy.html', 'navigate', 'text/html'), true);
    assert.strictEqual(workerNimmt('https://linu.li/assets/css/style.css', 'no-cors', '*/*'), true);
    assert.strictEqual(workerNimmt('https://linu.li/tools/f/index.html', 'navigate', 'text/html'), true,
        'the exception reaches further than /f/');
});

test('a clean file name passes and anything else does not', () => {
    for (const name of ['new.mp3', 'all-i-want.mp3', 'drifting_apart.v2.wav']) {
        assert.strictEqual(nameFehler(name), null, name);
    }
    for (const name of ['x.html', 'x.svg', 'x.js', 'x.mp3.html', '../x.mp3', 'a/b.mp3', 'New.mp3',
        'a b.mp3', '.htaccess', '-x.mp3', 'x']) {
        assert.ok(nameFehler(name), `${name} would be accepted`);
    }
});

test('a file name is cleaned up from its source', () => {
    assert.strictEqual(nameAus('/tmp/02_Boombap Fm #93.MP3'), '02_boombap-fm-93.mp3');
});

test('everything in f/ keeps to those rules', () => {
    const dateien = fs.readdirSync(path.join(ROOT, 'f')).filter((n) => n !== '.htaccess');
    for (const name of dateien) {
        assert.strictEqual(nameFehler(name), null);
        assert.ok(fs.statSync(path.join(ROOT, 'f', name)).size <= MAX_BYTES, `${name} is over the limit`);
    }
});

test('f/.htaccess hands out files and keeps the root rules', () => {
    const regeln = lies('f/.htaccess').replace(/#[^\n]*/g, '');
    assert.ok(/Header set Content-Disposition "attachment"/.test(regeln),
        'a link opens the file in the browser instead of saving it');
    assert.ok(!/RewriteEngine/.test(regeln),
        'a RewriteEngine here stops the root rewrites, HTTPS among them, applying to these files');
});

test('the deploy uploads f/', () => {
    const deploy = lies('.github/workflows/deploy.yml');
    const entfernt = (deploy.match(/^\s*rm -rf (.+)$/gm) || []).join(' ').split(/\s+/);
    assert.ok(!entfernt.includes('f') && !entfernt.includes('f/'), 'the strip step removes f/');
    assert.ok(!/--exclude f\//.test(deploy), 'the mirror skips f/');
    assert.ok(entfernt.includes('src'), 'src/publish-file.js would be served');
});

if (!process.exitCode) console.log(`${passed} checks passed`);
