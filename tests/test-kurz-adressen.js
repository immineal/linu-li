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
 * underneath it would never be reached. Hence the gravestone at the old
 * address, and hence the exception that lets it be served.
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
const grabstein = lies('sperrmuell/sw.js');

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
    /* sperrmuell/ ist die eine erlaubte Doppelung: die Regel leitet die alte
       Adresse absichtlich auf tools/ um, und was in der Wurzel liegen bleibt,
       ist der Grabstein. Jede andere waere ein Wurzelverzeichnis, das ab
       sofort niemand mehr erreicht. */
    const kollision = wurzel.filter((n) => werkzeuge.includes(n) && n !== 'sperrmuell');
    assert.deepStrictEqual(kollision, [],
        'these exist both in the root and under tools/, so the short address would ' +
        'shadow whatever the root serves: ' + kollision.join(', '));
});

test('nothing but the gravestone is left behind the redirect', () => {
    /* Alles unter sperrmuell/ ausser sw.js ist von der Umleitung verdeckt und
       waere ab sofort nicht mehr abrufbar — lautlos, weil die Umleitung ja
       eine gueltige Seite liefert. */
    const rest = fs.readdirSync(path.join(ROOT, 'sperrmuell'));
    assert.deepStrictEqual(rest, ['sw.js'],
        'these sit at the old address where the redirect hides them, so nothing can ' +
        'reach them any more: ' + rest.filter((n) => n !== 'sw.js').join(', '));
});

/* ------------------------------------------ 2. die verschobene Karte */

test('the map answers under tools/ and the old address redirects there', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'tools/sperrmuell/index.html')),
        'tools/sperrmuell/index.html is gone — the map did not survive the move');
    assert.ok(/RewriteRule \^sperrmuell\(\?:\/\(\.\*\)\)\?\$ \/tools\/sperrmuell\/\$1 \[L,R=301\]/.test(htaccess),
        'nothing carries /sperrmuell/ and the paths below it to the new address');
});

test('the moved bundle carries no /sperrmuell/ path any more', () => {
    /* Vite schreibt den base-Pfad in die Ausgabe. Bleibt einer stehen, holt
       die Seite ihre Daten von einer Adresse, die nur noch umleitet. */
    for (const datei of ['index.html', 'assets/index-Ct5wqi0O.js']) {
        const inhalt = lies('tools/sperrmuell/' + datei);
        const treffer = inhalt.match(/(?<!\/tools)\/sperrmuell\//g) || [];
        assert.deepStrictEqual(treffer, [],
            `tools/sperrmuell/${datei} still points at the old /sperrmuell/ base ` +
            `(${treffer.length}x) — rebuilt without changing Vite's base?`);
    }
});

/* ------------------------------------------ 3. der Grabstein */

test('the old worker address is served, not redirected', () => {
    assert.ok(/RewriteCond %\{REQUEST_URI\} !\^\/sperrmuell\/sw\\\.js\$/.test(htaccess),
        'sperrmuell/sw.js is no longer excepted from the redirect. A service worker ' +
        'script fetched through a redirect counts as a failed update, so the old ' +
        'worker stays installed and goes on serving the old app from its cache');
    assert.ok(fs.existsSync(path.join(ROOT, 'sperrmuell/sw.js')),
        'the exception has nothing to serve — sperrmuell/sw.js is gone');
});

test('the gravestone takes the old registration apart', () => {
    assert.ok(/self\.registration\.unregister\(\)/.test(grabstein),
        'sperrmuell/sw.js does not unregister itself, so it is just another worker ' +
        'holding the old scope');
    assert.ok(!/addEventListener\(\s*["']fetch["']/.test(grabstein),
        'sperrmuell/sw.js answers fetches — with a handler in place the requests never ' +
        'reach the network, and the redirect never gets its turn');
    assert.ok(/client\.navigate/.test(grabstein),
        'open tabs on the old address are never sent through the redirect');
});

test('the gravestone clears its own caches and only its own', () => {
    assert.ok(/startsWith\("sperrmuell-"\)/.test(grabstein),
        'sperrmuell/sw.js deletes caches by some other rule than its own prefix — ' +
        'the toolbox keeps ll-toolbox-* on this same origin and would go with it');
    assert.ok(!/ll-toolbox/.test(grabstein),
        'sperrmuell/sw.js names the toolbox cache');
});

if (!process.exitCode) console.log(`${passed} checks passed`);
