/**
 * That a deploy actually reaches the people who already visited.
 *
 * Several things have to hold together for that, and each of them is
 * invisible when it stops holding — the site keeps working, it just serves
 * last spring's code:
 *
 *   1. sw.js carries a placeholder that the deploy replaces with the commit,
 *      so its bytes move and the browser fetches a new worker. Without it the
 *      file is identical after every deploy and the old cache answers
 *      forever. This is how it stood until September 2026.
 *   2. The deploy actually does that replacement, and stops if it cannot.
 *   3. sw.js and the site's own js/css are revalidated rather than held for
 *      a year — the net for everyone whose worker never registered.
 *   4. The deploy waits for the test run and ships the commit that passed,
 *      not whatever happens to be at the head of the branch — and not a
 *      commit from someone's fork.
 *
 * Like tests/test-published-files.js, this reads the workflow itself rather
 * than keeping a second copy of what it should say, so the two cannot drift.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const sw = lies('sw.js');
const deploy = lies('.github/workflows/deploy.yml');
const htaccess = lies('.htaccess');

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

/* ------------------------------------------------- 1. der Platzhalter */

test('the worker carries the deployed commit, so its bytes move', () => {
    const zeile = sw.split('\n').find((l) => /^const DEPLOY_SHA/.test(l));
    assert.ok(zeile, 'sw.js has no DEPLOY_SHA any more');
    assert.ok(/__DEPLOY_SHA__/.test(zeile),
        'DEPLOY_SHA carries no placeholder — the worker would be byte-identical after ' +
        'every deploy and no browser would ever fetch a new one: ' + zeile);
});

test('the cache name does not move with it', () => {
    /* Der Name nach dem Deploy zu benennen hieße, den Offline-Bestand
       mehrmals täglich wegzuwerfen und auf dem Telefon wieder
       zusammenzukopieren — ohne Gewinn, weil die Frische aus dem
       Nachfassen im fetch-Handler kommt, nicht aus dem Namen. */
    const zeile = sw.split('\n').find((l) => /^const CACHE_NAME/.test(l));
    assert.ok(zeile, 'sw.js has no CACHE_NAME any more');
    assert.ok(!/__DEPLOY_SHA__/.test(zeile),
        'the cache name changes with every deploy again: the offline store would be ' +
        'emptied and copied across several times a day, for nothing. ' + zeile);
});

test('the worker deletes only its own caches', () => {
    /* /sperrmuell/ bringt einen zweiten Worker auf derselben Herkunft mit,
       dessen activate jeden fremden Cache löscht. Diesen Gefallen zu
       erwidern hieße, dass sich die beiden gegenseitig abräumen. */
    assert.ok(/if \(!name\.startsWith\('ll-toolbox-'\)\) continue;/.test(sw),
        'activate deletes caches that are not ours — /sperrmuell/ has its own worker ' +
        'on this origin and the two would wipe each other out');
});

test('the worker waits, and something exists to wake it', () => {
    /* Zwei Hälften, die nur zusammen stimmen. Der Worker darf nicht mehr von
       allein übernehmen — sonst tauscht er den Code unter einem Werkzeug aus,
       das gerade eine Datei hält. Und er darf nicht endlos warten, ohne dass
       ihn jemand weckt — sonst bliebe ein lange offener Reiter für immer auf
       altem Stand. Fällt eine der beiden weg, fällt der Nutzen der anderen
       mit. */
    const install = sw.match(/addEventListener\('install'[\s\S]*?\n\}\);/);
    assert.ok(install, 'sw.js has no install handler');
    assert.ok(!/self\.skipWaiting\(\)/.test(install[0]),
        'the worker takes over on install again — it would swap the code under a tool ' +
        'that is mid-way through a file, without asking');
    assert.ok(/data\.frage === 'uebernimm'/.test(sw),
        'nothing lets the page tell the worker to take over');

    const layout = fs.readFileSync(path.join(ROOT, 'assets/js/layout.js'), 'utf8');
    assert.ok(/frage: 'uebernimm'/.test(layout),
        'the page never asks the worker to take over — the waiting worker would only ' +
        'ever activate once every tab of the site is closed');
});

/* --------------------------------------------------- 2. der Deploy tut es */

test('the deploy writes the commit in, and stops if it cannot', () => {
    assert.ok(/sed -i .*__DEPLOY_SHA__.*sw\.js/.test(deploy),
        'no sed replacing __DEPLOY_SHA__ in sw.js — the placeholder would ship as-is');
    assert.ok(/grep -q '__DEPLOY_SHA__' sw\.js/.test(deploy),
        'nothing checks the placeholder is still there before replacing it; a rename ' +
        'in sw.js would silently ship a worker that never changes again');
});

/* --------------------------------- 2b. und sagt, was sich geändert hat */

test('the worker has room for the sentences', () => {
    assert.ok(/\[\/\* __DEPLOY_NOTES__ \*\/\]/.test(sw),
        'sw.js carries no __DEPLOY_NOTES__ marker — the deploy would have nowhere to ' +
        'put what changed, and a visitor would be asked to update without a reason');
    assert.ok(/DEPLOY_NOTES/.test(sw) && /frage !== 'stand'/.test(sw),
        'the worker does not answer the page asking what version it is');
});

test('a deploy that changes the website has to say what changed', () => {
    assert.ok(/assets\/update-note\.txt/.test(deploy),
        'the deploy does not look at the note file at all');
    assert.ok(/git diff --name-only "\$LIVE" HEAD -- "\$NOTIZ"/.test(deploy),
        'nothing insists the note file changed along with the website');
    assert.ok(fs.existsSync(path.join(ROOT, 'assets/update-note.txt')),
        'assets/update-note.txt is gone');
});

test('the deploy fetches enough history for both checks to work', () => {
    /* Beide scheitern lautlos an einem flachen Klon: der Live-Vergleich
       findet den Commit nicht und hält sich für nicht zuständig, und
       git blame hängt jede Zeile an den Randcommit. */
    assert.ok(/fetch-depth: 0/.test(deploy),
        'checkout takes the default shallow clone — the note check would resolve no ' +
        'live commit and every sentence would claim to belong to this deploy');
});

/* ------------------------------------------------- 3. die Kopfzeilen */

test('the worker itself is never held in a cache', () => {
    const block = htaccess.match(/<Files "sw\.js">[\s\S]*?<\/Files>/);
    assert.ok(block, 'no <Files "sw.js"> block in .htaccess');
    assert.ok(/Cache-Control "no-cache"/.test(block[0]),
        'sw.js is not set to no-cache — the one file that must never be held back');
});

test("the site's own scripts and stylesheets are revalidated, not held", () => {
    assert.ok(/<FilesMatch "\\\.\(js\|css\)\$">\s*\n\s*Header set Cache-Control "no-cache"/.test(htaccess),
        'js/css carry no no-cache rule — a fix would reach returning visitors next spring');
    assert.ok(/<FilesMatch "\\\.\(js\|css\)\$">\s*\n\s*ExpiresActive Off/.test(htaccess),
        'mod_expires still writes an Expires header a year out next to the Cache-Control one');
});

test('the vendored libraries keep their year, and only they', () => {
    const vendor = lies('assets/vendor/.htaccess');
    assert.ok(/max-age=31536000, immutable/.test(vendor),
        'assets/vendor/.htaccess does not grant the year');
    assert.ok(!/assets\/vendor/.test(htaccess.replace(/#[^\n]*/g, '')),
        'the root .htaccess reaches into assets/vendor with a live directive; that ' +
        'directory is governed by its own file');
});

test('the manifest is not held for a month', () => {
    /* Es entscheidet Name, Symbol und Startseite der installierten App.
       Bilder und Schriften behalten ihr Jahr — die sind zahlreich und
       ändern sich nicht. */
    const block = htaccess.match(/<Files "manifest\.json">[\s\S]*?<\/Files>/g) || [];
    assert.ok(block.some((b) => /Cache-Control "no-cache"/.test(b)),
        'manifest.json is not set to no-cache');
    assert.ok(block.some((b) => /ExpiresActive Off/.test(b)),
        'mod_expires still writes an Expires header a month out next to it');
});

/* ------------------------------- 3b. der zweite Worker auf derselben Herkunft */

test('the Sperrmüll map deletes only its own caches too', () => {
    /* Die Gegenrichtung zu der Prüfung weiter oben. Löscht einer der beiden
       fremde Caches, räumen sie sich abwechselnd gegenseitig ab — wer die
       Karte aufmacht, verliert den Offline-Bestand der Toolbox. */
    const sperr = lies('sperrmuell/sw.js');
    assert.ok(/startsWith\("sperrmuell-"\)/.test(sperr),
        'sperrmuell/sw.js deletes every cache that is not its own, /sw.js included');
});

test('the map keeps its hashed bundles and revalidates its dates', () => {
    const assets = lies('sperrmuell/assets/.htaccess');
    assert.ok(/max-age=31536000, immutable/.test(assets),
        'the content-hashed bundles do not get the year they have earned');
    const daten = lies('sperrmuell/data/.htaccess');
    assert.ok(/Cache-Control "no-cache"/.test(daten),
        'the collection dates are held for a month — in January that means last ' +
        "year's dates");
});

test('the map\'s own worker is not caught by the year', () => {
    /* sperrmuell/sw.js liegt eine Ebene über assets/ und muss die
       no-cache-Regel aus der Wurzel behalten. */
    const assets = lies('sperrmuell/assets/.htaccess');
    assert.ok(!/sw\.js/.test(assets.replace(/#[^\n]*/g, '')),
        'sperrmuell/assets/.htaccess reaches the worker with a live directive');
});

/* ---------------------------------------- 4. grün geprüft, dann hochgeladen */

test('the deploy waits for the test run', () => {
    assert.ok(/workflow_run:/.test(deploy),
        'the deploy still hangs off the push and races the tests — a red run ships anyway');
    assert.ok(/workflow_run\.conclusion == 'success'/.test(deploy),
        'the deploy does not insist the run was green');
});

test('the workflow it waits for is the one that exists', () => {
    /* Die Verbindung ist eine Zeichenkette. Wird ci.yml umbenannt, hört der
       Deploy auf zu feuern, und nirgends wird etwas rot. */
    const gewartet = deploy.match(/workflows: \["([^"]+)"\]/);
    assert.ok(gewartet, 'the deploy does not name the CI workflow it waits for');
    const ci = lies('.github/workflows/ci.yml');
    const heisst = ci.match(/^name:\s*(.+)$/m);
    assert.ok(heisst, 'ci.yml has no name');
    assert.strictEqual(gewartet[1], heisst[1].trim(),
        'deploy.yml waits for a workflow name ci.yml does not carry — the deploy would ' +
        'simply stop firing, silently');
});

test('a fork cannot deploy to the website', () => {
    /* CI läuft auf pull_request, also auch für Forks dieses öffentlichen
       Repos. Ein workflow_run-Job läuft danach mit den FTP-Secrets, und
       branches:[main] prüft den Branchnamen *im Fork*. Ohne diese beiden
       Bedingungen spiegelt der Deploy fremden Code auf linu.li. */
    assert.ok(/workflow_run\.event == 'push'/.test(deploy),
        'nothing stops a pull_request run from reaching the deploy — a fork PR would ' +
        'be mirrored onto linu.li with this repository\'s FTP credentials');
    assert.ok(/workflow_run\.head_repository\.full_name == github\.repository/.test(deploy),
        'nothing checks the commit came from this repository rather than a fork');
});

test('two deploys cannot run over each other', () => {
    assert.ok(/^concurrency:/m.test(deploy),
        'no concurrency group — two pushes can open two LFTP sessions mirroring the ' +
        'same account with --delete at the same time');
    assert.ok(/cancel-in-progress: false/.test(deploy),
        'a deploy cut off halfway leaves the website halfway');
});

test('the deploy ships the commit that passed, not the branch head', () => {
    assert.ok(/ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/.test(deploy),
        'checkout takes no ref — a workflow_run job checks out the head of the branch ' +
        'by default, which may be a commit no test ever saw');
});

/* -------------------------------------- und nichts davon geht mit hoch */

test('none of this lands on the website', () => {
    const strip = deploy.match(/rm -rf ([^\n]*)/);
    assert.ok(strip && /\btests\b/.test(strip[1]),
        'the strip step no longer removes tests/, so this file would be published');
});

if (!process.exitCode) console.log(`${passed} checks passed`);
