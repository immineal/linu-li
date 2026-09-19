/*
 * Bühnenbild-Planer — der Diagnosebericht.
 *
 * Der Bericht existiert, weil ein Fehler, den nur ein Rechner zeigt, sich
 * nicht nachstellen lässt. Er muss deshalb das eine aushalten, was ihm sonst
 * niemand ansieht: er läuft auf einem fremden Rechner, in einem Browser, den
 * hier keiner hat, und wenn er dort wirft oder schweigt, merkt es niemand —
 * die Rückmeldung kommt dann eben ohne die Zahlen, und das Rätselraten geht
 * von vorne los.
 *
 * Geprüft wird darum vor allem, was er tut, wenn etwas fehlt.
 */
const assert = require('assert');
const Diag = require('../tools/buehnenbild/diag.js');

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

test('ohne Fenster, ohne Druck und ohne Probe kommt trotzdem ein Bericht', () => {
    Diag.leeren();
    const text = Diag.bericht({ build: '2026-09-18a', sha: 'abc1234' }, null);
    assert.ok(text.indexOf('2026-09-18a') > -1, 'die Fassung fehlt');
    assert.ok(text.indexOf('abc1234') > -1, 'der Commit fehlt');
    assert.ok(/Keine Messung/.test(text), 'sagt nicht, dass nichts gemessen wurde');
    assert.ok(/Fehler: keine/.test(text));
});

test('der Bericht bleibt unter der Grenze, die Formspree noch annimmt', () => {
    Diag.leeren();
    /* Zweihundert Textfelder auf einem Blatt sind albern und kommen trotzdem
       vor. Vorher wuchs der Bericht mit ihnen, und was zu lang ist, wirft der
       Dienst weg — dann ist die ganze Rückmeldung verloren, nicht nur der
       Anhang. */
    for (let i = 0; i < 400; i++) Diag.merkeFehler('Fehler Nummer ' + i);
    const text = Diag.bericht({}, null);
    assert.ok(text.length <= Diag.GRENZE + 200, 'zu lang: ' + text.length);
});

test('derselbe Fehler zweihundertmal ist eine Zeile mit einer Zahl', () => {
    Diag.leeren();
    for (let i = 0; i < 200; i++) Diag.merkeFehler('immer derselbe');
    const stand = Diag.stand();
    assert.strictEqual(stand.fehler.length, 1);
    assert.strictEqual(stand.fehler[0].mal, 200);
});

test('nur die letzten Fehler, damit der erste nicht den Bericht auffrisst', () => {
    Diag.leeren();
    for (let i = 0; i < 40; i++) Diag.merkeFehler('Fehler ' + i);
    assert.ok(Diag.stand().fehler.length <= 6, 'zu viele: ' + Diag.stand().fehler.length);
});

test('die Rasterprobe legt jede Zeile in ihr eigenes Band', () => {
    /* Läge Band zwei in Band eins, zählte die Probe die Tinte der einen Zeile
       der anderen zu, und die Antwort wäre nicht falsch, sondern beliebig. */
    const plan = Diag.probeMarkup([0.008, 0.02, 0.05, 0.1, 0.2], 160);
    plan.baender.forEach((b, i) => {
        assert.ok(b.bis > b.von, 'Band ' + i + ' hat keine Höhe');
        if (i > 0) {
            assert.ok(b.von >= plan.baender[i - 1].bis,
                'Band ' + i + ' überlappt das davor');
        }
    });
    assert.ok(plan.kontrolle.von >= plan.baender[plan.baender.length - 1].bis,
        'der Kontrollbalken liegt in der letzten Zeile');
    assert.ok(plan.markup.indexOf('scale(160)') > -1, 'die linke Spalte ist nicht skaliert');
    assert.ok(plan.markup.indexOf('font-size="32"') > -1, 'die rechte Spalte fehlt');
});

test('gezählt wird nur im angegebenen Streifen', () => {
    /* Ein Bild aus vier Punkten: oben links schwarz, der Rest weiß. */
    const breite = 2;
    const daten = new Uint8ClampedArray(2 * 2 * 4).fill(255);
    daten[0] = 0; daten[1] = 0; daten[2] = 0;
    assert.strictEqual(Diag.zaehleTinte(daten, breite, 0, 1, 0, 1), 1);
    assert.strictEqual(Diag.zaehleTinte(daten, breite, 0, 1, 1, 2), 0);
    assert.strictEqual(Diag.zaehleTinte(daten, breite, 1, 2, 0, 2), 0);
});

test('eine Textzeile nennt die Größe, in der wirklich gesetzt wurde', () => {
    /* 0,164 Meter mal 15,2 Punkte je Meter sind 2,49 Punkte. Das ist die
       Zahl, wegen der das alles hier steht: ein Rahmen, der gedruckt wird,
       und eine Schrift, die es vielleicht nicht wird. */
    const zeile = Diag.textZeile({
        klasse: 'sp-mark-text', attr: '0.164', einheiten: 0.164, massstab: 15.2,
        familie: 'Space Grotesk', fuellung: 'rgb(22, 19, 15)', deckung: '1',
        sichtbar: 'visible', anzeige: 'inline', zeichen: 12,
        laenge: 0.98, breite: 0.98, hoehe: 0.12
    });
    assert.ok(zeile.indexOf('2.493 px') > -1, 'die gesetzte Größe fehlt: ' + zeile);
    assert.ok(zeile.indexOf('sp-mark-text') > -1);
    assert.ok(zeile.indexOf('Space Grotesk') > -1);
});

test('fehlt eine Messung, steht ein Fragezeichen und kein NaN', () => {
    const zeile = Diag.textZeile({
        klasse: '', attr: null, einheiten: null, massstab: null,
        familie: '?', fuellung: '?', deckung: '?', sichtbar: '?', anzeige: '?',
        zeichen: 0, laenge: 'Fehler', breite: 'Fehler', hoehe: null
    });
    assert.ok(zeile.indexOf('NaN') === -1, 'NaN im Bericht: ' + zeile);
    assert.ok(zeile.indexOf('undefined') === -1, 'undefined im Bericht: ' + zeile);
});

test('der Schnappschuss sagt es, wenn keine Blätter da sind', () => {
    Diag.leeren();
    const datei = Diag.schnappschuss({ build: 'x' }, null);
    assert.ok(/keine Blätter/.test(datei),
        'schweigt über die fehlenden Blätter');
});

test('der Schnappschuss trägt die Blätter im Rohzustand', () => {
    Diag.leeren();
    Diag.merkeMarkup('<svg class="sp-plan"><text font-size="0.164">Sofa</text></svg>');
    const datei = Diag.schnappschuss({ build: 'x' }, null);
    assert.ok(datei.indexOf('font-size="0.164"') > -1,
        'das Markup fehlt — damit lässt sich nichts nachstellen');
});

test('der Schnappschuss sagt vorne, dass die Produktion drinsteht', () => {
    /* Wer eine Datei verschickt, muss wissen, was er verschickt. Sie steht
       im Klartext darin, und das gehört in die erste Zeile und nicht in eine
       Fußnote. */
    Diag.leeren();
    const kopf = Diag.schnappschuss({}, null).split('=====')[0];
    assert.ok(/Klartext/.test(kopf), 'die Warnung steht nicht im Kopf');
});

test('die Schriftprobe stürzt ohne document.fonts nicht ab', () => {
    const ohne = Diag.schriften({}, 'Space Grotesk', [10]);
    assert.strictEqual(ohne.stand, 'kein document.fonts');
    const mit = Diag.schriften({ fonts: { status: 'loaded', check: () => false } },
        'Space Grotesk', [10, 0.2]);
    assert.strictEqual(mit.stand, 'loaded');
    assert.deepStrictEqual(mit.proben, ['10px NEIN', '0.2px NEIN']);
});

test('die Mindestschriftgröße wird ohne DOM nicht geraten', () => {
    /* Sie ist nur im Browser zu messen. Ein geschätzter Wert wäre schlimmer
       als keiner: er stünde im Bericht, als hätte ihn jemand gemessen. */
    assert.strictEqual(Diag.mindestSchrift(null), null);
    assert.strictEqual(Diag.mindestSchrift({ document: {} }), null);
});

test('app.js trägt einen Stempel, an dem sich die Fassung ablesen lässt', () => {
    /* Ohne ihn lässt sich an einer Rückmeldung nicht erkennen, ob der
       Absender die Korrektur schon hat. */
    const src = require('fs').readFileSync(
        require('path').join(__dirname, '../tools/buehnenbild/app.js'), 'utf8');
    const m = src.match(/var BUILD = '([^']+)'/);
    assert.ok(m, 'kein BUILD in app.js');
    assert.ok(/^\d{4}-\d{2}-\d{2}[a-z]?$/.test(m[1]), 'sieht nicht aus wie ein Datum: ' + m[1]);
});

test('diag.js wird von der Seite auch geladen', () => {
    const html = require('fs').readFileSync(
        require('path').join(__dirname, '../tools/buehnenbild/index.html'), 'utf8');
    assert.ok(html.indexOf('src="diag.js"') > -1, 'index.html lädt diag.js nicht');
    assert.ok(html.indexOf('src="diag.js"') < html.indexOf('src="app.js"'),
        'diag.js muss vor app.js stehen');
});

console.log('\n' + passed + ' Prüfungen bestanden');
