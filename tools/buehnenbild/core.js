/*
 * Scene & Prop Planner — geometry and bookkeeping.
 *
 * Deliberately free of DOM access so the same code runs in the browser and
 * under Node for the test suite. Everything is measured in metres internally;
 * feet only exist at the edges, where numbers are read or written by a human.
 */
(function (root, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory(require('./i18n.js'));
    } else {
        root.SP = factory(root.SPI18n);
    }
}(typeof self !== 'undefined' ? self : this, function (I18n) {
    'use strict';

    var t = I18n ? I18n.t : function (key) { return key; };

    var FOOT = 0.3048;

    /* ------------------------------------------------------------------ *
     * Small helpers
     * ------------------------------------------------------------------ */

    function round(n, digits) {
        var f = Math.pow(10, digits === undefined ? 3 : digits);
        return Math.round(n * f) / f;
    }

    function clamp(n, lo, hi) {
        return n < lo ? lo : (n > hi ? hi : n);
    }

    var uidCounter = 0;
    function uid(prefix) {
        uidCounter += 1;
        return (prefix || 'id') + '-' +
            Date.now().toString(36) +
            uidCounter.toString(36) +
            Math.random().toString(36).slice(2, 6);
    }

    function num(value, fallback) {
        var n = typeof value === 'number' ? value : parseFloat(value);
        return isFinite(n) ? n : fallback;
    }

    /* ------------------------------------------------------------------ *
     * Units
     * ------------------------------------------------------------------ */

    /* Der Planer rechnet in Metern und in nichts sonst. Fuß und Zoll gab es
       einmal als Umschalter pro Produktion; er stand unauffindbar unten im
       Bühne-Reiter, kostete an jedem Zahlenfeld eine Umrechnung und war die
       Ursache dafür, dass im Feld „59.06" stand und in der Zeile darunter
       „59′–11″". Die beiden Funktionen bleiben als Durchreiche stehen, damit
       die Aufrufstellen nicht alle auf einmal umgebaut werden müssen. */
    function toUnit(metres) {
        return metres;
    }

    function toMetres(value) {
        return value;
    }

    /* Ein Maß, wie es eine Bühnenmannschaft schreibt. */
    function formatLength(metres) {
        var m = round(metres, 2);
        var text = Math.abs(m) < 10 ? m.toFixed(2) : m.toFixed(1);
        text = text.replace(/(\.\d*[1-9])0+$/, '$1').replace(/\.0+$/, '');
        var sep = I18n ? I18n.decimalSeparator() : '.';
        return text.replace('.', sep) + ' m';
    }

    function unitSuffix() {
        return 'm';
    }

    /* ------------------------------------------------------------------ *
     * Stage shapes
     *
     * Plan space: x = 0 is the centre line, positive x is towards the
     * audience's right (which is stage left). y = 0 is the upstage edge of
     * the bounding box and grows downstage, towards the audience. The
     * setting line — the front of the main stage, ignoring any apron — is
     * reported as frontY.
     * ------------------------------------------------------------------ */

    /* Vier Formen. Rund, Rundumbühne, Vieleck und die Gasse standen einmal
       dabei; an echten Häusern kommen sie kaum vor, und jede kostete eine
       Karte, ein eigenes Maßfeld und einen Zweig in der Geometrie. Die Gasse
       war dabei die teuerste Karte für das wenigste: derselbe Umriss wie das
       Rechteck, nur mit dem Publikum an den Längsseiten. Wer doch eine hat,
       kommt mit dem Vieleck-Umriss ohnehin nicht weit — der zeichnet keinen
       Zuschauerraum. */
    var STAGE_SHAPES = [
        {
            id: 'rect', name: 'Rectangular',
            fields: ['width', 'depth'], wings: true,
            blurb: 'End-on or proscenium. Audience downstage.'
        },
        {
            id: 'trapezoid', name: 'Trapezoid',
            fields: ['backWidth', 'width', 'depth'], wings: true,
            blurb: 'Narrower upstage than down, or the other way round.'
        },
        {
            id: 'thrust', name: 'Thrust',
            fields: ['width', 'depth', 'apronWidth', 'apronDepth'], wings: true,
            blurb: 'Main stage plus an apron the audience sits around.'
        },
        {
            id: 'halfround', name: 'Half round',
            fields: ['diameter'],
            blurb: 'Flat upstage wall, curved front edge.'
        }
    ];

    var DEFAULT_STAGE = {
        shape: 'rect',
        width: 12,
        depth: 9,
        backWidth: 8,
        diameter: 10,
        apronWidth: 7,
        apronDepth: 2.5,
        grid: { show: true, spacing: 1, labels: false },
        centreLine: true,
        settingLine: true,
        scaleBar: true,
        wings: { show: false, inset: 1.2, depth: 3.6 },
        curtains: [],
        markers: []
    };

    /*
     * Wie groß eine Bühne höchstens sein darf. 60 m ist breiter als jedes
     * Haus, in dem hier geplant wird; darüber wird nur die Zeichnung langsam,
     * weil jede Rasterlinie einzeln gerechnet wird. Nach unten sind 0,5 m die
     * kleinste Fläche, auf der noch etwas steht.
     */
    var STAGE_MIN = 0.5;
    var STAGE_MAX = 60;

    /* Feiner als ein Viertelmeter wird kein Raster — dieselbe Zahl, die auch
       im Zahlenfeld als kleinster Schritt steht. */
    var GRID_MIN = 0.25;

    /* Und ein Deckel auf die Linien selbst: was gespeichert ankommt, muss
       nicht durch die Felder gegangen sein. */
    var GRID_MAX_LINES = 400;

    /* Jedes Maß einer Bühne ist eine Länge; die Formen greifen sich daraus
       heraus, was sie brauchen. */
    var STAGE_LENGTHS = ['width', 'depth', 'backWidth', 'diameter', 'apronWidth', 'apronDepth'];

    /*
     * Eine Bühne, wie sie aus dem Speicher kommt, in ihre Grenzen ziehen —
     * Maße, Raster, Gassen und Vorhänge in einem Zug.
     *
     * Das stand einmal in drei Schritten in app.js, und der erste davon fehlte:
     * die Grenze war beschrieben, aber nicht gezogen. Eine Sicherung mit
     * 400.000 m kam ungebremst zurück und ließ den Planer nach jedem Neuladen
     * wieder sekundenlang rechnen. Hier steht es an einer Stelle und wird
     * geprüft.
     */
    function adoptStage(stage) {
        if (!stage) return stage;
        clampStage(stage);
        if (stage.wings) {
            ['inset', 'depth'].forEach(function (key) {
                var bound = stageBound('wings.' + key, stage);
                stage.wings[key] = round(clamp(num(stage.wings[key], bound.least),
                    bound.least, bound.most), 3);
            });
        }
        (stage.curtains || []).forEach(function (curtain) {
            var bound = stageBound('curtain.offset', stage);
            curtain.offset = round(clamp(num(curtain.offset, 0), bound.least, bound.most), 3);
        });
        return stage;
    }

    /*
     * Was ein Requisit an Maß und Ort haben darf.
     *
     * Größe höchstens so groß wie die Bühne: ein Esstisch ließ sich in einem
     * Zug auf 60 × 44 m aufziehen und per Feld auf 9999 m, ohne ein Wort —
     * die Meldung „steht außerhalb der Bühne" prüfte nur den Mittelpunkt und
     * schwieg zu einem Tisch, der das Blatt fünffach überdeckte.
     *
     * Stehen darf ein Stück bis eine Bühnenbreite quer und eine Bühnentiefe
     * tief daneben: Gasse, Lager und Hinterbühne bleiben möglich, aber nichts
     * verschwindet auf −1.000.000.000.000 m ins Nichts.
     */
    function propLimits(stage) {
        var b = stageOutline(stage).bounds;
        return {
            w: round(b.w, 3),
            h: round(b.h, 3),
            x: [round(b.x - b.w, 3), round(b.x + b.w * 2, 3)],
            y: [round(b.y - b.h, 3), round(b.y + b.h * 2, 3)]
        };
    }

    /*
     * Der Platz, den ein Requisit auf dem Plan wirklich einnimmt — als
     * achsenparalleles Rechteck, die Drehung eingerechnet.
     *
     * Ein 6 m langes Stück quer gestellt ragt 3 m zur Seite, nicht 0,15 m.
     * Wer w und h ungedreht nimmt, rechnet das Stück klein und schneidet es
     * ab; wer stattdessen überall max(w, h) nimmt, rechnet es an der kurzen
     * Seite zu groß, und eine Beschriftung daneben schwebt im Nichts. Beides
     * ist hier passiert, an zwei verschiedenen Stellen.
     */
    function placementBounds(p) {
        var a = (num(p.rot, 0) * Math.PI) / 180;
        var cos = Math.abs(Math.cos(a));
        var sin = Math.abs(Math.sin(a));
        var w = num(p.w, 0);
        var h = num(p.h, 0);
        var halfW = (w * cos + h * sin) / 2;
        var halfH = (w * sin + h * cos) / 2;
        return {
            x: num(p.x, 0) - halfW,
            y: num(p.y, 0) - halfH,
            w: halfW * 2,
            h: halfH * 2,
            halfW: halfW,
            halfH: halfH
        };
    }

    /* Der Kasten um alles, was in der Szene steht. Null, wenn nichts steht. */
    function placementsBounds(placements) {
        var list = placements || [];
        var box = null;
        for (var i = 0; i < list.length; i++) {
            var b = placementBounds(list[i]);
            if (!box) {
                box = { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
                continue;
            }
            box.x0 = Math.min(box.x0, b.x);
            box.y0 = Math.min(box.y0, b.y);
            box.x1 = Math.max(box.x1, b.x + b.w);
            box.y1 = Math.max(box.y1, b.y + b.h);
        }
        return box ? { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 } : null;
    }

    /*
     * Die Grenzen eines einzelnen Feldes, für Zahlenfeld und Prüfung.
     *
     * Manche hängen an der Bühne: eine Gasse, die weiter einrückt als die
     * halbe Breite, hat keine Seite mehr, und eine Vorbühne breiter als die
     * Bühne ist keine. Die Zeichnung hat das immer schon geklemmt — das Feld
     * und der Speicher nicht, und dann zeigte das Feld 99 m, während beide
     * Gassenlinien auf der Mittelachse lagen.
     */
    function stageBound(field, stage) {
        if (field === 'grid.spacing') return { least: GRID_MIN, most: STAGE_MAX };
        if (!stage) return { least: STAGE_MIN, most: STAGE_MAX };
        var width = clamp(num(stage.width, DEFAULT_STAGE.width), STAGE_MIN, STAGE_MAX);
        var depth = clamp(num(stage.depth, DEFAULT_STAGE.depth), STAGE_MIN, STAGE_MAX);
        if (field === 'wings.inset') {
            return { least: 0.05, most: round(Math.max(0.05, width / 2 - 0.05), 3) };
        }
        if (field === 'wings.depth') return { least: 0.05, most: depth };
        if (field === 'curtain.offset') {
            /* Ein Vorhang hängt bei `frontY − Abstand`. Weiter hinten als die
               Rückwand gibt es keinen Zug mehr: `spanAt` liefert dort nichts,
               und der Vorhang verschwand wortlos aus jedem Plan, während sein
               Griff über dem Bild lag. */
            var out = stageOutline(stage);
            return { least: 0, most: round(out.frontY - out.bounds.y, 3) };
        }
        if (field === 'apronWidth') return { least: STAGE_MIN, most: width };
        return { least: STAGE_MIN, most: STAGE_MAX };
    }

    /*
     * Zieht eine gespeicherte Bühne in ihre Grenzen zurück. Ohne das rechnet
     * ein Unsinnsmaß aus einer alten Sicherung nach jedem Neuladen wieder
     * minutenlang.
     */
    function clampStage(stage) {
        if (!stage) return stage;
        STAGE_LENGTHS.forEach(function (field) {
            if (stage[field] === undefined) return;
            stage[field] = round(clamp(num(stage[field], DEFAULT_STAGE[field]), STAGE_MIN, STAGE_MAX), 3);
        });
        if (stage.grid) {
            var bound = stageBound('grid.spacing');
            stage.grid.spacing = round(clamp(num(stage.grid.spacing, 1), bound.least, bound.most), 3);
        }
        return stage;
    }

    function shapeById(id) {
        for (var i = 0; i < STAGE_SHAPES.length; i++) {
            if (STAGE_SHAPES[i].id === id) return STAGE_SHAPES[i];
        }
        return STAGE_SHAPES[0];
    }

    function boundsOfPoints(pts) {
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (var i = 0; i < pts.length; i++) {
            if (pts[i][0] < minX) minX = pts[i][0];
            if (pts[i][0] > maxX) maxX = pts[i][0];
            if (pts[i][1] < minY) minY = pts[i][1];
            if (pts[i][1] > maxY) maxY = pts[i][1];
        }
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    /* Returns { d, bounds, frontY, audience, polygon? } for a stage. */
    function stageOutline(stage) {
        stage = stage || DEFAULT_STAGE;
        var W = Math.max(0.5, num(stage.width, 12));
        var D = Math.max(0.5, num(stage.depth, 9));
        var BW = Math.max(0.5, num(stage.backWidth, 8));
        var r = Math.max(0.25, num(stage.diameter, 10) / 2);

        switch (stage.shape) {
        case 'trapezoid': {
            var pts = [[-BW / 2, 0], [BW / 2, 0], [W / 2, D], [-W / 2, D]];
            return {
                d: 'M' + pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' L') + ' Z',
                bounds: boundsOfPoints(pts),
                frontY: D,
                audience: ['front'],
                polygon: pts
            };
        }
        case 'thrust': {
            var AW = clamp(num(stage.apronWidth, W * 0.6), 0.5, W);
            var AD = Math.max(0.2, num(stage.apronDepth, 2.5));
            var d = 'M' + (-W / 2) + ',0 H' + (W / 2) + ' V' + D +
                ' L' + (AW / 2) + ',' + D +
                ' A' + (AW / 2) + ',' + AD + ' 0 0 1 ' + (-AW / 2) + ',' + D +
                ' L' + (-W / 2) + ',' + D + ' Z';
            return {
                d: d,
                bounds: { x: -Math.max(W, AW) / 2, y: 0, w: Math.max(W, AW), h: D + AD },
                frontY: D,
                audience: ['front', 'left', 'right']
            };
        }
        case 'halfround': {
            return {
                d: 'M' + (-r) + ',0 H' + r + ' A' + r + ',' + r + ' 0 0 1 ' + (-r) + ',0 Z',
                bounds: { x: -r, y: 0, w: 2 * r, h: r },
                frontY: r,
                audience: ['front', 'left', 'right']
            };
        }
        default: {
            return {
                d: 'M' + (-W / 2) + ',0 H' + (W / 2) + ' V' + D + ' H' + (-W / 2) + ' Z',
                bounds: { x: -W / 2, y: 0, w: W, h: D },
                frontY: D,
                audience: ['front'],
                polygon: [[-W / 2, 0], [W / 2, 0], [W / 2, D], [-W / 2, D]]
            };
        }
        }
    }

    /* Horizontal extent of the stage floor at a given depth, or null when the
       line misses the stage entirely. Used to draw curtains and grid lines
       that stop at the edge of the floor instead of running off it. */
    function spanAt(stage, y) {
        stage = stage || DEFAULT_STAGE;
        var out = stageOutline(stage);
        var b = out.bounds;
        if (y < b.y - 1e-9 || y > b.y + b.h + 1e-9) return null;

        var W = Math.max(0.5, num(stage.width, 12));
        var D = Math.max(0.5, num(stage.depth, 9));
        var r = Math.max(0.25, num(stage.diameter, 10) / 2);

        switch (stage.shape) {
        case 'trapezoid': {
            var BW = Math.max(0.5, num(stage.backWidth, 8));
            var t = D === 0 ? 0 : clamp(y / D, 0, 1);
            var half = (BW + (W - BW) * t) / 2;
            return [-half, half];
        }
        case 'thrust': {
            if (y <= D) return [-W / 2, W / 2];
            var AW = clamp(num(stage.apronWidth, W * 0.6), 0.5, W);
            var AD = Math.max(0.2, num(stage.apronDepth, 2.5));
            var k = clamp((y - D) / AD, 0, 1);
            var halfA = (AW / 2) * Math.sqrt(Math.max(0, 1 - k * k));
            return halfA > 1e-6 ? [-halfA, halfA] : null;
        }
        case 'halfround': {
            var halfH = Math.sqrt(Math.max(0, r * r - y * y));
            return halfH > 1e-6 ? [-halfH, halfH] : null;
        }
        default:
            return [-W / 2, W / 2];
        }
    }

    /* Is a point on the stage floor? Used to warn about props parked in the
       wings, and to keep dragging sensible. */
    function containsPoint(stage, x, y) {
        var span = spanAt(stage, y);
        if (!span) return false;
        return x >= span[0] - 1e-9 && x <= span[1] + 1e-9;
    }

    /* ------------------------------------------------------------------ *
     * Gassen
     *
     * Die Abdeckung an den Seiten: von hinten kommt eine Linie nach vorne und
     * knickt dann zur Seitenkante ab. Was dahinter liegt, sieht das Publikum
     * nicht — dort steht, was noch auf seinen Auftritt wartet.
     * ------------------------------------------------------------------ */

    function hasWings(stage) {
        return !!shapeById(stage && stage.shape).wings;
    }

    function wingLines(stage) {
        var w = (stage && stage.wings) || {};
        if (!w.show || !hasWings(stage)) return [];
        var out = stageOutline(stage);
        var b = out.bounds;
        var inset = clamp(num(w.inset, 1.2), 0.05, Math.max(0.06, b.w / 2 - 0.05));
        var depth = clamp(num(w.depth, b.h * 0.8), 0.05, b.h);
        var yEnd = round(b.y + depth, 4);
        var left = round(b.x + inset, 4);
        var right = round(b.x + b.w - inset, 4);
        return [
            [[left, b.y], [left, yEnd], [round(b.x, 4), yEnd]],
            [[right, b.y], [right, yEnd], [round(b.x + b.w, 4), yEnd]]
        ];
    }

    /* Steht dieser Punkt in einer Gasse, also außer Sicht? */
    function inWing(stage, x, y) {
        var lines = wingLines(stage);
        if (!lines.length) return false;
        var yEnd = lines[0][1][1];
        if (y > yEnd) return false;
        return x < lines[0][0][0] || x > lines[1][0][0];
    }

    /* ------------------------------------------------------------------ *
     * Grid
     * ------------------------------------------------------------------ */

    function gridLines(stage, spacing) {
        var out = stageOutline(stage);
        var b = out.bounds;
        var s = Math.max(GRID_MIN, num(spacing, 1));
        /*
         * Ein Deckel auf die Linien. Ein Viertelmeter-Raster auf einer Bühne,
         * die aus einer alten Sicherung viel zu groß hereinkommt, ergäbe
         * Zehntausende Linien — und jede kostet Zeit, bei jedem Neuzeichnen.
         * Lieber gröbere Quadrate als ein Planer, der stehenbleibt.
         */
        var widest = Math.max(b.w, b.h);

        var vertical = [];
        var before = [];
        var horizontal = [];
        var after = [];
        var i;

        /* Nach vorn sammeln und einmal umdrehen: `unshift` rückt bei jeder
           Linie die ganze Liste weiter, was den Aufwand quadratisch macht. */
        for (i = 0; i * s <= b.x + b.w + 1e-9; i++) {
            if (i * s >= b.x - 1e-9) vertical.push(round(i * s, 4));
        }
        for (i = 1; -i * s >= b.x - 1e-9; i++) {
            before.push(round(-i * s, 4));
        }
        vertical = before.reverse().concat(vertical);

        for (i = 0; out.frontY - i * s >= b.y - 1e-9; i++) {
            horizontal.push(round(out.frontY - i * s, 4));
        }
        horizontal.reverse();
        for (i = 1; out.frontY + i * s <= b.y + b.h + 1e-9; i++) {
            after.push(round(out.frontY + i * s, 4));
        }
        horizontal = horizontal.concat(after);
        return { vertical: vertical, horizontal: horizontal, spacing: s, bounds: b, frontY: out.frontY };
    }

    function columnLetter(index) {
        var s = '';
        index = Math.max(0, index);
        do {
            s = String.fromCharCode(65 + (index % 26)) + s;
            index = Math.floor(index / 26) - 1;
        } while (index >= 0);
        return s;
    }

    /* Grid reference for a point, e.g. "C4": letters run left to right as the
       audience sees it, numbers run upstage from the setting line. */
    function gridReference(stage, x, y, spacing) {
        var out = stageOutline(stage);
        var s = Math.max(0.1, num(spacing, 1));
        var col = Math.floor((x - out.bounds.x) / s);
        var rowsFromFront = Math.floor((out.frontY - y) / s);
        return columnLetter(col) + String(Math.max(0, rowsFromFront) + 1);
    }

    /* ------------------------------------------------------------------ *
     * Describing a position the way a crew would say it
     * ------------------------------------------------------------------ */

    /*
     * Which way is "left"? Stage crews are split: some say it as the drawing
     * reads (the audience's left), some as the cast stands (their own left,
     * which is the drawing's right). The production decides, and everything
     * printed follows that one choice.
     */
    var directions = 'audience';

    function setDirections(mode) {
        directions = mode === 'cast' ? 'cast' : 'audience';
        return directions;
    }

    function directionMode() { return directions; }

    /* Positive x is drawn to the right of the page. From the cast's side of
       the footlights that same spot is on their left. */
    function sideKey(x) {
        var toDrawingRight = x > 0;
        if (directions === 'cast') toDrawingRight = !toDrawingRight;
        return toDrawingRight ? 'right' : 'left';
    }

    var DEPTH_ZONES = [
        { max: 0.2, key: 'front' },
        { max: 0.45, key: 'centre' },
        { max: 1.01, key: 'back' }
    ];

    /* A corner of the stage in the words a crew actually writes on a sheet:
       "hinten rechts", "vorne links", "Bühnenmitte". */
    function zoneName(stage, x, y) {
        var out = stageOutline(stage);
        var depth = out.bounds.h || 1;
        var fromFront = clamp((out.frontY - y) / depth, 0, 1);
        var band = 'centre';
        for (var i = 0; i < DEPTH_ZONES.length; i++) {
            if (fromFront <= DEPTH_ZONES[i].max) { band = DEPTH_ZONES[i].key; break; }
        }
        var halfWidth = (out.bounds.w || 1) / 2;
        var side = Math.abs(x) <= halfWidth * 0.2 ? 'centre' : sideKey(x);
        if (band === 'centre' && side === 'centre') return t('centre stage');
        if (side === 'centre') return t(band + ' centre');
        if (band === 'centre') return t('to the ' + side);
        return t(band + ' ' + side);
    }

    /* "2,40 m nach links, 3,10 m nach hinten" */
    function describePosition(stage, x, y) {
        var out = stageOutline(stage);
        var lateral = Math.abs(x) < 0.05
            ? t('on the centre line')
            : t('{len} to the ' + sideKey(x), { len: formatLength(Math.abs(x)) });
        var depth = out.frontY - y;
        var depthText = Math.abs(depth) < 0.05
            ? t('on the setting line')
            : t(depth >= 0 ? '{len} upstage' : '{len} downstage',
                { len: formatLength(Math.abs(depth)) });
        return lateral + ', ' + depthText;
    }

    /* ------------------------------------------------------------------ *
     * Placements
     * ------------------------------------------------------------------ */

    function makePlacement(prop, x, y) {
        var placement = {
            id: uid('pl'),
            trackId: uid('trk'),
            propId: prop.id,
            x: round(x, 3),
            y: round(y, 3),
            rot: 0,
            w: prop.w,
            h: prop.h,
            flip: false,
            label: '',
            note: '',
            locked: false
        };
        /* Ein Katalogeintrag darf Werte seiner Bauvorschrift mitbringen — so
           ist „Tisch mit Decke" derselbe Tisch wie „Tisch", nur mit
           aufgelegter Decke, und nicht ein zweiter Eintrag mit eigener
           Zeichnung, der irgendwann auseinanderläuft. */
        if (prop.params) placement.params = Object.assign({}, prop.params);
        return placement;
    }

    /* Mirror a whole layout across the centre line (or across the mid-depth
       line for 'vertical'). Rotations mirror too, so a chair still faces the
       way it did relative to its neighbours. */
    function mirrorPlacements(placements, axis, stage) {
        var out = stageOutline(stage || DEFAULT_STAGE);
        var midY = out.bounds.y + out.bounds.h / 2;
        return placements.map(function (p) {
            var copy = Object.assign({}, p);
            if (axis === 'vertical') {
                copy.y = round(2 * midY - p.y, 3);
                copy.rot = normaliseAngle(180 - p.rot);
            } else {
                copy.x = round(-p.x, 3);
                copy.rot = normaliseAngle(-p.rot);
                copy.flip = !p.flip;
            }
            return copy;
        });
    }

    function normaliseAngle(deg) {
        var a = deg % 360;
        if (a > 180) a -= 360;
        if (a < -180) a += 360;
        return round(a, 1);
    }

    /* Deep-copies a layout for another scene. Track ids are carried over so
       the change list can tell "the same table, moved" from "a new table". */
    function copyPlacements(placements, keepTracking) {
        return placements.map(function (p) {
            var copy = Object.assign({}, p);
            copy.id = uid('pl');
            if (!keepTracking) copy.trackId = uid('trk');
            return copy;
        });
    }

    /* ------------------------------------------------------------------ *
     * Scene to scene changes — the heart of a relocation plan
     * ------------------------------------------------------------------ */

    var MOVE_TOLERANCE = 0.12;   // metres
    var TURN_TOLERANCE = 4;      // degrees

    function distance(a, b) {
        var dx = a.x - b.x, dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function labelKey(p) {
        return (p.label || '').trim().toLowerCase();
    }

    /*
     * Pairs up the props of two scenes and reports what the crew has to do.
     * Matching runs in three passes, most reliable first:
     *   1. same tracking id (the layout was copied or edited in place)
     *   2. same prop and same written label ("Anna's chair")
     *   3. same prop, nearest first
     * Whatever is left over is genuinely coming on or going off.
     */
    function diffScenes(previous, current, options) {
        options = options || {};
        var tolerance = num(options.tolerance, MOVE_TOLERANCE);
        var prev = (previous && previous.placements ? previous.placements : []).slice();
        var cur = (current && current.placements ? current.placements : []).slice();

        var pairs = [];
        var prevLeft = prev.slice();
        var curLeft = cur.slice();

        function take(prevItem, curItem) {
            pairs.push({ from: prevItem, to: curItem });
            prevLeft.splice(prevLeft.indexOf(prevItem), 1);
            curLeft.splice(curLeft.indexOf(curItem), 1);
        }

        // Pass 1 — tracking id.
        curLeft.slice().forEach(function (c) {
            if (!c.trackId) return;
            for (var i = 0; i < prevLeft.length; i++) {
                if (prevLeft[i].trackId === c.trackId) { take(prevLeft[i], c); return; }
            }
        });

        // Pass 2 — same prop, same label.
        curLeft.slice().forEach(function (c) {
            if (!labelKey(c)) return;
            for (var i = 0; i < prevLeft.length; i++) {
                if (prevLeft[i].propId === c.propId && labelKey(prevLeft[i]) === labelKey(c)) {
                    take(prevLeft[i], c);
                    return;
                }
            }
        });

        // Pass 3 — same prop, closest first.
        var candidates = [];
        curLeft.forEach(function (c) {
            prevLeft.forEach(function (p) {
                if (p.propId === c.propId) candidates.push({ p: p, c: c, d: distance(p, c) });
            });
        });
        candidates.sort(function (a, b) { return a.d - b.d; });
        candidates.forEach(function (pair) {
            if (prevLeft.indexOf(pair.p) === -1 || curLeft.indexOf(pair.c) === -1) return;
            take(pair.p, pair.c);
        });

        var moved = [];
        var unchanged = [];
        pairs.forEach(function (pair) {
            var d = distance(pair.from, pair.to);
            var turned = Math.abs(normaliseAngle(pair.to.rot - pair.from.rot));
            var resized = Math.abs(pair.to.w - pair.from.w) > 0.05 || Math.abs(pair.to.h - pair.from.h) > 0.05;
            if (d > tolerance || turned > TURN_TOLERANCE || resized) {
                moved.push({
                    from: pair.from, to: pair.to,
                    distance: round(d, 3),
                    turned: round(turned, 1),
                    resized: resized
                });
            } else {
                unchanged.push(pair.to);
            }
        });

        return {
            added: curLeft,
            removed: prevLeft,
            moved: moved,
            unchanged: unchanged,
            isFirst: !previous
        };
    }

    function changeCount(diff) {
        return diff.added.length + diff.removed.length + diff.moved.length;
    }

    /* Groups identical props so a change list reads "3 × chair" rather than
       naming the same chair three times. */
    /*
     * Etwas zu einer Auswahl hinzufügen, ohne es doppelt hineinzulegen. Ein
     * Auswahlrahmen mit Shift über bereits Ausgewähltes hängte die Treffer
     * ungeprüft an: sichtbar änderte sich nichts, aber ein Pfeiltastendruck
     * schob danach zweimal und Strg+D legte zwei Kopien an.
     */
    function addToSelection(selection, hits) {
        var out = (selection || []).slice();
        (hits || []).forEach(function (id) {
            if (out.indexOf(id) === -1) out.push(id);
        });
        return out;
    }

    function groupByProp(placements, nameOf) {
        var order = [];
        var map = {};
        placements.forEach(function (p) {
            var key = p.propId + '|' + labelKey(p);
            if (!map[key]) {
                map[key] = { propId: p.propId, label: (p.label || '').trim(), count: 0, items: [], name: nameOf ? nameOf(p.propId) : p.propId };
                order.push(key);
            }
            map[key].count += 1;
            map[key].items.push(p);
        });
        return order.map(function (k) { return map[k]; });
    }

    /* ------------------------------------------------------------------ *
     * Scenes, acts and numbering
     * ------------------------------------------------------------------ */

    var ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
                 [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];

    function roman(n) {
        var out = '';
        n = Math.max(1, Math.round(n));
        for (var i = 0; i < ROMAN.length; i++) {
            while (n >= ROMAN[i][0]) { out += ROMAN[i][1]; n -= ROMAN[i][0]; }
        }
        return out;
    }

    /*
     * Works out the printed number for every scene in order. Continuous
     * numbering counts straight through the evening; per-act numbering
     * restarts inside each act and prefixes the act, as in "II.3".
     */
    function numberScenes(production) {
        var scenes = production.scenes || [];
        var acts = production.acts || [];
        var perAct = production.numbering === 'per-act' || production.numbering === 'per-act-roman';
        var romanScenes = production.numbering === 'per-act-roman';
        var actIndex = {};
        acts.forEach(function (a, i) { actIndex[a.id] = i + 1; });

        var counters = {};
        var running = 0;
        return scenes.map(function (scene) {
            running += 1;
            var label;
            if (scene.label) {
                label = scene.label;
            } else if (perAct && scene.actId && actIndex[scene.actId]) {
                counters[scene.actId] = (counters[scene.actId] || 0) + 1;
                label = roman(actIndex[scene.actId]) + '.' +
                    (romanScenes ? roman(counters[scene.actId]) : counters[scene.actId]);
            } else {
                label = String(running);
            }
            return { id: scene.id, label: label, index: running };
        });
    }

    function sceneNumbers(production) {
        var map = {};
        numberScenes(production).forEach(function (n) { map[n.id] = n; });
        return map;
    }

    /* Splits the running order into consecutive runs of the same act, which is
       what an audience actually sees and what the printed dividers follow. */
    function groupScenesByAct(production) {
        var actById = {};
        (production.acts || []).forEach(function (a) { actById[a.id] = a; });

        var groups = [];
        var current = null;
        (production.scenes || []).forEach(function (scene) {
            var act = scene.actId ? (actById[scene.actId] || null) : null;
            if (!current || current.act !== act) {
                current = { act: act, scenes: [] };
                groups.push(current);
            }
            current.scenes.push(scene);
        });
        return groups;
    }

    /* ------------------------------------------------------------------ *
     * Print pagination
     * ------------------------------------------------------------------ */

    function chunk(list, size) {
        var out = [];
        size = Math.max(1, Math.round(size));
        for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
        return out;
    }

    /* Overview sheets: cols × rows thumbnails per page. Acts can be kept on
       their own sheets so a page never straddles an interval. */
    function overviewPages(production, cols, rows, splitByAct) {
        var perPage = Math.max(1, cols * rows);
        if (!splitByAct) return chunk(production.scenes || [], perPage);
        var pages = [];
        groupScenesByAct(production).forEach(function (group) {
            chunk(group.scenes, perPage).forEach(function (page) {
                page.act = group.act;
                pages.push(page);
            });
        });
        return pages;
    }

    /* ------------------------------------------------------------------ *
     * Inventory
     * ------------------------------------------------------------------ */

    /* Every prop used anywhere, with the largest number needed at any one
       time — that number is what actually has to exist backstage. */
    function propInventory(production) {
        var totals = {};
        var order = [];
        (production.scenes || []).forEach(function (scene) {
            var perScene = {};
            (scene.placements || []).forEach(function (p) {
                perScene[p.propId] = (perScene[p.propId] || 0) + 1;
            });
            Object.keys(perScene).forEach(function (propId) {
                if (!totals[propId]) {
                    totals[propId] = { propId: propId, peak: 0, scenes: [], uses: 0 };
                    order.push(propId);
                }
                totals[propId].peak = Math.max(totals[propId].peak, perScene[propId]);
                totals[propId].uses += perScene[propId];
                totals[propId].scenes.push({ sceneId: scene.id, count: perScene[propId] });
            });
        });
        return order.map(function (id) { return totals[id]; });
    }

    /* ------------------------------------------------------------------ *
     * Places — a set that comes back
     *
     * The kitchen, the market, the cafe. A scene picks one; the printed
     * reference box lists what belongs in each. The standing prop list is
     * written by hand, because only the crew knows that the cafe needs a
     * coffee pot with a mouthful of water in it.
     * ------------------------------------------------------------------ */

    function newPlace(name) {
        return { id: uid('plc'), name: name || '', props: [], notes: '', placements: [] };
    }

    function placeById(production, id) {
        if (!id) return null;
        var places = production.places || [];
        for (var i = 0; i < places.length; i++) {
            if (places[i].id === id) return places[i];
        }
        return null;
    }

    function placeForScene(production, scene) {
        return scene ? placeById(production, scene.placeId) : null;
    }

    function scenesInPlace(production, placeId) {
        return (production.scenes || []).filter(function (s) { return s.placeId === placeId; });
    }

    /*
     * Jede Liste von Aufstellungen einer Produktion — die der Szenen und die
     * im gespeicherten Bühnenbild der Orte. Ein Ort hält eine zweite Kopie;
     * wer nur die Szenen aufräumt, lässt dort Geister stehen, die kein Plan
     * mehr zeichnet und trotzdem jede Zählung mitmacht.
     */
    function placementLists(production) {
        var out = [];
        (production.scenes || []).forEach(function (sc) {
            if (sc.placements) out.push(sc.placements);
        });
        (production.places || []).forEach(function (pl) {
            if (pl.placements) out.push(pl.placements);
        });
        return out;
    }

    /* Wie oft ein Requisit über alle Produktionen steht — Orte mitgezählt. */
    function countPropUses(productions, propId) {
        var total = 0;
        (productions || []).forEach(function (p) {
            placementLists(p).forEach(function (list) {
                list.forEach(function (pl) { if (pl.propId === propId) total += 1; });
            });
        });
        return total;
    }

    /* Und dasselbe zum Aufräumen: überall weg, auch aus den Orten. */
    function dropProp(productions, propId) {
        var removed = 0;
        (productions || []).forEach(function (p) {
            (p.scenes || []).forEach(function (sc) {
                var before = (sc.placements || []).length;
                sc.placements = (sc.placements || []).filter(function (pl) { return pl.propId !== propId; });
                removed += before - sc.placements.length;
            });
            (p.places || []).forEach(function (place) {
                var before = (place.placements || []).length;
                place.placements = (place.placements || []).filter(function (pl) { return pl.propId !== propId; });
                removed += before - place.placements.length;
            });
        });
        return removed;
    }

    /*
     * Was das Bühnenbild eines Orts verliert, wenn die Szene es ersetzt.
     * Gezählt wird je Requisit: was der Ort mehr hat als die Szene. Hält die
     * Szene alles und mehr, kommt eine leere Liste zurück — dann gibt es
     * nichts zu fragen.
     */
    function placeLoss(place, scene) {
        var had = {};
        var order = [];
        ((place && place.placements) || []).forEach(function (pl) {
            if (had[pl.propId] === undefined) { had[pl.propId] = 0; order.push(pl.propId); }
            had[pl.propId] += 1;
        });
        var keeps = {};
        ((scene && scene.placements) || []).forEach(function (pl) {
            keeps[pl.propId] = (keeps[pl.propId] || 0) + 1;
        });
        var items = [];
        var count = 0;
        var total = 0;
        order.forEach(function (propId) {
            total += had[propId];
            var lost = had[propId] - (keeps[propId] || 0);
            if (lost > 0) { items.push({ propId: propId, count: lost }); count += lost; }
        });
        return { items: items, count: count, total: total, all: count > 0 && count === total };
    }

    /*
     * Was zu einem Ort gehört. Steht ein Bühnenbild dahinter, wird die Liste
     * daraus gelesen; eine von Hand geschriebene Liste hat Vorrang, denn nur
     * die kennt „Gläser (1× leer, 1× leicht gefüllt)".
     */
    function placeItems(place, nameOf) {
        if (place.props && place.props.length) return place.props.slice();
        return groupByProp(place.placements || [], nameOf).map(describeGroup);
    }

    /* Rows for the reference box: every place a scene actually plays in, plus
       any place that has a set of its own. */
    function referenceRows(production, nameOf) {
        var used = {};
        (production.scenes || []).forEach(function (s) {
            if (s.placeId) used[s.placeId] = true;
        });
        return (production.places || []).filter(function (pl) {
            return used[pl.id] || (pl.props && pl.props.length) ||
                (pl.placements && pl.placements.length);
        }).map(function (pl) {
            return {
                id: pl.id,
                name: pl.name || '',
                items: placeItems(pl, nameOf),
                notes: pl.notes || '',
                used: !!used[pl.id],
                hasLayout: !!(pl.placements && pl.placements.length)
            };
        });
    }

    /*
     * Weicht eine Szene von ihrem Ort ab? Die Szene gewinnt immer — hier wird
     * nur festgestellt, nicht eingegriffen. Ohne Bühnenbild am Ort gibt es
     * nichts zu vergleichen.
     */
    function placeDrift(production, scene) {
        var place = placeForScene(production, scene);
        if (!place || !(place.placements || []).length) return null;
        var diff = diffScenes({ placements: place.placements }, scene);
        return { place: place, diff: diff, count: changeCount(diff) };
    }

    function scenesDriftingFrom(production, placeId) {
        return scenesInPlace(production, placeId).filter(function (sc) {
            var drift = placeDrift(production, sc);
            return drift && drift.count > 0;
        });
    }

    /* Übernimmt frühere Vorlagen als Orte — sie waren dasselbe, nur getrennt. */
    function foldPresetsIntoPlaces(production) {
        var presets = production.presets || [];
        if (!presets.length) return production;
        production.places = production.places || [];
        presets.forEach(function (preset) {
            var name = (preset.name || '').trim();
            var match = production.places.filter(function (pl) {
                return pl.name && pl.name.trim().toLowerCase() === name.toLowerCase();
            })[0];
            if (match) {
                if (!(match.placements || []).length) {
                    match.placements = copyPlacements(preset.placements || [], false);
                }
            } else {
                var place = newPlace(name);
                place.placements = copyPlacements(preset.placements || [], false);
                production.places.push(place);
            }
        });
        production.presets = [];
        return production;
    }

    /*
     * Liest die feste Liste aus dem Bühnenbild des Orts. Angeboten auf einen
     * Knopf, nie von selbst geschrieben: nur die Mannschaft weiß, ob im Glas
     * ein Schluck Wasser sein muss.
     */
    function suggestPlaceProps(production, placeId, nameOf) {
        var place = placeById(production, placeId);
        if (!place) return [];
        return groupByProp(place.placements || [], nameOf).map(describeGroup);
    }

    /* ------------------------------------------------------------------ *
     * Transitions — what the crew is told between two scenes
     *
     * Keyed by the pair of scene ids rather than by position, so reordering
     * the running order does not silently move a note onto a different change.
     * ------------------------------------------------------------------ */

    function transitionKey(fromScene, toScene) {
        return (fromScene ? fromScene.id : 'start') + '>' + (toScene ? toScene.id : 'end');
    }

    function getTransition(production, fromScene, toScene) {
        var map = production.transitions || {};
        return map[transitionKey(fromScene, toScene)] || null;
    }

    function ensureTransition(production, fromScene, toScene) {
        if (!production.transitions) production.transitions = {};
        var key = transitionKey(fromScene, toScene);
        if (!production.transitions[key]) {
            production.transitions[key] = { note: '', critical: false, banners: [] };
        }
        var trans = production.transitions[key];
        if (!trans.banners) trans.banners = [];
        return trans;
    }

    /* Drops notes whose two scenes no longer sit next to each other, so a
       reordered running order does not carry stale instructions around. */
    function pruneTransitions(production) {
        var map = production.transitions || {};
        var live = {};
        var scenes = production.scenes || [];
        for (var i = 0; i < scenes.length; i++) {
            live[transitionKey(i > 0 ? scenes[i - 1] : null, scenes[i])] = true;
        }
        Object.keys(map).forEach(function (key) {
            var trans = map[key];
            var empty = !trans || (!trans.note && !trans.critical &&
                (!trans.banners || !trans.banners.length));
            if (!live[key] || empty) delete map[key];
        });
        return production;
    }

    /* ------------------------------------------------------------------ *
     * The change-over plan
     * ------------------------------------------------------------------ */

    /* "3 × Stuhl (Anna)" */
    /* Ein mehrzeiliger Text in einer Zeile. Ein Textfeld auf der Bühne darf
       so viele Zeilen tragen, wie jemand hineinschreibt; in einer Liste und
       in der Spalte eines Umbauplans muss eine Zeile eine Zeile bleiben. */
    function oneLine(text) {
        return String(text == null ? '' : text).replace(/\s*\n+\s*/g, ' \u00b7 ').trim();
    }

    function describeGroup(group) {
        return (group.count > 1 ? group.count + ' \u00d7 ' : '') + group.name +
            (group.label ? ' (' + oneLine(group.label) + ')' : '');
    }

    /*
     * The whole evening as a list of table rows and banners, ready for the
     * printed Umbauplan. Row one is the preset: everything that stands before
     * the house opens, which is a change like any other as far as the crew is
     * concerned.
     */
    function changeoverRows(production, opts) {
        opts = opts || {};
        var nameOf = opts.nameOf || function (id) { return id; };
        var withPositions = !!opts.positions;
        var scenes = production.scenes || [];
        var numbers = sceneNumbers(production);
        var rows = [];

        function banners(trans, where) {
            ((trans && trans.banners) || []).forEach(function (b) {
                var at = b.where === 'after' ? 'after' : 'before';
                if (at !== where) return;
                rows.push({ type: 'banner', text: b.text || '', sub: b.sub || '' });
            });
        }

        function moveLine(stage, m) {
            var name = nameOf(m.to.propId) + (m.to.label ? ' (' + m.to.label + ')' : '');
            /* Ein Stück, das nur größer wird, steht nicht um. „Esstisch →
               hinten Mitte" wies die Mannschaft an, etwas dorthin zu stellen,
               wo es schon stand, und dass ein anderer, größerer Tisch gebraucht
               wird, stand nirgends. Jetzt steht das neue Maß da. */
            var size = m.resized
                ? formatLength(m.to.w) + ' \u00d7 ' + formatLength(m.to.h) : '';
            if (m.distance <= MOVE_TOLERANCE && m.turned <= TURN_TOLERANCE && size) {
                return name + ' \u2192 ' + size;
            }
            if (m.distance <= MOVE_TOLERANCE && m.turned > TURN_TOLERANCE) {
                return name + ' \u2192 ' + Math.round(m.to.rot) + '\u00b0' +
                    (size ? ', ' + size : '');
            }
            /* „Felder beschriften" gilt für sich. Vorher verlangte der Code
               zusätzlich, dass das Raster gezeichnet wird — im Beispiel ist es
               ab Werk aus, also tat das Häkchen nichts und sagte auch nichts.
               Ob man das Raster sehen will, ist eine andere Frage als die, wie
               der Umbauplan eine Stelle benennt. */
            var where = (stage.grid && stage.grid.labels)
                ? gridReference(stage, m.to.x, m.to.y, num(stage.grid.spacing, 1))
                : zoneName(stage, m.to.x, m.to.y);
            if (withPositions) {
                where += ' (' + describePosition(stage, m.to.x, m.to.y) + ')';
            }
            return name + ' \u2192 ' + where + (size ? ', ' + size : '');
        }

        scenes.forEach(function (scene, i) {
            var from = i > 0 ? scenes[i - 1] : null;
            var trans = getTransition(production, from, scene);
            var stage = scene.stage || production.stage;
            var diff = diffScenes(from, scene);

            banners(trans, 'before');
            rows.push({
                type: 'row',
                sceneId: scene.id,
                fromLabel: from ? numbers[from.id].label : t('Before the show'),
                toLabel: numbers[scene.id].label,
                title: scene.title || '',
                place: (placeForScene(production, scene) || {}).name || '',
                strike: groupByProp(diff.removed, nameOf).map(describeGroup),
                setup: groupByProp(diff.added, nameOf).map(describeGroup),
                move: diff.moved.map(function (m) { return moveLine(stage, m); }),
                note: (trans && trans.note) || '',
                critical: !!(trans && trans.critical),
                isPreset: !from
            });
            banners(trans, 'after');
        });

        return rows;
    }

    function changeoverIsEmpty(row) {
        return row.type === 'row' && !row.strike.length && !row.setup.length &&
            !row.move.length && !row.note;
    }

    return {
        FOOT: FOOT,
        round: round,
        clamp: clamp,
        uid: uid,
        num: num,
        toUnit: toUnit,
        toMetres: toMetres,
        formatLength: formatLength,
        unitSuffix: unitSuffix,
        STAGE_SHAPES: STAGE_SHAPES,
        DEFAULT_STAGE: DEFAULT_STAGE,
        STAGE_MIN: STAGE_MIN,
        STAGE_MAX: STAGE_MAX,
        STAGE_LENGTHS: STAGE_LENGTHS,
        GRID_MIN: GRID_MIN,
        GRID_MAX_LINES: GRID_MAX_LINES,
        stageBound: stageBound,
        propLimits: propLimits,
        placementBounds: placementBounds,
        placementsBounds: placementsBounds,
        clampStage: clampStage,
        adoptStage: adoptStage,
        shapeById: shapeById,
        stageOutline: stageOutline,
        spanAt: spanAt,
        containsPoint: containsPoint,
        hasWings: hasWings,
        wingLines: wingLines,
        inWing: inWing,
        gridLines: gridLines,
        columnLetter: columnLetter,
        gridReference: gridReference,
        zoneName: zoneName,
        describePosition: describePosition,
        setDirections: setDirections,
        directionMode: directionMode,
        newPlace: newPlace,
        placeById: placeById,
        placeForScene: placeForScene,
        scenesInPlace: scenesInPlace,
        placementLists: placementLists,
        countPropUses: countPropUses,
        dropProp: dropProp,
        placeLoss: placeLoss,
        referenceRows: referenceRows,
        placeItems: placeItems,
        placeDrift: placeDrift,
        scenesDriftingFrom: scenesDriftingFrom,
        foldPresetsIntoPlaces: foldPresetsIntoPlaces,
        suggestPlaceProps: suggestPlaceProps,
        transitionKey: transitionKey,
        getTransition: getTransition,
        ensureTransition: ensureTransition,
        pruneTransitions: pruneTransitions,
        describeGroup: describeGroup,
        oneLine: oneLine,
        changeoverRows: changeoverRows,
        changeoverIsEmpty: changeoverIsEmpty,
        makePlacement: makePlacement,
        mirrorPlacements: mirrorPlacements,
        copyPlacements: copyPlacements,
        normaliseAngle: normaliseAngle,
        diffScenes: diffScenes,
        changeCount: changeCount,
        groupByProp: groupByProp,
        addToSelection: addToSelection,
        roman: roman,
        numberScenes: numberScenes,
        sceneNumbers: sceneNumbers,
        groupScenesByAct: groupScenesByAct,
        chunk: chunk,
        overviewPages: overviewPages,
        propInventory: propInventory
    };
}));
