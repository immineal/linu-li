/**
 * The site remembers settings, never what somebody typed.
 *
 * `assets/js/layout.js` restores form fields across reloads. Until September
 * 2026 it did that for every text field on every page — 88 of them across 29
 * pages, against 7 exceptions — and never deleted any of it. Measured in a
 * browser at the time: the WiFi password from the QR creator and the HMAC
 * secret from the JWT debugger were both in localStorage, and the secret was
 * back in its field after a reload. Meanwhile the privacy policy said the
 * site stored two keys.
 *
 * It is opt-in now: a field is remembered only if it carries `data-save`.
 * That is the safe direction — a new tool that nobody thinks about stores
 * nothing at all — but only for as long as nobody marks the wrong field. The
 * mistake is cheap to make and invisible once made, so it gets a test.
 *
 * The rules, and the reason for each:
 *
 *   - textarea: never. A textarea exists to hold something written into it.
 *   - readonly: never. That is an output, computed from an input; storing it
 *     stores the input's shadow (every hash, every formatted document).
 *   - a name that sounds like a secret or like content: never.
 *   - `data-no-save` must not come back: it does nothing now, and an
 *     attribute that only looks like protection is worse than none.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* What the site serves and what layout.js is pulled into. */
function seiten() {
    /* Every served HTML file that pulls in layout.js — not only
       tools/<name>/index.html. tools/buehnenbild/handbuch.html loads it
       too and used to sit outside this check. */
    const raus = [];
    const ueberspringen = new Set(['node_modules', 'tests', '.tests', '.git',
        '.github', 'thisshouldbegitignored', 'test-results', 'sperrmuell']);
    (function gehen(verzeichnis) {
        for (const eintrag of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
            if (eintrag.name.startsWith('.') || ueberspringen.has(eintrag.name)) continue;
            const voll = path.join(verzeichnis, eintrag.name);
            if (eintrag.isDirectory()) gehen(voll);
            else if (eintrag.name.endsWith('.html')) raus.push(path.relative(ROOT, voll));
        }
    })(ROOT);
    return raus.filter((p) => fs.readFileSync(path.join(ROOT, p), 'utf8').includes('layout.js'));
}

/* Every field that carries the marker. */
function markierte() {
    const raus = [];
    for (const seite of seiten()) {
        const html = fs.readFileSync(path.join(ROOT, seite), 'utf8');
        const tags = html.match(/<(?:textarea|input|select)\b[^>]*>/gi) || [];
        for (const tag of tags) {
            if (!/\bdata-save\b/.test(tag)) continue;
            const id = (tag.match(/\bid="([^"]+)"/) || [])[1] || '(ohne id)';
            const art = (tag.match(/^<(\w+)/) || [])[1].toLowerCase();
            raus.push({ seite, id, art, tag, readonly: /\breadonly\b/.test(tag) });
        }
    }
    return raus;
}

/* A name pattern had stood here first and was both at once: too lax
   (`wifiSSID`, `vLast` and `vOrg` walked straight through) and too strict
   (an honest `inputFormat` would have failed). It had to guess at what a
   name meant.
   The rule below does not have to guess: only a <select> may be remembered.
   A dropdown can hold nothing except the options written in the source —
   nothing anybody types fits into it, whatever the field is called. That
   never holds for a free-text field, even one meant as a setting. If you
   want to remember a setting, turn it into a dropdown. */

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

const felder = markierte();

test('the site remembers by invitation, not by default', () => {
    const layout = fs.readFileSync(path.join(ROOT, 'assets/js/layout.js'), 'utf8');
    const zeile = (layout.match(/querySelectorAll\(\s*\n?\s*'([^']*data-save[^']*)'/) || [])[1];
    assert.ok(zeile,
        'layout.js no longer selects on [data-save]. If it went back to reading every ' +
        'field on the page, the site is storing passwords again.');
    for (const teil of zeile.split(',')) {
        assert.ok(/\[data-save\]/.test(teil),
            'one branch of the selector takes fields without data-save: ' + teil.trim());
    }
});

test('what the old rule left behind is cleared out once', () => {
    const layout = fs.readFileSync(path.join(ROOT, 'assets/js/layout.js'), 'utf8');
    assert.ok(/ll_autosave_bereinigt_v1/.test(layout),
        'nothing clears the autosave_ keys written under the old rule — the signing ' +
        'secrets already on people\'s machines would simply stay there');
    assert.ok(/startsWith\('autosave_'\)/.test(layout),
        'the clear-out does not go by the autosave_ prefix');
});

test('only a dropdown is remembered', () => {
    const schlimm = felder.filter((f) => f.art !== 'select')
        .map((f) => `${f.seite}#${f.id} (<${f.art}>)`);
    assert.deepStrictEqual(schlimm, [],
        'a <select> can only ever hold one of the options written in the source, so ' +
        'nothing anybody types can end up in it. Anything else can, whatever it is ' +
        'called — a free-text naming pattern carries a customer name as readily as a ' +
        'file format. Turn the setting into a dropdown, or leave it unremembered: ' +
        schlimm.join(', '));
});

test('no output is remembered', () => {
    const schlimm = felder.filter((f) => f.readonly).map((f) => `${f.seite}#${f.id}`);
    assert.deepStrictEqual(schlimm, [],
        'a readonly field is computed from an input, so storing it stores the input ' +
        'in another shape: ' + schlimm.join(', '));
});

test('what is written down is also read back', () => {
    /* The first version wrote 32 settings down and read none of them back:
       `if (saved !== null && input.value === '')` is never true for a
       dropdown. Storage happened for nothing, and the privacy policy
       claimed a purpose that did not exist. */
    const layout = fs.readFileSync(path.join(ROOT, 'assets/js/layout.js'), 'utf8');
    assert.ok(!/savedValue !== null && input\.value === ''/.test(layout),
        'the restore is gated on the field being empty again — a dropdown never is, ' +
        'so nothing would ever be read back');
    assert.ok(/restore\(input, savedValue\)/.test(layout),
        'nothing restores a saved setting');
});

test('data-no-save is gone and stays gone', () => {
    const schlimm = seiten().filter((seite) =>
        /data-no-save/.test(fs.readFileSync(path.join(ROOT, seite), 'utf8')));
    assert.deepStrictEqual(schlimm, [],
        'data-no-save does nothing since the switch to opt-in. An attribute that only ' +
        'looks like protection is worse than none: ' + schlimm.join(', '));
});

test('every key the site can write is in the privacy policy', () => {
    /* The policy lists the keys one by one. A new key in the code that is
       missing there makes it untrue — and nobody notices. */
    const policy = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
    for (const schluessel of ['autosave_', 'll_autosave_bereinigt_v1', 'theme',
        'll_toolbox_favorites', 'linuli_currency_rates', 'sp.planner.v1']) {
        assert.ok(policy.includes(schluessel),
            `privacy.html does not mention ${schluessel}`);
    }
});

test('every server the site talks to is in the privacy policy', () => {
    /* The policy says "the following exceptions apply" and enumerates them.
       Three were missing: the time converter pulls chrono-node from jsDelivr,
       the unit converter rates from two providers. A list that claims to be
       complete needs something to hold it to that. */
    const policy = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
    /* Only what the page requests on its own. An <a href> is an address the
       visitor clicks — that is not a transmission by this site, and a
       `placeholder="https://example.com"` even less so. So we look for the
       spots where a browser loads without a click. */
    const HOLT = [
        /\bfetch\(\s*['"`](https:\/\/[a-z0-9.-]+)/gi,
        /\bimport\(\s*['"`](https:\/\/[a-z0-9.-]+)/gi,
        /\bsrc\s*=\s*['"](https:\/\/[a-z0-9.-]+)/gi,
        /<link\b[^>]*\bhref\s*=\s*['"](https:\/\/[a-z0-9.-]+)/gi,
        /\bnew\s+(?:Worker|EventSource|WebSocket)\(\s*['"`](https:\/\/[a-z0-9.-]+)/gi,
        /\b(?:action)\s*=\s*['"](https:\/\/[a-z0-9.-]+)/gi,
        /['"`](https:\/\/[a-z0-9.{}-]+\/[^'"`]*\{[zxy]\})/gi,   // map tiles
    ];
    const fremd = new Set();
    const dateien = seiten().concat(['assets/js/layout.js', 'tools/buehnenbild/app.js']);
    for (const seite of dateien) {
        const text = fs.readFileSync(path.join(ROOT, seite), 'utf8');
        for (const muster of HOLT) {
            for (const treffer of text.matchAll(muster)) {
                const wirt = treffer[1].replace(/^https:\/\//, '').split('/')[0].toLowerCase();
                if (/(^|\.)linu\.li$/.test(wirt) || wirt.includes('{')) continue;
                fremd.add(wirt);
            }
        }
    }
    const fehlend = [...fremd].filter((wirt) => {
        const kern = wirt.replace(/^(www|a|b|c)\./, '');
        return !policy.includes(kern);
    });
    assert.deepStrictEqual(fehlend, [],
        'these hosts are contacted from a page but named nowhere in privacy.html, ' +
        'which claims its list is complete: ' + fehlend.join(', '));
});

if (!process.exitCode) {
    console.log(`${passed} checks passed — ${felder.length} fields carry data-save`);
}
