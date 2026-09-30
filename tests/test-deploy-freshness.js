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

/* ------------------------------------------------- 1. the placeholder */

test('the worker carries the deployed commit, so its bytes move', () => {
    const zeile = sw.split('\n').find((l) => /^const DEPLOY_SHA/.test(l));
    assert.ok(zeile, 'sw.js has no DEPLOY_SHA any more');
    assert.ok(/__DEPLOY_SHA__/.test(zeile),
        'DEPLOY_SHA carries no placeholder — the worker would be byte-identical after ' +
        'every deploy and no browser would ever fetch a new one: ' + zeile);
});

test('the cache name does not move with it', () => {
    /* Naming the cache after the deploy would mean throwing the offline
       store away several times a day and copying it back together on the
       phone — for no gain, because freshness comes from the revalidate in
       the fetch handler, not from the name. */
    const zeile = sw.split('\n').find((l) => /^const CACHE_NAME/.test(l));
    assert.ok(zeile, 'sw.js has no CACHE_NAME any more');
    assert.ok(!/__DEPLOY_SHA__/.test(zeile),
        'the cache name changes with every deploy again: the offline store would be ' +
        'emptied and copied across several times a day, for nothing. ' + zeile);
});

test('the worker deletes only its own caches', () => {
    /* /tools/sperrmuell/ brings a second worker on the same origin whose
       activate deletes every foreign cache. Returning the favour would
       mean the two of them keep clearing each other out. */
    assert.ok(/if \(!name\.startsWith\('ll-toolbox-'\)\) continue;/.test(sw),
        'activate deletes caches that are not ours — /tools/sperrmuell/ has its own worker ' +
        'on this origin and the two would wipe each other out');
});

test('the worker waits, and something exists to wake it', () => {
    /* Two halves that only work together. The worker must not take over on
       its own any more — otherwise it swaps the code under a tool that is
       holding a file. And it must not wait forever without something to
       wake it — otherwise a long-open tab stays on the old version. Drop
       either half and the other loses its point. */
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

/* --------------------------------------------------- 2. the deploy does it */

test('the deploy writes the commit in, and stops if it cannot', () => {
    assert.ok(/sed -i .*__DEPLOY_SHA__.*sw\.js/.test(deploy),
        'no sed replacing __DEPLOY_SHA__ in sw.js — the placeholder would ship as-is');
    assert.ok(/grep -q '__DEPLOY_SHA__' sw\.js/.test(deploy),
        'nothing checks the placeholder is still there before replacing it; a rename ' +
        'in sw.js would silently ship a worker that never changes again');
});

/* --------------------------------- 2b. and says what changed */

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

test('the two lists of what is not served agree', () => {
    /* The strip step says what is not uploaded. The note check says what
       counts as "served". If they drift apart, a docs-only change demands
       an update note for something no visitor ever sees — and nobody
       understands why the deploy stops. */
    const strip = (deploy.match(/^\s*rm -f (.+)$/gm) || [])
        .flatMap((z) => z.replace(/^\s*rm -f /, '').trim().split(/\s+/))
        .filter((name) => !name.includes('*') && !name.startsWith('assets/'));

    /* The exclusions are patterns, not names: `test*.js` covers `test.js`
       too. A literal compare would flag exactly that as a gap. */
    const muster = [...deploy.matchAll(/':\(exclude\)([^']+)'/g)]
        .map(([, wert]) => new RegExp('^' +
            wert.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'));
    const fehlend = strip.filter((name) => !muster.some((m) => m.test(name)));
    assert.deepStrictEqual(fehlend, [],
        'the strip step removes these before upload, but the note check still counts ' +
        'them as files the website serves: ' + fehlend.join(', '));
});

test('the deploy fetches enough history for both checks to work', () => {
    /* Both fail silently on a shallow clone: the live compare cannot find
       the commit and thinks it has nothing to do, and git blame pins every
       line to the boundary commit. */
    assert.ok(/fetch-depth: 0/.test(deploy),
        'checkout takes the default shallow clone — the note check would resolve no ' +
        'live commit and every sentence would claim to belong to this deploy');
});

/* ------------------------------------------------- 3. the headers */

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
    /* It decides the name, icon and start page of the installed app.
       Images and fonts keep their year — they are numerous and do not
       change. */
    const block = htaccess.match(/<Files "manifest\.json">[\s\S]*?<\/Files>/g) || [];
    assert.ok(block.some((b) => /Cache-Control "no-cache"/.test(b)),
        'manifest.json is not set to no-cache');
    assert.ok(block.some((b) => /ExpiresActive Off/.test(b)),
        'mod_expires still writes an Expires header a month out next to it');
});

/* ------------------------------- 3b. the second worker on the same origin */

test('the Sperrmüll map deletes only its own caches too', () => {
    /* The other direction of the check further up. If either one deletes
       foreign caches, they take turns clearing each other out — opening
       the map loses the toolbox's offline store. */
    const sperr = lies('tools/sperrmuell/sw.js');
    assert.ok(/startsWith\("sperrmuell-"\)/.test(sperr),
        'tools/sperrmuell/sw.js deletes every cache that is not its own, /sw.js included');
});

test('the map keeps its hashed bundles and revalidates its dates', () => {
    const assets = lies('tools/sperrmuell/assets/.htaccess');
    assert.ok(/max-age=31536000, immutable/.test(assets),
        'the content-hashed bundles do not get the year they have earned');
    const daten = lies('tools/sperrmuell/data/.htaccess');
    assert.ok(/Cache-Control "no-cache"/.test(daten),
        'the collection dates are held for a month — in January that means last ' +
        "year's dates");
});

test('the map\'s own worker is not caught by the year', () => {
    /* tools/sperrmuell/sw.js sits one level above assets/ and must keep the
       no-cache rule from the root. */
    const assets = lies('tools/sperrmuell/assets/.htaccess');
    assert.ok(!/sw\.js/.test(assets.replace(/#[^\n]*/g, '')),
        'tools/sperrmuell/assets/.htaccess reaches the worker with a live directive');
});

/* ---------------------------------------- 4. green-checked, then uploaded */

test('the deploy waits for the test run', () => {
    assert.ok(/workflow_run:/.test(deploy),
        'the deploy still hangs off the push and races the tests — a red run ships anyway');
    assert.ok(/workflow_run\.conclusion == 'success'/.test(deploy),
        'the deploy does not insist the run was green');
});

test('the workflow it waits for is the one that exists', () => {
    /* The connection is a string. Rename ci.yml and the deploy stops
       firing, and nothing anywhere turns red. */
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
    /* CI runs on pull_request, which means on forks of this public repo
       too. A workflow_run job runs afterwards with the FTP secrets, and
       branches:[main] checks the branch name *inside the fork*. Without
       both of these conditions the deploy mirrors foreign code onto
       linu.li. */
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

/* -------------------------------------- and none of this gets uploaded */

test('none of this lands on the website', () => {
    const strip = deploy.match(/rm -rf ([^\n]*)/);
    assert.ok(strip && /\btests\b/.test(strip[1]),
        'the strip step no longer removes tests/, so this file would be published');
});

if (!process.exitCode) console.log(`${passed} checks passed`);
