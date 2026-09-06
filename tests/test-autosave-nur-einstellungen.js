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

/* Was die Seite ausliefert und was layout.js einbindet. */
function seiten() {
    /* Jede ausgelieferte HTML-Datei, die layout.js einbindet — nicht nur
       tools/<name>/index.html. tools/buehnenbild/handbuch.html lädt es
       ebenfalls und lag vorher außerhalb der Prüfung. */
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

/* Jedes Feld, das die Markierung trägt. */
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

/* Ein Namensmuster hatte hier zuerst gestanden und war beides zugleich: zu
   lasch (`wifiSSID`, `vLast` und `vOrg` gingen glatt durch) und zu streng
   (ein ehrliches `inputFormat` wäre durchgefallen). Es musste raten, was ein
   Name bedeutet.
   Die Regel darunter muss nicht raten: nur ein <select> darf gemerkt werden.
   Eine Auswahl kann ausschließlich das enthalten, was im Quelltext als
   Option steht — nichts Eingetipptes passt hinein, egal wie das Feld heißt.
   Für ein Freitextfeld gilt das nie, auch wenn es als Einstellung gemeint
   ist. Wer eine Einstellung merken will, macht eine Auswahl daraus. */

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
    /* Die erste Fassung schrieb 32 Einstellungen und las keine einzige
       zurück: `if (saved !== null && input.value === '')` ist bei einer
       Auswahl nie wahr. Gespeichert wurde also für nichts, und die
       Datenschutzerklärung behauptete einen Zweck, den es nicht gab. */
    const layout = fs.readFileSync(path.join(ROOT, 'assets/js/layout.js'), 'utf8');
    assert.ok(!/savedValue !== null && input\.value === ''/.test(layout),
        'the restore is gated on the field being empty again — a dropdown never is, ' +
        'so nothing would ever be read back');
    assert.ok(/wiederherstellen\(input, savedValue\)/.test(layout),
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
    /* Die Erklärung führt die Schlüssel einzeln auf. Ein neuer Schlüssel im
       Code, der dort fehlt, macht sie unwahr — und niemandem fällt es auf. */
    const policy = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
    for (const schluessel of ['autosave_', 'll_autosave_bereinigt_v1', 'theme',
        'll_toolbox_favorites', 'linuli_currency_rates', 'sp.planner.v1']) {
        assert.ok(policy.includes(schluessel),
            `privacy.html does not mention ${schluessel}`);
    }
});

test('every server the site talks to is in the privacy policy', () => {
    /* Die Erklärung sagt „Folgende Ausnahmen bestehen" und zählt sie auf.
       Drei fehlten: der Zeit-Umrechner holt chrono-node von jsDelivr, der
       Einheiten-Umrechner Kurse von zwei Anbietern. Eine Aufzählung, die
       Vollständigkeit behauptet, braucht etwas, das sie einhält. */
    const policy = fs.readFileSync(path.join(ROOT, 'privacy.html'), 'utf8');
    /* Nur, was die Seite von sich aus anfragt. Ein <a href> ist eine Adresse,
       die der Besucher selbst anklickt — das ist keine Übermittlung durch
       diese Seite, und ein `placeholder="https://example.com"` erst recht
       nicht. Gesucht wird deshalb nach den Stellen, an denen ein Browser
       ohne Zutun lädt. */
    const HOLT = [
        /\bfetch\(\s*['"`](https:\/\/[a-z0-9.-]+)/gi,
        /\bimport\(\s*['"`](https:\/\/[a-z0-9.-]+)/gi,
        /\bsrc\s*=\s*['"](https:\/\/[a-z0-9.-]+)/gi,
        /<link\b[^>]*\bhref\s*=\s*['"](https:\/\/[a-z0-9.-]+)/gi,
        /\bnew\s+(?:Worker|EventSource|WebSocket)\(\s*['"`](https:\/\/[a-z0-9.-]+)/gi,
        /\b(?:action)\s*=\s*['"](https:\/\/[a-z0-9.-]+)/gi,
        /['"`](https:\/\/[a-z0-9.{}-]+\/[^'"`]*\{[zxy]\})/gi,   // Kartenkacheln
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
