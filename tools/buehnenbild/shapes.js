/*
 * Bühnenbild-Planer — Bauvorschriften.
 *
 * Die meisten Requisiten im Fundus sind eine Zeichnung in einem Feld von
 * 100 × 100 Einheiten, die auf die Standfläche gezogen wird. Das geht so
 * lange gut, wie die Standfläche ungefähr quadratisch ist. Zieht man einen
 * Tisch auf 2,40 × 0,80 m, passiert dreierlei: die Beine werden mitgezerrt,
 * die Rundungen werden zu Ellipsen, und die Striche werden in der einen
 * Richtung dicker als in der anderen, weil eine ungleiche Skalierung auch
 * die Kontur ungleich skaliert.
 *
 * Ein Requisit mit einer Bauvorschrift wird stattdessen bei jeder Größe neu
 * gerechnet, direkt in Bühnenmetern. Die Armlehne eines Sofas ist dann 18 cm
 * breit, ob das Sofa 1,40 m oder 2,40 m misst. Die Strichstärke wird einmal
 * gesetzt und gilt überall gleich.
 *
 * Wer seine eigenen Möbel nachstellt, braucht genau das: Zahlen, die den
 * wirklichen Maßen entsprechen, nicht ein Bild, das man passend zerrt.
 *
 * Jede Vorschrift nennt ihre Werte selbst (params). Der Planer baut daraus
 * die Bedienelemente — jeder Wert bekommt einen Schieber und ein Zahlenfeld,
 * die dasselbe bedeuten. Was hier gezeichnet wird, trägt nie eine Farbe oder
 * eine Strichstärke aus dem Stylesheet: die Kontur steht als Zahl im Markup,
 * damit Bildschirm, Druck und PNG-Ausgabe dasselbe zeigen.
 *
 * Ein Wert nennt seine Einheit selbst. `unit: 'length'` heißt: die Zahl ist
 * ein Bühnenmaß in Metern und wird in der Einheit angezeigt, die eingestellt
 * ist. Ohne Angabe ist die Zahl das, was sie ist — eine Anzahl, ein Winkel.
 */
(function (root, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory();
    } else {
        root.SPShapes = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function n(value) {
        var r = Math.round(value * 1000) / 1000;
        return (r === 0 ? 0 : r).toString();
    }

    /* Wie schwer ein Requisit auf dem Plan steht, in Haarlinien. Ein
       Grundriss hat eine Rangfolge: die Bühnenkontur trägt 2,4, die Bauflucht
       1,1, das Raster 0,7. Die Requisiten liegen dazwischen und tragen alle
       dasselbe — Zeichnung wie Rechnung. Vor dem Umbau waren es zwei
       verschiedene Gewichte, und man sah es. Wer daran dreht, dreht an einer
       Stelle. Was als Fläche gezeichnet ist, geht das hier nichts an: eine
       Fläche hat keinen Strich. */
    var INK = 1.2;

    function p6(value) {
        var r = Math.round(value * 1000000) / 1000000;
        return (r === 0 ? 0 : r).toString();
    }

    function clamp(value, lo, hi) {
        var x = typeof value === 'number' && isFinite(value) ? value : lo;
        return Math.min(hi, Math.max(lo, x));
    }

    function esc(text) {
        return String(text == null ? '' : text).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    /* Ein Rechteck mit gleichen Radien in beiden Richtungen. rx allein würde
       beim Wechsel des Seitenverhältnisses zur Ellipse. */
    function box(x, y, w, h, r, sw, cls) {
        var rad = clamp(r, 0, Math.min(w, h) / 2);
        return '<rect' + (cls ? ' class="' + cls + '"' : '') +
            ' x="' + n(x) + '" y="' + n(y) + '" width="' + n(w) + '" height="' + n(h) + '"' +
            (rad ? ' rx="' + n(rad) + '" ry="' + n(rad) + '"' : '') +
            ' stroke-width="' + n(sw) + '"/>';
    }

    function line(d, sw, cls) {
        return '<path' + (cls ? ' class="' + cls + '"' : '') +
            ' d="' + d + '" stroke-width="' + n(sw) + '"/>';
    }

    function oval(rx, ry, sw, cls) {
        return '<ellipse' + (cls ? ' class="' + cls + '"' : '') +
            ' cx="0" cy="0" rx="' + n(Math.max(0.005, rx)) + '" ry="' + n(Math.max(0.005, ry)) +
            '" stroke-width="' + n(sw) + '"/>';
    }

    /* Vier Beine als kurze Diagonalen in den Ecken — die Schreibweise, in der
       die übernommenen Zeichnungen einen Tisch kenntlich machen. Sie sind in
       Metern lang, wachsen also nicht mit der Platte mit. */
    var CLOTH_ANGLE = 22.5;

    function cornerLegs(w, h, len, sw) {
        var d = clamp(len, 0.03, Math.min(w, h) / 2.4);
        var hw = w / 2, hh = h / 2;
        return line('M' + n(-hw) + ' ' + n(-hh) + 'l' + n(d) + ' ' + n(d) +
            'M' + n(-hw) + ' ' + n(hh) + 'l' + n(d) + ' ' + n(-d) +
            'M' + n(hw) + ' ' + n(hh) + 'l' + n(-d) + ' ' + n(-d) +
            'M' + n(hw) + ' ' + n(-hh) + 'l' + n(-d) + ' ' + n(d), sw);
    }

    /* Schräg liegende Parallelen in einem Rechteck, auf Abstand geschnitten.
       Ein Karo auf einer Tischdecke liegt über Eck; gerade Linien sähen aus
       wie eine Fuge, nicht wie Stoff. Der Winkel ist frei, weil 45 Grad
       genau die Richtung der vier Beinmarken ist — dort fiel je eine
       Karolinie mit einem Bein zusammen, und das Bein verschwand im Muster.
       Der Abstand wird senkrecht zur Linie gemessen. */
    function hatch(hw, hh, step, angleDeg) {
        var a = angleDeg * Math.PI / 180;
        var dx = Math.cos(a), dy = Math.sin(a);
        var nx = -dy, ny = dx;                     // Einheitsnormale
        var reach = Math.abs(hw * nx) + Math.abs(hh * ny);
        var pitch = Math.max(0.01, step);
        var d = '';
        var first = -reach + ((reach * 2) % pitch) / 2;
        for (var c = first; c <= reach + 1e-9; c += pitch) {
            /* Ein Punkt auf der Linie, dann an den vier Kanten beschneiden. */
            var px = c * nx, py = c * ny;
            var lo = -Infinity, hi = Infinity;
            var ok = true;
            [[dx, -hw - px, hw - px], [dy, -hh - py, hh - py]].forEach(function (slab) {
                if (!ok) return;
                if (Math.abs(slab[0]) < 1e-9) {
                    if (slab[1] > 0 || slab[2] < 0) ok = false;
                    return;
                }
                var t1 = slab[1] / slab[0], t2 = slab[2] / slab[0];
                if (t1 > t2) { var swap = t1; t1 = t2; t2 = swap; }
                if (t1 > lo) lo = t1;
                if (t2 < hi) hi = t2;
            });
            if (!ok || hi - lo < 0.002) continue;
            d += 'M' + n(px + dx * lo) + ' ' + n(py + dy * lo) +
                'L' + n(px + dx * hi) + ' ' + n(py + dy * hi);
        }
        return d;
    }

    /* Wie viele Teile passen bei diesem Abstand auf diese Länge? Das ist der
       Kern des ganzen Umbaus: nicht die Sprosse wächst mit der Leiter, die
       Zahl der Sprossen tut es. */
    function countAt(span, pitch, lo, hi) {
        var k = Math.round(span / Math.max(0.005, pitch));
        return Math.min(hi === undefined ? 400 : hi, Math.max(lo === undefined ? 1 : lo, k));
    }

    /* Zeilen aus einem Text, ohne leere Zeilen oben und unten. Was jemand in
       der Mitte frei lässt, bleibt frei — das ist eine Gestaltung, keine
       Schlamperei. */
    function textLines(raw) {
        var lines = String(raw == null ? '' : raw).replace(/\r/g, '').split('\n')
            .map(function (s) { return s.trim(); });
        while (lines.length && !lines[lines.length - 1]) lines.pop();
        while (lines.length && !lines[0]) lines.shift();
        return lines;
    }

    /* ------------------------------------------------------------------ *
     * Die Vorschriften
     * ------------------------------------------------------------------ */

    var SHAPES = {

        /* ------------------------------------------------------------ Sofa */
        sofa: {
            params: [
                { key: 'arm', label: 'Arm width', min: 0.06, max: 0.4, step: 0.01, unit: 'length', def: 0.18 },
                { key: 'back', label: 'Back depth', min: 0.08, max: 0.5, step: 0.01, unit: 'length', def: 0.22 },
                { key: 'round', label: 'Corner radius', min: 0, max: 0.3, step: 0.01, unit: 'length', def: 0.07 }
            ],
            draw: function (w, h, o, u) {
                var sw = u * INK;
                var arm = clamp(o.arm, 0.03, w / 2 - 0.03);
                var back = clamp(o.back, 0.04, h - 0.06);
                var hw = w / 2, hh = h / 2;
                var inner = -hh + back;
                return box(-hw, -hh, w, h, o.round, sw) +
                    line('M' + n(-hw) + ' ' + n(inner) + 'H' + n(hw), sw) +
                    line('M' + n(-hw + arm) + ' ' + n(inner) + 'V' + n(hh), sw) +
                    line('M' + n(hw - arm) + ' ' + n(inner) + 'V' + n(hh), sw);
            }
        },

        /* -------------------------------------------------------- Sessel
         * Im Grundriss ist ein Sessel ein Sofa für einen. Er bekommt trotzdem
         * eine eigene Vorschrift, weil seine Vorgaben andere sind — schmalere
         * Lehnen, rundere Ecken — und weil das Sitzkissen bei einem einzelnen
         * Platz etwas aussagt, bei einer Bank für drei aber nur Striche macht. */
        armchair: {
            params: [
                { key: 'arm', label: 'Arm width', min: 0.05, max: 0.35, step: 0.01, unit: 'length', def: 0.14 },
                { key: 'back', label: 'Back depth', min: 0.06, max: 0.45, step: 0.01, unit: 'length', def: 0.18 },
                { key: 'round', label: 'Corner radius', min: 0, max: 0.3, step: 0.01, unit: 'length', def: 0.1 },
                { key: 'cushion', label: 'Show the seat cushion', type: 'toggle', def: false }
            ],
            draw: function (w, h, o, u) {
                var sw = u * INK;
                var arm = clamp(o.arm, 0.03, w / 2 - 0.04);
                var back = clamp(o.back, 0.04, h - 0.08);
                var hw = w / 2, hh = h / 2;
                var inner = -hh + back;
                /* Lehne und Armlehnen als ein umlaufendes Band, nicht als drei
                   Striche. Drei Striche ergaben im Kleinen ein Quadrat im
                   Quadrat; ein U liest sich sofort als Sessel. */
                var round = clamp(o.round, 0, Math.min(w, h) / 2);
                var r = Math.max(0, Math.min(round, arm, back) - 0.01);
                var out = box(-hw, -hh, w, h, round, sw) +
                    line('M' + n(-hw + arm) + ' ' + n(hh) +
                        'V' + n(inner + r) +
                        (r ? 'a' + n(r) + ' ' + n(r) + ' 0 0 1 ' + n(r) + ' ' + n(-r) : '') +
                        'H' + n(hw - arm - r) +
                        (r ? 'a' + n(r) + ' ' + n(r) + ' 0 0 1 ' + n(r) + ' ' + n(r) : '') +
                        'V' + n(hh), sw);
                if (!o.cushion) return out;
                var seatW = w - 2 * arm;
                var seatH = hh - inner;
                var air = Math.min(0.05, seatW / 7, seatH / 7);
                return out + box(-hw + arm + air, inner + air,
                    seatW - 2 * air, seatH - 2 * air, seatH / 4, sw * 0.8);
            }
        },

        /* --------------------------------------------------------- Bank
         * Eine Bank wird in der Mitte länger gezogen. Die Latten laufen der
         * Länge nach, also werden sie länger und nicht mehr; quer dazu passen
         * so viele nebeneinander, wie die Tiefe hergibt. Die Beinmarken an den
         * Enden behalten ihr Maß, egal wie lang die Bank wird. */
        bench: {
            params: [
                { key: 'slats', label: 'Boards in the seat', min: 1, max: 6, step: 1, def: 2 },
                { key: 'gap', label: 'Gap between the boards', min: 0, max: 0.12, step: 0.005, unit: 'length', def: 0.06 },
                { key: 'back', label: 'With a backrest', type: 'toggle', def: true },
                { key: 'rail', label: 'Depth of the backrest', min: 0.03, max: 0.3, step: 0.01, unit: 'length', def: 0.13, when: 'back' },
                { key: 'splay', label: 'Backrest stands out by', min: 0, max: 0.3, step: 0.01, unit: 'length', def: 0.12, when: 'back' },
                { key: 'leg', label: 'Legs set in from the end', min: 0, max: 0.5, step: 0.01, unit: 'length', def: 0.16 }
            ],
            draw: function (w, h, o, u) {
                var sw = u * INK;
                var hw = w / 2, hh = h / 2;
                var slats = Math.round(clamp(o.slats, 1, 8));
                var gap = clamp(o.gap, 0, h / (slats * 4));
                var splay = o.back ? clamp(o.splay, 0, w / 4) : 0;
                var sx = hw - splay;
                var foot = Math.min(0.05, h * 0.09);
                var out = '';
                var top = -hh;
                if (o.back) {
                    /* Die Lehne steht hinter dem Sitz und ragt an beiden Enden
                       heraus — so ist sie auf deinem Umbauplan gezeichnet. */
                    var rail = clamp(o.rail, 0.02, h * 0.45);
                    out += line('M' + n(-hw) + ' ' + n(-hh) + 'H' + n(hw) +
                        'L' + n(sx) + ' ' + n(-hh + rail) + 'H' + n(-sx) + 'Z', sw);
                    top = -hh + rail + gap;
                }
                /* Die Fugen liegen zwischen den Latten, nicht vor der ersten
                   und nicht hinter der letzten: die Vorderkante einer Bank
                   ist eine Latte, keine Lücke. */
                var seat = (hh - foot) - top;
                var board = (seat - gap * (slats - 1)) / slats;
                if (board < 0.004) { board = seat / slats; gap = 0; }
                for (var i = 0; i < slats; i++) {
                    out += box(-sx, top + i * (board + gap), sx * 2, board, 0, sw);
                }
                /* Die Beine stehen unter den Fugen durch und schauen vorne
                   heraus — die kleinen Striche an deiner Zeichnung. */
                var lx = Math.max(0.01, sx - clamp(o.leg, 0, sx - 0.02));
                var d = 'M' + n(-lx) + ' ' + n(hh - foot) + 'v' + n(foot) +
                        'M' + n(lx) + ' ' + n(hh - foot) + 'v' + n(foot);
                for (var k = 1; k < slats && gap > 0.004; k++) {
                    var y = top + k * board + (k - 1) * gap;
                    d += 'M' + n(-lx) + ' ' + n(y) + 'v' + n(gap) +
                         'M' + n(lx) + ' ' + n(y) + 'v' + n(gap);
                }
                return out + line(d, sw);
            }
        },

        /* --------------------------------------------------- Tisch, eckig */
        table: {
            params: [
                /* Der Schalter steht zuoberst. Stand er in der Mitte, rutschte
                   er beim Umlegen eine Zeile nach oben, weil der Wert darüber
                   verschwand — man traf dann das Falsche. */
                { key: 'cloth', label: 'With a tablecloth', type: 'toggle', def: false },
                { key: 'check', label: 'Size of one square', min: 0.08, max: 0.8, step: 0.01, unit: 'length', def: 0.3, when: 'cloth' },
                { key: 'leg', label: 'Leg mark', min: 0.04, max: 0.3, step: 0.01, unit: 'length', def: 0.14 },
                { key: 'round', label: 'Corner radius', min: 0, max: 0.3, step: 0.01, unit: 'length', def: 0 }
            ],
            draw: function (w, h, o, u) {
                var sw = u * INK;
                var hw = w / 2, hh = h / 2;
                /* Beine gehören zum Tisch, auch wenn eine Decke darauf liegt —
                   ein Tisch ohne Füße steht auf nichts. */
                var out = box(-hw, -hh, w, h, o.round, sw) + cornerLegs(w, h, o.leg, sw);
                if (!o.cloth) return out;
                /* Das Karo liegt über Eck und hängt an einer Kantenlänge in
                   Metern, nicht an einer Anzahl — sonst wird aus dem Quadrat
                   auf einer langen Tafel ein liegendes Rechteck. Es liegt bei
                   22,5 Grad statt 45: sonst deckt sich je eine Linie mit einer
                   Beinmarke, und der Tisch sieht aus, als stünde er auf nichts.
                   Gerade wiederum läse sich das Muster als Hintergrundraster. */
                var side = clamp(o.check, 0.03, Math.max(w, h));
                var d = hatch(hw, hh, side, CLOTH_ANGLE) +
                    hatch(hw, hh, side, CLOTH_ANGLE + 90);
                return out + (d ? line(d, sw * 0.7) : '');
            }
        },

        /* --------------------------------------- Tisch, rund bis oval */
        'table-round': {
            params: [
                { key: 'leg', label: 'Leg mark', min: 0.04, max: 0.3, step: 0.01, unit: 'length', def: 0.13, whenNot: 'pedestal' },
                { key: 'pedestal', label: 'On a single foot', type: 'toggle', def: false }
            ],
            draw: function (w, h, o, u) {
                var sw = u * INK;
                var rx = w / 2, ry = h / 2;
                var out = oval(rx, ry, sw);
                if (o.pedestal) {
                    /* Ein Mittelfuß ist rund, auch unter einer ovalen Platte.
                       Als Anteil beider Halbachsen gerechnet wurde er mit der
                       Platte mitgequetscht. */
                    var foot = Math.min(rx, ry) * 0.3;
                    return out + oval(foot, foot, sw);
                }
                /* Vier Beine auf den Diagonalen, nach innen zeigend. */
                var d = clamp(o.leg, 0.03, Math.min(rx, ry) / 1.6);
                var k = Math.SQRT1_2;
                var parts = '';
                [[-1, -1], [-1, 1], [1, 1], [1, -1]].forEach(function (s) {
                    var x0 = s[0] * rx * k, y0 = s[1] * ry * k;
                    parts += 'M' + n(x0) + ' ' + n(y0) +
                        'l' + n(-s[0] * d * k) + ' ' + n(-s[1] * d * k);
                });
                return out + line(parts, sw);
            }
        },

        /* -------------------------------------------------------- Klavier
         * Die Klaviatur liegt vorne, zum Publikum, und ihre Tiefe ist ein
         * echtes Maß. Die Tasten sind es nicht: eine weiße Taste ist 23 mm
         * breit, und im Maßstab 1:50 sind das 0,46 mm — fünfzig Striche, die
         * auf dem Papier zu einem grauen Band zusammenlaufen. Auf einem
         * Grundriss ist die Tastung ein Zeichen dafür, wo vorne ist, und
         * keine Abbildung. Sie wird deshalb gröber gesetzt, in dem Abstand,
         * der eingestellt ist; wer die echten 23 mm sehen will, schiebt
         * hinunter. Was dabei mitwächst, ist die Zahl und nicht die Breite:
         * die alte Zeichnung hatte vierzehn Tasten, gleich wie breit das
         * Klavier gezogen wurde. */
        piano: {
            params: [
                { key: 'lid', label: 'Depth of the keyboard', min: 0.06, max: 0.4, step: 0.01, unit: 'length', def: 0.22 },
                { key: 'key', label: 'Key spacing on the plan', min: 0.015, max: 0.15, step: 0.005, unit: 'length', def: 0.11 },
                { key: 'black', label: 'Draw the black keys', type: 'toggle', def: true }
            ],
            draw: function (w, h, o, u) {
                var sw = u * INK;
                var hw = w / 2, hh = h / 2;
                var lid = clamp(o.lid, 0.02, h * 0.85);
                var top = hh - lid;
                var out = box(-hw, -hh, w, h, 0, sw) +
                    line('M' + n(-hw) + ' ' + n(top) + 'H' + n(hw), sw);
                var keys = countAt(w, clamp(o.key, 0.008, 0.3), 1, 120);
                var kw = w / keys;
                var d = '';
                for (var i = 1; i < keys; i++) {
                    d += 'M' + n(-hw + kw * i) + ' ' + n(top) + 'V' + n(hh);
                }
                if (d) out += line(d, sw * 0.7);
                if (!o.black) return out;
                /* Hinter der ersten, zweiten, vierten, fünften und sechsten
                   weißen Taste einer Oktave sitzt eine schwarze. */
                var pattern = [0, 1, 3, 4, 5];
                /* Eine echte schwarze Taste ist 1,3 cm breit — auf einem
                   Grundriss ist sie damit unsichtbar. Sie folgt deshalb dem
                   gezeichneten Abstand, wie die weißen auch: halb so breit
                   wie eine weiße, zwei Drittel so tief wie die Klaviatur.
                   Das ist die Proportion der übernommenen Zeichnung. */
                var bw = kw * 0.5, bh = lid * 0.62;
                for (var k = 0; k < keys - 1; k++) {
                    if (pattern.indexOf(k % 7) === -1) continue;
                    var x = -hw + kw * (k + 1);
                    out += '<rect class="sp-key" x="' + n(x - bw / 2) + '" y="' + n(top) +
                        '" width="' + n(bw) + '" height="' + n(bh) +
                        '" stroke-width="' + n(sw * 0.7) + '"/>';
                }
                return out;
            }
        },

        /* ---------------------------------------------------------- Bett
         * Der Kopfteil liegt hinten, also nach der Bühne hin. Ab einer Breite
         * liegen zwei Kissen da statt einem — ab welcher, steht als Wert da,
         * weil ein Bett für zwei nicht überall gleich breit anfängt. */
        bed: {
            params: [
                { key: 'pillow', label: 'Pillow depth', min: 0.12, max: 0.5, step: 0.01, unit: 'length', def: 0.32 },
                { key: 'twin', label: 'Two pillows from this width on', min: 0.8, max: 2.4, step: 0.05, unit: 'length', def: 1.3 },
                { key: 'fold', label: 'Turn-down line', type: 'toggle', def: true },
                { key: 'round', label: 'Corner radius', min: 0, max: 0.2, step: 0.01, unit: 'length', def: 0.04 }
            ],
            draw: function (w, h, o, u) {
                var sw = u * INK;
                var hw = w / 2, hh = h / 2;
                var out = box(-hw, -hh, w, h, o.round, sw);
                var pillow = clamp(o.pillow, 0.06, h * 0.45);
                var inset = Math.min(0.08, w * 0.06);
                var top = -hh + inset;
                var pairs = w >= clamp(o.twin, 0.4, 4) ? 2 : 1;
                var span = w - 2 * inset;
                if (pairs === 2) {
                    var gap = Math.min(0.08, span * 0.08);
                    var each = (span - gap) / 2;
                    out += box(-hw + inset, top, each, pillow, sw * 2, sw) +
                        box(-hw + inset + each + gap, top, each, pillow, sw * 2, sw);
                } else {
                    out += box(-hw + inset, top, span, pillow, sw * 2, sw);
                }
                if (o.fold) {
                    var y = top + pillow + Math.min(0.18, (hh - top - pillow) * 0.35);
                    if (y < hh - 0.02) out += line('M' + n(-hw) + ' ' + n(y) + 'H' + n(hw), sw);
                }
                return out;
            }
        },

        /* ------------------------------------------------------ Paravent
         * Je länger der Wandschirm, desto mehr Knicke — die Flügelbreite
         * bleibt, was sie ist, und ihre Anzahl folgt aus der Länge. */
        screen: {
            params: [
                { key: 'panel', label: 'Width of one panel', min: 0.2, max: 1.2, step: 0.05, unit: 'length', def: 0.5 }
            ],
            draw: function (w, h, o, u) {
                var hw = w / 2, hh = h / 2;
                var folds = countAt(w, clamp(o.panel, 0.1, 4), 2, 24);
                var d = '';
                for (var i = 0; i <= folds; i++) {
                    d += (i ? 'L' : 'M') + n(-hw + w * i / folds) + ' ' + n(i % 2 ? -hh : hh);
                }
                return line(d, u * INK);
            }
        },

        /* ----------------------------------------------------------- Tür
         * Die Wand steht auf der vorderen Kante des Feldes, der Flügel
         * schlägt nach hinten auf. Der Flügel ist so breit wie die Öffnung,
         * also entspricht die Tiefe des Feldes einer Tür, die ganz offen
         * steht — was man aufreißt, steht damit auch im Plan. */
        door: {
            params: [
                { key: 'angle', label: 'Opening angle', min: 0, max: 180, step: 5, def: 90 },
                { key: 'right', label: 'Hinged on the right', type: 'toggle', def: false },
                { key: 'jamb', label: 'Width of one jamb', min: 0, max: 0.4, step: 0.01, unit: 'length', def: 0.12 }
            ],
            /* Die Tiefe einer Tür ist nichts, was man einstellt: sie ist, was
               der Flügel beim Aufgehen überstreicht, also seine Länge. Zieht
               man die Öffnung breiter, wird der Schwenk größer — von selbst,
               und nicht, weil jemand die zweite Zahl nachträgt. */
            depth: function (w, o) {
                return Math.max(0.05, w - 2 * clamp(o.jamb, 0, w / 2 - 0.02));
            },
            draw: function (w, h, o, u) {
                var sw = u * INK;
                var hw = w / 2, hh = h / 2;
                var jamb = clamp(o.jamb, 0, w / 2 - 0.02);
                var leaf = w - 2 * jamb;
                var side = o.right ? 1 : -1;
                var hinge = side * (hw - jamb);
                var a = clamp(o.angle, 0, 180) * Math.PI / 180;
                var tipX = hinge - side * leaf * Math.cos(a);
                var tipY = hh - leaf * Math.sin(a);
                var out = '';
                if (jamb > 0.001) {
                    out += line('M' + n(-hw) + ' ' + n(hh) + 'h' + n(jamb) +
                        'M' + n(hw - jamb) + ' ' + n(hh) + 'h' + n(jamb), sw * 1.4);
                }
                out += line('M' + n(hinge) + ' ' + n(hh) + 'L' + n(tipX) + ' ' + n(tipY), sw);
                /* Der Schwenk als gestrichelter Bogen, von der geschlossenen
                   Lage zur eingestellten. Bei 0° gibt es nichts zu zeigen. */
                if (a > 0.02) {
                    out += '<path class="sp-swing" d="M' + n(hinge - side * leaf) + ' ' + n(hh) +
                        'A' + n(leaf) + ' ' + n(leaf) + ' 0 0 ' + (o.right ? 1 : 0) + ' ' +
                        n(tipX) + ' ' + n(tipY) + '" stroke-width="' + n(sw * 0.8) +
                        '" stroke-dasharray="' + n(u * 5) + ' ' + n(u * 4) + '" fill="none"/>';
                }
                return out;
            }
        },

        /* -------------------------------------------------------- Teppich
         * Fransen bleiben Fransen: ihre Länge steht in Metern und ihr Abstand
         * auch, also werden es beim breiteren Teppich mehr und nicht längere.
         * Ein ovaler Teppich hat keine — dort steht stattdessen die Borte. */
        rug: {
            params: [
                { key: 'oval', label: 'Oval instead of rectangular', type: 'toggle', def: false },
                { key: 'fringe', label: 'Length of the fringe', min: 0, max: 0.25, step: 0.01, unit: 'length', def: 0.07, whenNot: 'oval' },
                { key: 'pitch', label: 'Space between the threads', min: 0.03, max: 0.3, step: 0.01, unit: 'length', def: 0.09, whenNot: 'oval' },
                { key: 'border', label: 'Border inside the edge', type: 'toggle', def: false },
                { key: 'inset', label: 'Border set in by', min: 0.03, max: 0.4, step: 0.01, unit: 'length', def: 0.1, when: 'border' }
            ],
            draw: function (w, h, o, u) {
                var sw = u * INK;
                var hw = w / 2, hh = h / 2;
                var inset = clamp(o.inset, 0.01, Math.min(w, h) / 2 - 0.01);
                if (o.oval) {
                    return oval(hw, hh, sw) +
                        (o.border ? oval(hw - inset, hh - inset, sw * 0.8) : '');
                }
                var fringe = clamp(o.fringe, 0, h / 2 - 0.02);
                var bodyH = h - 2 * fringe;
                var out = box(-hw, -hh + fringe, w, bodyH, 0, sw);
                if (o.border) {
                    var bi = Math.min(inset, w / 2 - 0.01, bodyH / 2 - 0.01);
                    if (bi > 0.005) out += box(-hw + bi, -hh + fringe + bi, w - 2 * bi, bodyH - 2 * bi, 0, sw * 0.8);
                }
                if (fringe > 0.004) {
                    var threads = countAt(w, clamp(o.pitch, 0.02, 1), 2, 200);
                    var d = '';
                    for (var i = 0; i <= threads; i++) {
                        var x = n(-hw + w * i / threads);
                        d += 'M' + x + ' ' + n(-hh) + 'v' + n(fringe);
                        d += 'M' + x + ' ' + n(hh - fringe) + 'v' + n(fringe);
                    }
                    out += line(d, sw * 0.8);
                }
                return out;
            }
        },

        /* -------------------------------------------------------- Leiter
         * Die Sprossenzahl folgt aus der Länge. Eine Leiter, die man länger
         * zieht, bekommt Sprossen dazu; ihr Abstand bleibt der, den man
         * eingestellt hat, weil man auf einer gedehnten Sprosse nicht steht. */
        ladder: {
            params: [
                { key: 'pitch', label: 'Space between the rungs', min: 0.15, max: 0.5, step: 0.01, unit: 'length', def: 0.28 }
            ],
            draw: function (w, h, o, u) {
                var sw = u * INK;
                var hw = w / 2, hh = h / 2;
                /* Die Holme sind zwei Striche. Als gezeichnete Kästen wurden
                   im Kleinen vier Linien daraus und die Leiter sah aus wie ein
                   Regal. Die Sprossen liegen dazwischen und sitzen nicht auf
                   Kopf und Fuß — dort ist keine. */
                var out = line('M' + n(-hw) + ' ' + n(-hh) + 'V' + n(hh) +
                    'M' + n(hw) + ' ' + n(-hh) + 'V' + n(hh), sw);
                var gaps = countAt(h, clamp(o.pitch, 0.05, 2), 2, 60);
                var d = '';
                for (var i = 1; i < gaps; i++) {
                    d += 'M' + n(-hw) + ' ' + n(-hh + h * i / gaps) + 'H' + n(hw);
                }
                return out + (d ? line(d, sw) : '');
            }
        },

        /* --------------------------------------------------- Stift, Kreide
         * Ein Strich Kreide auf dem Plan. Länger und kürzer, ohne dass die
         * Kontur mitwächst — mehr will er nicht können, und mehr braucht er
         * auch nicht. */
        stick: {
            params: [
                { key: 'taper', label: 'Taper towards the tip', min: 0, max: 0.6, step: 0.05, def: 0 }
            ],
            draw: function (w, h, o, u) {
                var sw = u * INK;
                var hw = w / 2, hh = h / 2;
                var taper = clamp(o.taper, 0, 0.9);
                var tip = hw - w * taper;
                if (taper < 0.01) return box(-hw, -hh, w, h, hh * 0.6, sw);
                /* Ein Stück, das zur Spitze hin schmaler wird. Die Spitze
                   zeigt in die Richtung, in die das Requisit gedreht ist. */
                return line('M' + n(-hw) + ' ' + n(-hh) + 'H' + n(tip) +
                    'L' + n(hw) + ' 0L' + n(tip) + ' ' + n(hh) + 'H' + n(-hw) + 'Z', sw);
            }
        },

        /* ------------------------------------------------- Markierungen */
        zone: {
            params: [],
            draw: function (w, h, o, u) {
                return '<rect class="sp-mark-zone" x="' + n(-w / 2) + '" y="' + n(-h / 2) +
                    '" width="' + n(w) + '" height="' + n(h) +
                    '" stroke-width="' + n(u * INK) + '" stroke-dasharray="' +
                    n(u * 7) + ' ' + n(u * 4.5) + '"/>';
            }
        },

        spike: {
            params: [],
            draw: function (w, h, o, u) {
                return line('M' + n(-w / 2) + ' 0H' + n(w / 2) +
                    'M0 ' + n(-h / 2) + 'V' + n(h / 2), u * INK, 'sp-mark');
            }
        },

        arrow: {
            params: [],
            draw: function (w, h, o, u) {
                /* Der Kopf richtet sich nach der Höhe des Pfeils, nicht nach
                   der Haarlinie. An der Haarlinie hing er am Zoom: derselbe
                   Pfeil bekam auf dem Bildschirm und auf dem Papier
                   verschieden große Köpfe, und die Höhe tat gar nichts. Jetzt
                   ist sie die Kopfbreite — ein langer Pfeil wird länger und
                   nicht dicker, weil die Länge nur den Schaft betrifft. */
                var half = h / 2;
                var head = Math.min(w * 0.5, h * 1.2);
                var tip = w / 2;
                var back = tip - head;
                return line('M' + n(-w / 2) + ' 0H' + n(back) +
                    'M' + n(back) + ' ' + n(-half) + 'L' + n(tip) + ' 0L' + n(back) + ' ' + n(half),
                    u * INK, 'sp-mark');
            }
        },

        /* ------------------------------------------------------- Textfeld
         * Das Feld trägt echten Text, über so viele Zeilen, wie jemand
         * eingibt. Die Schrift wird so groß gesetzt, dass die längste Zeile
         * und alle Zeilen zusammen hineinpassen — wer das Feld aufzieht,
         * bekommt größere Schrift, nicht mehr leeren Raum. Nach oben begrenzt
         * das eingestellte Höchstmaß, damit ein Wort in einem großen Feld
         * nicht zum Plakat wird. */
        label: {
            noFlip: true,
            params: [
                { key: 'border', label: 'Print the border', type: 'toggle', def: true },
                { key: 'pad', label: 'Air around the text', min: 0, max: 0.12, step: 0.005, unit: 'length', def: 0.025 },
                { key: 'cap', label: 'Letters at most this high', min: 0.04, max: 0.6, step: 0.01, unit: 'length', def: 0.2 }
            ],
            draw: function (w, h, o, u) {
                var plate = o.border === false ? ''
                    : '<rect class="sp-mark-plate" x="' + n(-w / 2) + '" y="' + n(-h / 2) +
                      '" width="' + n(w) + '" height="' + n(h) + '" stroke-width="' + n(u) + '"/>';
                var lines = textLines(o.text);
                if (!lines.length) {
                    /* Auf dem Papier bleibt ein leeres Feld leer. Am Bildschirm
                       steht ein blasser Hinweis, der sich vom Text absetzt —
                       sonst hält man ihn für Inhalt und wundert sich, dass er
                       nicht mitgedruckt wird. */
                    if (!o.hint) return plate;
                    return plate + '<text class="sp-mark-hint" x="0" y="' + n(h * 0.18) +
                        '" font-size="' + n(Math.min(h * 0.5, w * 0.5)) +
                        '" text-anchor="middle">' + esc(o.hint) + '</text>';
                }
                var pad = clamp(o.pad, 0, Math.min(w, h) * 0.4);
                var availW = Math.max(0.01, w - 2 * pad);
                var availH = Math.max(0.01, h - 2 * pad);
                var lh = 1.22;
                var longest = lines.reduce(function (m, s) { return Math.max(m, s.length); }, 1);
                /* 0,54 ist die mittlere Buchstabenbreite der Hausschrift, an
                   der Schrifthöhe gemessen. Sie muss nicht stimmen, sie muss
                   nur eher zu klein als zu groß sein: dann steht der Text
                   innerhalb des Feldes statt darüber hinaus. */
                var size = Math.min(availH / (lines.length * lh), availW / (longest * 0.54));
                size = Math.max(0.008, Math.min(size, clamp(o.cap, 0.01, 4)));
                var top = -lines.length * size * lh / 2;
                var parts = '';
                lines.forEach(function (text, i) {
                    if (!text) return;
                    parts += '<text class="sp-mark-text" x="0" y="' +
                        n(top + size * lh * (i + 0.5) + size * 0.35) +
                        '" font-size="' + n(size) + '" text-anchor="middle">' + esc(text) + '</text>';
                });
                return plate + parts;
            }
        }
    };

    /* ------------------------------------------------------------------ *
     * Zugriff
     * ------------------------------------------------------------------ */

    function nameOf(prop) {
        return (prop && (prop.shape || prop.mark)) || '';
    }

    /* ------------------------------------------------------------------ *
     * Zeichnungen ohne Bauvorschrift
     *
     * Auch sie werden in Bühnenmetern gesetzt, damit es nur einen Weg auf den
     * Plan gibt. Eine Zeichnung lebt in einem eigenen Feld — bei den
     * eingebauten 100 × 100 Einheiten, gefüllt aber nie ganz. Wie weit sie
     * darin wirklich reicht, steht als box in den Daten und wird nicht bei
     * jedem Zeichnen neu gemessen: unter Node gibt es nichts zu messen, und
     * eine Zahl, die auf dem Papier landet, sollte nicht davon abhängen, wie
     * ein Browser rundet.
     *
     * Der Faktor ist in beiden Richtungen derselbe. Ungleich skaliert würde
     * aus dem Kreis eine Ellipse und aus einer Kontur zwei verschiedene
     * Strichstärken — das war der Fehler, den der ganze Umbau abstellt. Passt
     * das Verhältnis der Standfläche nicht zu dem der Zeichnung, steht die
     * Zeichnung mittig darin und lässt einen Rand frei.
     * ------------------------------------------------------------------ */

    function artBox(prop) {
        var b = prop && prop.box;
        if (!b || b.length !== 4 || !(b[2] > 0) || !(b[3] > 0)) return [0, 0, 100, 100];
        return b;
    }

    function drawArt(prop, w, h, u) {
        if (prop.image) {
            /* Ein hochgeladenes Bild ist keine Kontur: es füllt die Fläche. */
            return '<image href="' + esc(prop.image) + '" x="' + n(-w / 2) + '" y="' + n(-h / 2) +
                '" width="' + n(w) + '" height="' + n(h) + '" preserveAspectRatio="none"/>';
        }
        if (!prop.art) return '';
        var b = artBox(prop);
        var k = Math.min(w / b[2], h / b[3]);
        return '<g class="sp-art" transform="scale(' + p6(k) + ') translate(' +
            p6(-(b[0] + b[2] / 2)) + ' ' + p6(-(b[1] + b[3] / 2)) + ')" stroke-width="' +
            p6(u * INK * (prop.sw || 1) / k) + '">' + prop.art + '</g>';
    }

    /* Manche Vorschriften rechnen ihre Tiefe aus der Breite: bei einer Tür
       ist die Tiefe der Schwenkbereich und damit die Flügellänge. Wo das so
       ist, führt die Breite, und die Tiefe folgt — beim Ziehen wie beim
       Eintragen. */
    function naturalDepth(prop, w, params) {
        var s = SHAPES[nameOf(prop)];
        if (!s || !s.depth) return null;
        return Math.round(s.depth(Math.max(0.02, w), values(prop, params)) * 1000) / 1000;
    }

    /* Wie groß wird die Zeichnung wirklich? Bei ungleichem Verhältnis füllt
       sie nur eine der beiden Kanten. */
    function extent(prop, w, h) {
        if (has(prop) || (prop && prop.image)) return { w: w, h: h };
        var b = artBox(prop);
        var k = Math.min(w / b[2], h / b[3]);
        return { w: b[2] * k, h: b[3] * k };
    }

    function has(prop) {
        return !!SHAPES[nameOf(prop)];
    }

    function spec(prop) {
        var s = SHAPES[nameOf(prop)];
        return s ? s.params.slice() : [];
    }

    /* Die eingestellten Werte, mit den Vorgaben der Vorschrift aufgefüllt.
       Ein Requisit, das nie angefasst wurde, zeichnet damit dasselbe wie
       eines, dessen Werte ausgeschrieben im Speicher stehen. */
    function values(prop, params) {
        var out = {};
        spec(prop).forEach(function (p) { out[p.key] = p.def; });
        Object.keys(params || {}).forEach(function (k) {
            if (params[k] !== undefined && params[k] !== null) out[k] = params[k];
        });
        return out;
    }

    /* Steht dieser Wert gerade zur Verfügung? „Falten" gibt es nur, solange
       eine Decke aufliegt, Fransen nur an einem eckigen Teppich. */
    function applies(param, vals) {
        if (param.when && !vals[param.when]) return false;
        if (param.whenNot && vals[param.whenNot]) return false;
        return true;
    }

    /* Was gerade zu bedienen ist, in der Reihenfolge der Vorschrift. */
    function live(prop, params) {
        var vals = values(prop, params);
        return spec(prop).filter(function (p) { return applies(p, vals); });
    }

    function draw(prop, w, h, params, u, extra) {
        extra = extra || {};
        var s = SHAPES[nameOf(prop)];
        var ww = Math.max(0.02, w), hh = Math.max(0.02, h);
        var inner;
        if (s) {
            var vals = values(prop, params);
            Object.keys(extra).forEach(function (k) { vals[k] = extra[k]; });
            inner = s.draw(ww, hh, vals, u);
        } else {
            inner = drawArt(prop || {}, ww, hh, u);
        }
        /* Umdrehen spiegelt die Zeichnung, bevor sie gedreht wird. Beim
           Textfeld nicht: gespiegelte Schrift ist keine Schrift. */
        if (extra.flip && !(s && s.noFlip)) {
            return '<g transform="scale(-1 1)">' + inner + '</g>';
        }
        return inner;
    }

    return {
        SHAPES: SHAPES,
        has: has,
        spec: spec,
        values: values,
        applies: applies,
        live: live,
        draw: draw,
        drawArt: drawArt,
        extent: extent,
        naturalDepth: naturalDepth,
        nameOf: nameOf,
        textLines: textLines
    };
}));
