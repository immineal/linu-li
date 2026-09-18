/*
 * Bühnenbild-Planer — was beim Drucken wirklich auf dem Blatt stand.
 *
 * Ein Fehler, den nur ein einziger Rechner zeigt, lässt sich nicht
 * nachstellen. Man kann ihn nur messen lassen, dort, wo er auftritt. Dieses
 * Modul misst und schreibt das Ergebnis in Klartext.
 *
 * Klartext, weil es zwei Wege hinaus gibt und beide Text nehmen. Der kurze
 * geht durch das Rückmeldeformular, das auf dem freien Tarif von Formspree
 * keine Anhänge annimmt — dort passt nur, was in ein Feld passt. Der lange
 * ist eine Datei, die im Download-Ordner landet und an ein Postfach geht;
 * in ihr steht auch das Blattwerk im Rohzustand, mit dem sich der Druck hier
 * nachbauen lässt.
 *
 * Gemessen wird das, was zwischen Bildschirm und Papier auseinanderlaufen
 * kann und wonach man sonst tagelang zurückschreibt:
 *
 *   — die Schrift: geladen oder nicht, und in welcher Größe sie beim Setzen
 *     wirklich ankommt. Ein <text> im Grundriss trägt seine Größe in Metern
 *     (font-size="0.164"), und erst die Skalierung des viewBox macht daraus
 *     Bildpunkte. Klemmt ein Browser irgendwo in dieser Kette, steht der
 *     Rahmen auf dem Blatt und der Text nicht.
 *   — die gemessene Textlänge. Kommt sie nicht zur Schriftgröße heraus, hat
 *     der Browser eine andere Schrift oder eine andere Größe gesetzt als die
 *     angeschriebene.
 *   — ob der Rasterer überhaupt malt. Dieselbe Schrift, einmal winzig in
 *     einer großen Skalierung und einmal groß ohne Skalierung: malt er nur
 *     die zweite, ist die Kette an dieser Stelle gerissen.
 *
 * Nichts davon nennt eine Person und nichts davon trägt Text aus einer
 * Produktion mit. Was gezählt wird, sind Zeichen, keine Wörter.
 */
(function (root, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory();
    } else {
        root.SPDiag = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* Formspree schluckt keine Romane, und niemand liest sie. Der Bericht ist
       nach oben begrenzt und sagt es, wenn er abgeschnitten wurde — lieber
       ein gekürzter Bericht als eine Nachricht, die der Dienst verwirft. */
    var GRENZE = 9000;

    /* So viele Textfelder werden einzeln aufgeführt. Wer fünfzig davon auf
       einem Blatt hat, dessen Fehler zeigt sich am ersten so gut wie am
       fünfzigsten. */
    var FELDER_MAX = 12;

    /* Und so viele Blätter. Wer zehn Szenen druckt, hat den Fehler auf dem
       ersten Blatt genauso wie auf dem zehnten. */
    var BLAETTER_MAX = 4;

    /* Die letzten Fehler, in der Reihenfolge ihres Auftretens. Mehr als eine
       Handvoll hilft nicht: der erste ist fast immer der Grund und der Rest
       sind seine Folgen. */
    var FEHLER_MAX = 6;

    var SITZUNG = 'sp.planner.diag.v1';

    var fehler = [];
    var letzterDruck = null;
    var letzteProbe = null;

    /* Gerundet wird nur, was eine Zahl ist. Der Rest geht durch, wie er ist:
       an den Stellen, an denen gemessen wird, steht bei einem Wurf das Wort
       'Fehler' statt einer Zahl, und genau das will man im Bericht lesen.
       Multipliziert ergab es NaN, und NaN sagt nicht, welche Messung
       schiefging. */
    function r(x, k) {
        if (x === null || x === undefined) return '?';
        if (typeof x !== 'number') return String(x);
        if (x !== x || x === Infinity || x === -Infinity) return '?';
        var f = Math.pow(10, k === undefined ? 2 : k);
        return String(Math.round(x * f) / f);
    }

    /* ------------------------------------------------------------------ *
     * Fehler einsammeln
     *
     * Ein geworfener Fehler im Druckweg hinterlässt sonst nichts als ein
     * leeres Blatt. Hier hinterlässt er eine Zeile, die mitgeschickt wird.
     * ------------------------------------------------------------------ */

    function merkeFehler(text, wo) {
        var zeile = String(text || '?').slice(0, 220) + (wo ? '  @' + wo : '');
        /* Derselbe Fehler in einer Schleife füllt sonst den ganzen Bericht. */
        var letzter = fehler[fehler.length - 1];
        if (letzter && letzter.text === zeile) { letzter.mal += 1; return; }
        fehler.push({ text: zeile, mal: 1, zeit: Date.now() });
        if (fehler.length > FEHLER_MAX) fehler.shift();
    }

    function lauschen(fenster) {
        if (!fenster || !fenster.addEventListener) return;
        fenster.addEventListener('error', function (e) {
            if (!e) return;
            var wo = e.filename
                ? String(e.filename).replace(/^.*\//, '') + ':' + e.lineno + ':' + e.colno
                : '';
            merkeFehler((e.message || (e.error && e.error.message)), wo);
        });
        fenster.addEventListener('unhandledrejection', function (e) {
            var grund = e && e.reason;
            merkeFehler('unhandled: ' + (grund && grund.message ? grund.message : grund));
        });
    }

    /* ------------------------------------------------------------------ *
     * Die Schrift
     * ------------------------------------------------------------------ */

    function schriften(doc, familie, groessen) {
        var f = doc && doc.fonts;
        var zeile = { stand: f ? f.status : 'kein document.fonts', proben: [] };
        if (!f || !f.check) return zeile;
        (groessen || [10]).forEach(function (px) {
            var ok;
            try { ok = f.check(px + 'px "' + familie + '"'); }
            catch (err) { ok = 'Fehler: ' + err.message; }
            zeile.proben.push(px + 'px ' + (ok === true ? 'ja' : ok === false ? 'NEIN' : ok));
        });
        return zeile;
    }

    /* Safari hat unter „Erweitert" eine Mindestschriftgröße: nie kleiner
     * als neun Punkt, zum Beispiel. Sie steht pro Rechner und pro Benutzer,
     * sie ist von außen nicht abzufragen, und sie ist der erste Verdacht bei
     * jedem Fehler, den genau ein Rechner zeigt.
     *
     * Sie lässt sich aber messen. Zwei Wörter aus denselben Buchstaben,
     * eines mit 4 px angeschrieben und eines mit 40, und dann gerechnet, wie
     * groß das kleine gemessen an dem großen wirklich gesetzt wurde. Kommt
     * 4 heraus, greift nichts; kommt 9 heraus, hat der Browser die 4 auf 9
     * hochgezogen — und dann tut er das mit der Schrift im Grundriss
     * womöglich auch.
     */
    function mindestSchrift(fenster) {
        var doc = fenster && fenster.document;
        if (!doc || !doc.body) return null;
        var kasten = doc.createElement('div');
        kasten.setAttribute('style', 'position:absolute;left:-9999px;top:0;' +
            'visibility:hidden;white-space:nowrap;font-family:Helvetica,Arial,sans-serif');
        var klein = doc.createElement('span');
        var gross = doc.createElement('span');
        klein.style.fontSize = '4px';
        gross.style.fontSize = '40px';
        klein.textContent = gross.textContent = 'MMMMMMMMMM';
        kasten.appendChild(klein);
        kasten.appendChild(doc.createElement('br'));
        kasten.appendChild(gross);
        doc.body.appendChild(kasten);
        var a = klein.getBoundingClientRect().width;
        var b = gross.getBoundingClientRect().width;
        if (kasten.parentNode) kasten.parentNode.removeChild(kasten);
        if (!b) return null;
        return Math.round(a / (b / 40) * 100) / 100;
    }

    /* ------------------------------------------------------------------ *
     * Ein <text> im Grundriss, ausgemessen
     *
     * `font-size` steht in Metern, `ctm.a` sagt, wie viele Bildpunkte ein
     * Meter geworden ist. Das Produkt ist die Größe, in der der Browser die
     * Schrift tatsächlich setzen soll — und die Zahl, um die es geht.
     * ------------------------------------------------------------------ */

    function messeText(el, fenster) {
        var cs = fenster.getComputedStyle ? fenster.getComputedStyle(el) : null;
        var info = {
            klasse: el.getAttribute('class') || '',
            attr: el.getAttribute('font-size'),
            einheiten: cs ? parseFloat(cs.fontSize) : null,
            familie: cs ? String(cs.fontFamily || '').split(',')[0].replace(/["']/g, '') : '?',
            fuellung: cs ? cs.fill : '?',
            deckung: cs ? cs.opacity : '?',
            sichtbar: cs ? cs.visibility : '?',
            anzeige: cs ? cs.display : '?',
            zeichen: (el.textContent || '').length,
            laenge: null, breite: null, hoehe: null, massstab: null
        };
        try { info.laenge = el.getComputedTextLength(); } catch (err) { info.laenge = 'Fehler'; }
        try {
            var b = el.getBBox();
            info.breite = b.width;
            info.hoehe = b.height;
        } catch (err) { info.breite = 'Fehler'; }
        try {
            var m = el.getScreenCTM();
            if (m) info.massstab = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || m.a;
        } catch (err) { /* außerhalb des Baums, dann eben nicht */ }
        /* Das Feld, in das der Text soll. Die Schriftgröße ist daraus
           gerechnet — ist sie zu klein, um gedruckt zu werden, steht die
           Antwort auf das Warum in diesen zwei Zahlen und nicht im Text. */
        try {
            var platte = el.parentNode && el.parentNode.querySelector
                ? el.parentNode.querySelector('.sp-mark-plate') : null;
            if (platte) {
                info.feldW = parseFloat(platte.getAttribute('width'));
                info.feldH = parseFloat(platte.getAttribute('height'));
            }
        } catch (err) { /* kein Rahmen, dann ohne */ }
        return info;
    }

    function textZeile(info) {
        /* Die beiden Zahlen, wegen derer das hier steht: wie groß die Schrift
           gesetzt werden soll, und wie breit der Browser den Text dann
           gemessen hat. Der Quotient aus Länge, Zeichenzahl und Größe liegt
           bei einer gesetzten Zeile um 0,5. Fällt er weit daneben, hat der
           Browser etwas anderes gesetzt als das Angeschriebene. */
        var punkte = (typeof info.einheiten === 'number' && typeof info.massstab === 'number')
            ? info.einheiten * info.massstab : null;
        var quotient = (typeof info.laenge === 'number' && info.zeichen && info.einheiten)
            ? info.laenge / (info.zeichen * info.einheiten) : null;
        return [
            info.klasse || '(ohne Klasse)',
            'Feld ' + (info.feldW === undefined ? '?' : r(info.feldW, 3) + '×' + r(info.feldH, 3)),
            info.zeichen + ' Zeichen',
            'font-size ' + info.attr + ' → ' + r(info.einheiten, 4) + ' Einheiten',
            'Maßstab ' + r(info.massstab, 2) + ' px/Einheit',
            'gesetzt ' + (punkte === null ? '?' : r(punkte, 3) + ' px'),
            'Länge ' + r(info.laenge, 3),
            'je Zeichen/em ' + (quotient === null ? '?' : r(quotient, 3)),
            'BBox ' + r(info.breite, 3) + '×' + r(info.hoehe, 3),
            info.fuellung,
            'Deckung ' + info.deckung,
            info.sichtbar + '/' + info.anzeige,
            info.familie
        ].join('  ');
    }

    /* ------------------------------------------------------------------ *
     * Der gefüllte Druckvorrat, Blatt für Blatt
     *
     * Aufgerufen, während die Blätter im Dokument stehen und bevor der
     * Browser sie an den Drucker gibt. Danach räumt der Planer den Vorrat
     * wieder leer, und dann ist nichts mehr zu messen.
     * ------------------------------------------------------------------ */

    function messeDruck(portal, fenster) {
        fenster = fenster || (typeof window !== 'undefined' ? window : null);
        if (!portal || !fenster) return null;
        var blaetter = [];
        var sheets = portal.querySelectorAll('.sp-sheet');
        Array.prototype.forEach.call(sheets, function (sheet, i) {
            var plan = sheet.querySelector('svg.sp-plan');
            var eintrag = {
                nummer: i + 1,
                art: (sheet.getAttribute('class') || '').replace(/\bsp-sheet\b/, '').trim(),
                viewBox: plan ? plan.getAttribute('viewBox') : null,
                felder: [],
                andere: {}
            };
            if (plan) {
                var kasten = plan.getBoundingClientRect();
                eintrag.gemalt = r(kasten.width, 1) + '×' + r(kasten.height, 1) + ' px';
                Array.prototype.forEach.call(plan.querySelectorAll('text'), function (el) {
                    var klasse = el.getAttribute('class') || '(ohne Klasse)';
                    if (klasse.indexOf('sp-mark-text') > -1) {
                        if (eintrag.felder.length < FELDER_MAX) {
                            eintrag.felder.push(messeText(el, fenster));
                        }
                        return;
                    }
                    /* Alles andere wird nur gezählt. Es steht auf demselben
                       Blatt und wird gedruckt — das allein sagt schon, dass
                       es nicht die Blätter sind, sondern die Textfelder. */
                    eintrag.andere[klasse] = (eintrag.andere[klasse] || 0) + 1;
                });
                /* Der Rahmen ohne den Text ist genau das, was sie sieht. */
                eintrag.rahmen = plan.querySelectorAll('.sp-mark-plate').length;
            }
            blaetter.push(eintrag);
        });
        letzterDruck = { zeit: Date.now(), blaetter: blaetter };
        merken(fenster);
        return letzterDruck;
    }

    /* Über einen Neuladevorgang hinweg, aber nicht über das Schließen des
       Reiters hinaus: gedruckt wird in einem Rutsch, und danach wird
       geschrieben. Was älter ist als dieser Reiter, gehört zu einem anderen
       Versuch. */
    function merken(fenster) {
        try {
            fenster.sessionStorage.setItem(SITZUNG, JSON.stringify({
                druck: letzterDruck, probe: letzteProbe, fehler: fehler
            }));
        } catch (err) { /* voll oder gesperrt, dann eben nur im Speicher */ }
    }

    function holen(fenster) {
        fenster = fenster || (typeof window !== 'undefined' ? window : null);
        if (!fenster) return;
        try {
            var roh = fenster.sessionStorage.getItem(SITZUNG);
            if (!roh) return;
            var alt = JSON.parse(roh);
            if (alt.druck && !letzterDruck) letzterDruck = alt.druck;
            if (alt.probe && !letzteProbe) letzteProbe = alt.probe;
            if (alt.fehler && !fehler.length) fehler = alt.fehler;
        } catch (err) { /* unlesbar, dann ohne */ }
    }

    /* Das Blattwerk, wie es im Dokument stand — Zeichen für Zeichen.
     *
     * Der ganze Grund, warum es das gibt: ein Fehler, der nur auf einem
     * Rechner auftritt, ist hier nicht nachzustellen. Mit diesem Stück
     * Markup lässt er sich nachstellen, weil es genau das ist, was Safari
     * dort zu drucken bekommen hat — dieselben Zahlen, dieselben Klassen,
     * dieselbe Verschachtelung. Es wandert nie in das Formular; es ist zu
     * groß dafür und gehört in die Datei.
     *
     * Nur im Arbeitsspeicher: sessionStorage nimmt keine Megabyte, und
     * gedruckt und geschrieben wird ohnehin hintereinander weg. */
    var MARKUP_MAX = 4000000;
    var letztesMarkup = null;

    function merkeMarkup(html) {
        if (!html) { letztesMarkup = null; return; }
        var text = String(html);
        letztesMarkup = text.length > MARKUP_MAX
            ? text.slice(0, MARKUP_MAX) + '\n<!-- hier abgeschnitten, es waren ' +
              text.length + ' Zeichen -->'
            : text;
    }

    /* ------------------------------------------------------------------ *
     * Die Rasterprobe
     *
     * Zwei Wege zu derselben Schriftgröße auf dem Blatt: einmal winzig
     * angeschrieben und groß skaliert — so, wie der Grundriss es macht —,
     * einmal groß angeschrieben ohne Skalierung. Gezählt werden die
     * geschwärzten Bildpunkte je Zeile. Bleibt die linke Spalte leer und die
     * rechte nicht, klemmt es in der Skalierung und nicht an der Schrift.
     *
     * Der Rasterer ist nicht der Drucker. Aber er ist derselbe Zeichenkern,
     * und er antwortet in Zahlen, die durch ein Formular passen.
     * ------------------------------------------------------------------ */

    var PROBE_GROESSEN = [0.008, 0.02, 0.05, 0.1, 0.2];
    var PROBE_K = 160;

    function probeMarkup(groessen, k) {
        var breite = 320;
        var rand = 8;
        var y = rand;
        var baender = [];
        var teile = '<rect x="0" y="0" width="' + breite + '" height="{H}" fill="#ffffff"/>';
        groessen.forEach(function (s, i) {
            var px = s * k;
            var band = Math.max(8, px * 1.8);
            var grund = y + band * 0.72;
            /* Links: angeschrieben in Einheiten, groß skaliert. */
            teile += '<g transform="translate(' + rand + ' ' + grund + ') scale(' + k + ')">' +
                '<text x="0" y="0" font-size="' + s + '" fill="#000000" ' +
                'font-family="Helvetica, Arial, sans-serif">HHHH</text></g>';
            /* Rechts: dieselbe Größe, ohne Skalierung. */
            teile += '<text x="' + (breite / 2 + rand) + '" y="' + grund + '" font-size="' + px +
                '" fill="#000000" font-family="Helvetica, Arial, sans-serif">HHHH</text>';
            baender.push({ i: i, s: s, px: px, von: Math.floor(y), bis: Math.ceil(y + band) });
            y += band + 2;
        });
        /* Ein Balken, der immer da sein muss. Kommt er nicht durch, hat nicht
           die Schrift versagt, sondern die Rasterung überhaupt. */
        teile += '<rect x="' + rand + '" y="' + y + '" width="40" height="10" fill="#000000"/>';
        var kontrolle = { von: Math.floor(y), bis: Math.ceil(y + 10) };
        y += 14;
        var hoehe = Math.ceil(y);
        return {
            markup: '<svg xmlns="http://www.w3.org/2000/svg" width="' + breite + '" height="' + hoehe +
                '" viewBox="0 0 ' + breite + ' ' + hoehe + '">' +
                teile.replace('{H}', hoehe) + '</svg>',
            breite: breite, hoehe: hoehe, baender: baender, kontrolle: kontrolle
        };
    }

    function zaehleTinte(daten, breite, von, bis, x0, x1) {
        var treffer = 0;
        for (var y = Math.max(0, von); y < bis; y++) {
            for (var x = x0; x < x1; x++) {
                var p = (y * breite + x) * 4;
                /* Alles, was nicht fast weiß ist. Kantenglättung zählt mit —
                   winzige Schrift besteht fast nur aus Kanten. */
                if (daten[p] < 230 || daten[p + 1] < 230 || daten[p + 2] < 230) treffer++;
            }
        }
        return treffer;
    }

    function probe(fenster, fertig) {
        fenster = fenster || (typeof window !== 'undefined' ? window : null);
        if (!fenster || !fenster.document) { fertig(null); return; }
        var plan = probeMarkup(PROBE_GROESSEN, PROBE_K);
        var bild = new fenster.Image();
        var abgebrochen = false;
        var uhr = fenster.setTimeout(function () {
            abgebrochen = true;
            letzteProbe = { fehler: 'Zeit abgelaufen' };
            fertig(letzteProbe);
        }, 4000);

        bild.onload = function () {
            if (abgebrochen) return;
            fenster.clearTimeout(uhr);
            try {
                var leinwand = fenster.document.createElement('canvas');
                leinwand.width = plan.breite;
                leinwand.height = plan.hoehe;
                var ctx = leinwand.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, plan.breite, plan.hoehe);
                ctx.drawImage(bild, 0, 0);
                var daten = ctx.getImageData(0, 0, plan.breite, plan.hoehe).data;
                var mitte = Math.floor(plan.breite / 2);
                letzteProbe = {
                    k: PROBE_K,
                    zeilen: plan.baender.map(function (b) {
                        return {
                            s: b.s, px: b.px,
                            skaliert: zaehleTinte(daten, plan.breite, b.von, b.bis, 0, mitte),
                            direkt: zaehleTinte(daten, plan.breite, b.von, b.bis, mitte, plan.breite)
                        };
                    }),
                    kontrolle: zaehleTinte(daten, plan.breite, plan.kontrolle.von, plan.kontrolle.bis, 0, mitte)
                };
            } catch (err) {
                letzteProbe = { fehler: err.message };
            }
            merken(fenster);
            fertig(letzteProbe);
        };
        bild.onerror = function () {
            if (abgebrochen) return;
            fenster.clearTimeout(uhr);
            letzteProbe = { fehler: 'Das Bild kam nicht zustande' };
            merken(fenster);
            fertig(letzteProbe);
        };
        bild.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(plan.markup);
    }

    /* ------------------------------------------------------------------ *
     * Der Bericht
     * ------------------------------------------------------------------ */

    function vorZeit(zeit) {
        if (!zeit) return '?';
        var s = Math.round((Date.now() - zeit) / 1000);
        if (s < 90) return 'vor ' + s + ' s';
        return 'vor ' + Math.round(s / 60) + ' min';
    }

    function bericht(extra, fenster) {
        fenster = fenster || (typeof window !== 'undefined' ? window : null);
        extra = extra || {};
        var doc = fenster && fenster.document;
        var nav = (fenster && fenster.navigator) || {};
        var zeilen = [];

        zeilen.push('— Technik —');
        zeilen.push('Fassung: app ' + (extra.build || '?') +
            ' · Worker ' + (extra.sha || '?'));
        zeilen.push('UA: ' + (nav.userAgent || '?'));
        zeilen.push('Plattform: ' + (nav.platform || '?') +
            ' · Kerne ' + (nav.hardwareConcurrency || '?') +
            ' · Sprache ' + (nav.language || '?'));
        if (fenster) {
            zeilen.push('Fenster: ' + fenster.innerWidth + '×' + fenster.innerHeight +
                ' · Bildschirm ' + ((fenster.screen && fenster.screen.width) || '?') + '×' +
                ((fenster.screen && fenster.screen.height) || '?') +
                ' · Punktdichte ' + (fenster.devicePixelRatio || '?'));
        }

        var s = schriften(doc, 'Space Grotesk', [10, 1, 0.2]);
        zeilen.push('Schriften: ' + s.stand + ' · Space Grotesk ' + s.proben.join(' · '));
        var klein = mindestSchrift(fenster);
        zeilen.push('4 px werden gesetzt als: ' + (klein === null ? '?' : klein + ' px') +
            (klein !== null && klein > 4.6
                ? '  ← der Browser zieht kleine Schrift hoch (Mindestschriftgröße)'
                : ''));
        if (extra.zustand) zeilen.push(extra.zustand);

        zeilen.push('');
        if (!letzterDruck) {
            zeilen.push('Letzter Druck: keiner in diesem Reiter. ' +
                '(Erst drucken, dann schreiben — sonst steht hier nichts.)');
        } else {
            /* Ausführlich nur die Blätter, auf denen ein Textfeld steht.
               Bei zehn Szenen standen vorher zehn Absätze im Bericht, neun
               davon über Blätter, um die es nicht geht — und die Rasterprobe
               am Ende fiel bei einer großen Produktion der Längengrenze zum
               Opfer. Von den anderen bleibt eine Zeile, denn dass sie
               gedruckt wurden, ist selbst eine Auskunft: die Blätter kommen
               durch, die Textfelder nicht. */
            var mitFeld = letzterDruck.blaetter.filter(function (b) {
                return b.felder && b.felder.length;
            });
            zeilen.push('Letzter Druck (' + vorZeit(letzterDruck.zeit) + ', ' +
                letzterDruck.blaetter.length + ' Blätter, davon ' + mitFeld.length +
                ' mit Textfeld):');
            mitFeld.slice(0, BLAETTER_MAX).forEach(function (b) {
                var andere = Object.keys(b.andere || {}).map(function (k) {
                    return k + '×' + b.andere[k];
                }).join(', ');
                zeilen.push('  Blatt ' + b.nummer + '  ' + (b.art || '—') +
                    '  viewBox ' + (b.viewBox || '—') + '  ' + (b.gemalt || '—') +
                    '  Rahmen ' + (b.rahmen === undefined ? '?' : b.rahmen) +
                    '  Textfelder ' + b.felder.length);
                b.felder.forEach(function (f, i) {
                    zeilen.push('    Textfeld ' + (i + 1) + '  ' + textZeile(f));
                });
                if (andere) zeilen.push('    sonstiger Text: ' + andere);
            });
            if (mitFeld.length > BLAETTER_MAX) {
                zeilen.push('  … und ' + (mitFeld.length - BLAETTER_MAX) +
                    ' weitere Blätter mit Textfeld.');
            }
            if (!mitFeld.length) {
                var ersteArt = letzterDruck.blaetter[0] || {};
                zeilen.push('  Kein Textfeld auf keinem Blatt. Erstes Blatt: ' +
                    (ersteArt.art || '—') + ', viewBox ' + (ersteArt.viewBox || '—') +
                    ', ' + (ersteArt.gemalt || '—') + '.');
            }
        }

        zeilen.push('');
        if (!letzteProbe) {
            zeilen.push('Rasterprobe: nicht gelaufen.');
        } else if (letzteProbe.fehler) {
            zeilen.push('Rasterprobe: ' + letzteProbe.fehler);
        } else {
            zeilen.push('Rasterprobe (Punkte: skaliert / direkt, Kontrollbalken ' +
                letzteProbe.kontrolle + '):');
            letzteProbe.zeilen.forEach(function (z) {
                zeilen.push('  ' + r(z.s, 3) + ' Einheiten × ' + letzteProbe.k +
                    ' = ' + r(z.px, 2) + ' px   ' + z.skaliert + ' / ' + z.direkt);
            });
        }

        zeilen.push('');
        if (!fehler.length) {
            zeilen.push('Fehler: keine.');
        } else {
            zeilen.push('Fehler:');
            fehler.forEach(function (f) {
                zeilen.push('  ' + f.text + (f.mal > 1 ? '  (' + f.mal + '×)' : ''));
            });
        }

        var text = zeilen.join('\n');
        if (text.length > GRENZE) {
            text = text.slice(0, GRENZE) + '\n… hier abgeschnitten, der Bericht war ' +
                text.length + ' Zeichen lang.';
        }
        return text;
    }

    /* ------------------------------------------------------------------ *
     * Der volle Schnappschuss
     *
     * Was durch das Formular nicht passt, passt in eine Datei, und eine
     * Datei passt an eine E-Mail. Formspree nimmt auf dem freien Tarif keine
     * Anhänge — der Umweg über das Postfach ist deshalb kein Notbehelf,
     * sondern der kürzere Weg: hier liegt alles beieinander, statt in
     * Bruchstücken in einer Nachricht.
     *
     * Anders als der kurze Bericht trägt der Schnappschuss die Arbeit selbst
     * mit: Szenentitel, Notizen, Beschriftungen. Deshalb entsteht er nur auf
     * Knopfdruck, landet als Datei im Download-Ordner und geht nirgendwohin,
     * solange sie ihn nicht selbst verschickt.
     * ------------------------------------------------------------------ */

    function abschnitt(titel, inhalt) {
        return '\n\n===== ' + titel + ' =====\n' +
            (inhalt === null || inhalt === undefined || inhalt === ''
                ? '(nichts)' : inhalt);
    }

    function ausSpeicher(fenster, schluessel) {
        try {
            var wert = fenster.localStorage.getItem(schluessel);
            return wert === null ? null : wert;
        } catch (err) { return 'nicht lesbar: ' + err.message; }
    }

    function schnappschuss(extra, fenster) {
        fenster = fenster || (typeof window !== 'undefined' ? window : null);
        extra = extra || {};
        var kopf = [
            'Bühnenbild-Planer — Diagnose',
            'erstellt ' + new Date().toISOString(),
            'Adresse: ' + ((fenster && fenster.location && fenster.location.href) || '?'),
            '',
            'Diese Datei ist zum Verschicken gedacht. Sie enthält die Arbeit aus',
            'diesem Browser im Klartext — wer sie bekommt, kann die Produktion lesen.'
        ].join('\n');

        var teile = [kopf];
        teile.push(abschnitt('1. Technik', bericht(extra, fenster)));
        teile.push(abschnitt('2. Die Blätter, wie sie im Dokument standen',
            letztesMarkup
                ? '(' + letztesMarkup.length + ' Zeichen)\n' + letztesMarkup
                : '(nicht gedruckt, seit diese Seite offen ist — erst drucken, dann speichern)'));
        if (fenster) {
            var arbeit = ausSpeicher(fenster, 'sp.planner.v1');
            teile.push(abschnitt('3. Die Arbeit (sp.planner.v1' +
                (arbeit ? ', ' + arbeit.length + ' Zeichen' : '') + ')', arbeit));
            teile.push(abschnitt('4. Einstellungen (sp.planner.ui.v1)',
                ausSpeicher(fenster, 'sp.planner.ui.v1')));
        }
        teile.push(abschnitt('5. Ende', 'Nichts weiter.'));
        return teile.join('');
    }

    return {
        lauschen: lauschen,
        merkeMarkup: merkeMarkup,
        schnappschuss: schnappschuss,
        merkeFehler: merkeFehler,
        messeDruck: messeDruck,
        messeText: messeText,
        textZeile: textZeile,
        probe: probe,
        probeMarkup: probeMarkup,
        zaehleTinte: zaehleTinte,
        schriften: schriften,
        mindestSchrift: mindestSchrift,
        holen: holen,
        bericht: bericht,
        /* Für den Prüfstand und für die Vorschau im Dialog. */
        stand: function () {
            return { druck: letzterDruck, probe: letzteProbe, fehler: fehler };
        },
        leeren: function () {
            letzterDruck = null; letzteProbe = null; letztesMarkup = null; fehler = [];
        },
        GRENZE: GRENZE
    };
}));
