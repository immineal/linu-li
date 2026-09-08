/**
 * That every tool answers at its short address, and that the Sperrmüll map
 * survived being moved.
 *
 * Two separate things, held together by the same .htaccess:
 *
 *   1. /qr-creator/ reaches /tools/qr-creator/. The rule asks the file
 *      system whether tools/<name>/ exists rather than carrying a list, so
 *      it covers a tool the day it lands — but only for as long as nobody
 *      replaces it with a list, which is what this checks.
 *   2. The map moved from /sperrmuell/ into tools/. Its bundle is Vite build
 *      output with the base path written into it, so the move is not just a
 *      rename, and the worker it registered at the old address is still
 *      installed in the browser of everyone who ever opened it.
 *
 * The second one has a trap in it that no amount of care in the redirect can
 * undo. A service worker script is never fetched through a redirect: the
 * browser reads a redirected update as a failed one and keeps the worker it
 * has. That worker answers every same-origin GET in its scope out of cache,
 * navigations included, so it would go on serving the old app and the 301
 * underneath it would never be reached. Hence the script still answering at the old
 * address, and hence the exception that lets it be served from inside the tool.
 *
 * None of this can be exercised without Apache — `npx serve` and
 * `python3 -m http.server` both ignore .htaccess — so this reads the rules
 * rather than following them. It is the same bargain the sitemap and
 * published-files tests make.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const htaccess = lies('.htaccess');
const stilllegung = lies('tools/sperrmuell/abgemeldet-sw.js');

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

/* ------------------------------------------ 1. die kurzen Adressen */

test('the short address rule asks the file system instead of keeping a list', () => {
    assert.ok(/RewriteCond %\{DOCUMENT_ROOT\}\/tools\/\$1 -d/.test(htaccess),
        'no -d condition on tools/$1 — either the rule is gone, or it was replaced ' +
        'by something that has to be edited every time a tool is added');
    assert.ok(/RewriteRule \^\(\[\^\/\]\+\)\/\?\$ \/tools\/\$1\/ \[L,R=301\]/.test(htaccess),
        'the short address rule no longer redirects /<name>/ to /tools/<name>/');
});

test('every tool is covered by it, and nothing else is', () => {
    /* Die Regel greift für genau die Namen, unter denen ein Verzeichnis in
       tools/ liegt. Was in der Wurzel liegt, darf sie nicht anfassen —
       privacy.html und sitemap.xml werden ausgeliefert, nicht umgeleitet. */
    const werkzeuge = fs.readdirSync(path.join(ROOT, 'tools'), { withFileTypes: true })
        .filter((e) => e.isDirectory()).map((e) => e.name);
    assert.ok(werkzeuge.length > 25,
        `only ${werkzeuge.length} directories under tools/ — that is not this site`);

    const wurzel = fs.readdirSync(ROOT, { withFileTypes: true })
        .filter((e) => !e.name.startsWith('.')).map((e) => e.name);
    const kollision = wurzel.filter((n) => werkzeuge.includes(n));
    assert.deepStrictEqual(kollision, [],
        'these exist both in the root and under tools/, so the short address would ' +
        'shadow whatever the root serves: ' + kollision.join(', '));
});

test('the old address has no directory of its own any more', () => {
    /* Der Sinn des Umzugs war, dass neben tools/ nichts mehr steht. Die
       Datei, die /sperrmuell/sw.js beantwortet, liegt deshalb im Werkzeug und
       wird intern dorthin umgeschrieben. Ein Verzeichnis hier waere entweder
       von der Umleitung verdeckt und damit unerreichbar, oder es waere die
       Unordnung zurueck. */
    assert.ok(!fs.existsSync(path.join(ROOT, 'sperrmuell')),
        'sperrmuell/ is back at the site root — either it is hidden behind the ' +
        'redirect and unreachable, or the move achieved nothing');
});

/* ------------------------------------------ 2. die verschobene Karte */

test('the map answers under tools/ and the old address redirects there', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'tools/sperrmuell/index.html')),
        'tools/sperrmuell/index.html is gone — the map did not survive the move');
    assert.ok(/RewriteRule \^sperrmuell\(\?:\/\(\.\*\)\)\?\$ \/tools\/sperrmuell\/\$1 \[L,R=301\]/.test(htaccess),
        'nothing carries /sperrmuell/ and the paths below it to the new address');
});

test('the built map carries no bare /sperrmuell/ path any more', () => {
    /* Vite schreibt den base-Pfad in die Ausgabe: in index.html und in das
       Bundle, das den Worker registriert und die Daten holt. Bleibt einer
       stehen, fragt die Seite eine Adresse an, die nur noch umleitet.

       Die Dateien werden aufgesammelt statt genannt: ihr Name traegt den
       Inhalts-Hash und aendert sich bei jedem Bau. */
    const dateien = ['index.html', 'manifest.webmanifest'];
    for (const name of fs.readdirSync(path.join(ROOT, 'tools/sperrmuell/assets'))) {
        if (name.endsWith('.js') || name.endsWith('.css')) dateien.push('assets/' + name);
    }
    assert.ok(dateien.some((d) => d.endsWith('.js')),
        'no built bundle under tools/sperrmuell/assets/ — nothing to check');

    for (const datei of dateien) {
        const inhalt = lies('tools/sperrmuell/' + datei);
        const treffer = inhalt.match(/(?<!\/tools)\/sperrmuell\//g) || [];
        assert.deepStrictEqual(treffer, [],
            `tools/sperrmuell/${datei} still points at the old /sperrmuell/ base ` +
            `(${treffer.length}x) — built without base: "/tools/sperrmuell/"?`);
    }
});

/* ------------------------------------------ 3. der Grabstein */

test('the old worker address is served from inside the tool, not redirected', () => {
    const intern = htaccess.indexOf(
        'RewriteRule ^sperrmuell/sw\\.js$ tools/sperrmuell/abgemeldet-sw.js [L]');
    const umleitung = htaccess.indexOf('RewriteRule ^sperrmuell(?:/(.*))?$');
    assert.notStrictEqual(intern, -1,
        'nothing answers /sperrmuell/sw.js any more. A service worker script fetched ' +
        'through a redirect counts as a failed update, so the old worker would stay ' +
        'installed and go on serving the old app out of its cache');
    assert.ok(intern < umleitung,
        'the 301 stands before the rewrite, so it wins and /sperrmuell/sw.js redirects ' +
        'after all — order is the whole mechanism here');
    assert.ok(fs.existsSync(path.join(ROOT, 'tools/sperrmuell/abgemeldet-sw.js')),
        'the rewrite points at a file that is not there');
});

test('that rewrite is internal, so the scope stays where the worker needs it', () => {
    /* Mit R=301 waere es wieder eine Umleitung und alles darueber umsonst.
       Ohne, bleibt die Adresse /sperrmuell/sw.js, und daher kommt der
       Geltungsbereich des Workers — nicht daher, wo die Datei liegt. */
    const zeile = htaccess.split('\n')
        .find((z) => z.includes('^sperrmuell/sw\\.js$'));
    assert.ok(zeile, 'the rewrite line is gone');
    assert.ok(!/\bR=\d{3}\b/.test(zeile),
        `the worker address is redirected after all: ${zeile.trim()}`);
});

test('the retiring worker takes the old registration apart', () => {
    assert.ok(/self\.registration\.unregister\(\)/.test(stilllegung),
        'the retiring worker does not unregister itself, so it is just another worker ' +
        'holding the old scope');
    assert.ok(!/addEventListener\(\s*["']fetch["']/.test(stilllegung),
        'the retiring worker answers fetches — with a handler in place the requests never ' +
        'reach the network, and the redirect never gets its turn');
    assert.ok(/client\.navigate/.test(stilllegung),
        'open tabs on the old address are never sent through the redirect');
});

test('the retiring worker clears its own caches and only its own', () => {
    assert.ok(/startsWith\("sperrmuell-"\)/.test(stilllegung),
        'the retiring worker deletes caches by some other rule than its own prefix — ' +
        'the toolbox keeps ll-toolbox-* on this same origin and would go with it');
    assert.ok(!/ll-toolbox/.test(stilllegung),
        'the retiring worker names the toolbox cache');
});

if (!process.exitCode) console.log(`${passed} checks passed`);
