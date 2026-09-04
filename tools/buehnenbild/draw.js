/*
 * Szenen- und Requisitenplaner — der Requisiten-Zeichner.
 *
 * Hier steht nur das Modell einer selbst gezeichneten Requisite und die
 * Umrechnung in fertiges SVG. Kein DOM, damit sich das Ergebnis unter Node
 * prüfen lässt — das Gezeichnete landet später unverändert im Druck, und ein
 * Fehler im Markup fällt auf dem Papier auf, nicht mehr im Browser.
 *
 * Alle Formen leben in einem Quadrat von 100 × 100. Das ist dieselbe Box wie
 * bei den eingebauten Zeichnungen: sie wird auf die Grundfläche der Requisite
 * gezogen, eine Kreisscheibe wird auf einer breiten Fläche also zur Ellipse.
 * Deshalb steht in der Ausgabe nie fit — sonst hielte die Zeichnung ihr
 * Seitenverhältnis fest und ließe sich nicht mehr passend ziehen.
 *
 * Strichfarbe und Strichstärke kommen von außen, vom umgebenden
 * <g class="sp-art">. Was hier erzeugt wird, trägt daher nie stroke oder
 * stroke-width, sondern nur eine der drei Klassen: f für die fast
 * durchsichtige Fläche, d für gestrichelt, s für volle Tinte.
 */
(function (root, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory();
    } else {
        root.SPDraw = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var BOX = 100;

    /* Die Werkzeuge in der Reihenfolge, in der sie in der Leiste stehen. */
    var TOOLS = [
        { id: 'select', label: 'Pick' },
        { id: 'rect', label: 'Box' },
        { id: 'ellipse', label: 'Round' },
        { id: 'line', label: 'Line' },
        { id: 'polyline', label: 'Open run' },
        { id: 'polygon', label: 'Closed run' }
    ];

    /* o steht für den blanken Umriss und schreibt gar keine Klasse. */
    var MODES = [
        { id: 'o', label: 'Line only' },
        { id: 'f', label: 'Tinted' },
        { id: 'd', label: 'Dashed' },
        { id: 's', label: 'Solid' }
    ];

    function num(value, fallback) {
        var n = typeof value === 'number' ? value : parseFloat(value);
        return isFinite(n) ? n : fallback;
    }

    function clamp(value) {
        var n = num(value, 0);
        return n < 0 ? 0 : (n > BOX ? BOX : n);
    }

    /* Eine Nachkommastelle reicht auf 100 Einheiten Kantenlänge — mehr bläht
       nur den Speicher, den sich alle Produktionen im Browser teilen. */
    function r1(value) {
        var n = Math.round(num(value, 0) * 10) / 10;
        return n === 0 ? 0 : n;
    }

    function fmt(value) {
        return String(r1(value));
    }

    function isMode(id) {
        for (var i = 0; i < MODES.length; i++) {
            if (MODES[i].id === id) return true;
        }
        return false;
    }

    /* --------------------------------------------------------- das Modell */

    /* Eine frische Form, so groß, dass man sie gleich sieht und anfassen kann. */
    function newShape(kind, mode) {
        var m = isMode(mode) ? mode : 'o';
        switch (kind) {
        case 'ellipse': return { k: 'ellipse', cx: 50, cy: 50, rx: 30, ry: 30, m: m };
        case 'line': return { k: 'line', x1: 20, y1: 50, x2: 80, y2: 50, m: m };
        case 'polyline': return { k: 'polyline', pts: [[20, 70], [50, 30], [80, 70]], m: m };
        case 'polygon': return { k: 'polygon', pts: [[50, 15], [85, 80], [15, 80]], m: m };
        default: return { k: 'rect', x: 20, y: 20, w: 60, h: 60, r: 0, m: m };
        }
    }

    /* Räumt eine Form auf: alles ins Quadrat, negative Kanten umgedreht,
       auf eine Nachkommastelle gerundet. Gibt eine Kopie zurück, damit sich
       ein laufender Zug nicht mitten im Ziehen selbst überschreibt. */
    function normalise(shape) {
        if (!shape) return null;
        var m = isMode(shape.m) ? shape.m : 'o';
        var pts;
        switch (shape.k) {
        case 'ellipse': {
            var rx = Math.abs(num(shape.rx, 0));
            var ry = Math.abs(num(shape.ry, 0));
            return {
                k: 'ellipse', m: m,
                cx: r1(clamp(shape.cx)), cy: r1(clamp(shape.cy)),
                rx: r1(Math.min(rx, BOX)), ry: r1(Math.min(ry, BOX))
            };
        }
        case 'line':
            return {
                k: 'line', m: m,
                x1: r1(clamp(shape.x1)), y1: r1(clamp(shape.y1)),
                x2: r1(clamp(shape.x2)), y2: r1(clamp(shape.y2))
            };
        case 'polyline':
        case 'polygon':
            pts = (shape.pts || []).map(function (p) {
                return [r1(clamp(p && p[0])), r1(clamp(p && p[1]))];
            });
            return { k: shape.k, m: m, pts: pts };
        default: {
            var x = clamp(shape.x);
            var y = clamp(shape.y);
            var w = num(shape.w, 0);
            var h = num(shape.h, 0);
            if (w < 0) { x = clamp(x + w); w = -w; }
            if (h < 0) { y = clamp(y + h); h = -h; }
            w = Math.min(w, BOX - x);
            h = Math.min(h, BOX - y);
            /* Die Rundung kann nie größer sein als die halbe kürzere Kante —
               sonst zeichnet der Browser sie stillschweigend kleiner und die
               Vorschau löge über das, was gespeichert ist. */
            var r = Math.max(0, Math.min(num(shape.r, 0), Math.min(w, h) / 2));
            return { k: 'rect', m: m, x: r1(x), y: r1(y), w: r1(w), h: r1(h), r: r1(r) };
        }
        }
    }

    /* Zu klein zum Sehen heißt: gar nicht erst zeichnen. Sonst bleiben beim
       Verklicken unsichtbare Formen in der Liste stehen. */
    function isDrawable(shape) {
        var s = normalise(shape);
        if (!s) return false;
        switch (s.k) {
        case 'ellipse': return s.rx >= 0.5 && s.ry >= 0.5;
        case 'line': return Math.abs(s.x2 - s.x1) >= 0.5 || Math.abs(s.y2 - s.y1) >= 0.5;
        case 'polyline': return s.pts.length >= 2;
        case 'polygon': return s.pts.length >= 3;
        default: return s.w >= 0.5 && s.h >= 0.5;
        }
    }

    function bounds(shape) {
        var s = normalise(shape);
        if (!s) return { x: 0, y: 0, w: 0, h: 0 };
        var xs, ys;
        switch (s.k) {
        case 'ellipse':
            return { x: s.cx - s.rx, y: s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
        case 'line':
            return {
                x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2),
                w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1)
            };
        case 'polyline':
        case 'polygon':
            if (!s.pts.length) return { x: 0, y: 0, w: 0, h: 0 };
            xs = s.pts.map(function (p) { return p[0]; });
            ys = s.pts.map(function (p) { return p[1]; });
            return {
                x: Math.min.apply(null, xs), y: Math.min.apply(null, ys),
                w: Math.max.apply(null, xs) - Math.min.apply(null, xs),
                h: Math.max.apply(null, ys) - Math.min.apply(null, ys)
            };
        default:
            return { x: s.x, y: s.y, w: s.w, h: s.h };
        }
    }

    function boundsOf(shapes) {
        var box = null;
        (shapes || []).forEach(function (shape) {
            var b = bounds(shape);
            if (!box) { box = { x: b.x, y: b.y, w: b.w, h: b.h }; return; }
            var x2 = Math.max(box.x + box.w, b.x + b.w);
            var y2 = Math.max(box.y + box.h, b.y + b.h);
            box.x = Math.min(box.x, b.x);
            box.y = Math.min(box.y, b.y);
            box.w = x2 - box.x;
            box.h = y2 - box.y;
        });
        return box || { x: 0, y: 0, w: 0, h: 0 };
    }

    function moveBy(shape, dx, dy) {
        var b = bounds(shape);
        return setBounds(shape, { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h });
    }

    /* Zieht eine Form in einen neuen Rahmen. Alles wird linear mitgezogen —
       auch ein Linienzug, damit die Griffe an der Auswahl für jede Form
       dasselbe tun. */
    function setBounds(shape, box) {
        var s = normalise(shape);
        if (!s) return null;
        var old = bounds(s);
        var nw = Math.max(0, num(box.w, old.w));
        var nh = Math.max(0, num(box.h, old.h));
        var nx = num(box.x, old.x);
        var ny = num(box.y, old.y);
        var sx = old.w > 0 ? nw / old.w : 1;
        var sy = old.h > 0 ? nh / old.h : 1;
        var mapX = function (v) { return nx + (v - old.x) * sx; };
        var mapY = function (v) { return ny + (v - old.y) * sy; };
        var mapped;

        switch (s.k) {
        case 'ellipse':
            mapped = { k: 'ellipse', m: s.m, cx: nx + nw / 2, cy: ny + nh / 2, rx: nw / 2, ry: nh / 2 };
            break;
        case 'line':
            mapped = { k: 'line', m: s.m, x1: mapX(s.x1), y1: mapY(s.y1), x2: mapX(s.x2), y2: mapY(s.y2) };
            break;
        case 'polyline':
        case 'polygon':
            mapped = { k: s.k, m: s.m, pts: s.pts.map(function (p) { return [mapX(p[0]), mapY(p[1])]; }) };
            break;
        default:
            mapped = { k: 'rect', m: s.m, x: nx, y: ny, w: nw, h: nh, r: s.r * Math.min(sx, sy) };
            break;
        }
        return normalise(mapped);
    }

    /* ------------------------------------------------------------ Ausgabe */

    /* Ein Element. cls überschreibt die Klasse — der Zeichner legt damit
       unsichtbare Kopien zum Anklicken über die Zeichnung. */
    function shapeMarkup(shape, cls) {
        if (!isDrawable(shape)) return '';
        var s = normalise(shape);
        var klass = cls === undefined ? (s.m === 'o' ? '' : s.m) : cls;
        var attr = klass ? ' class="' + klass + '"' : '';

        switch (s.k) {
        case 'ellipse':
            if (s.rx === s.ry) {
                return '<circle' + attr + ' cx="' + fmt(s.cx) + '" cy="' + fmt(s.cy) +
                    '" r="' + fmt(s.rx) + '"/>';
            }
            return '<ellipse' + attr + ' cx="' + fmt(s.cx) + '" cy="' + fmt(s.cy) +
                '" rx="' + fmt(s.rx) + '" ry="' + fmt(s.ry) + '"/>';
        case 'line':
            return '<path' + attr + ' d="M' + fmt(s.x1) + ' ' + fmt(s.y1) +
                ' L' + fmt(s.x2) + ' ' + fmt(s.y2) + '"/>';
        case 'polyline':
        case 'polygon':
            return '<path' + attr + ' d="M' + s.pts.map(function (p) {
                return fmt(p[0]) + ' ' + fmt(p[1]);
            }).join(' L') + (s.k === 'polygon' ? ' Z' : '') + '"/>';
        default:
            return '<rect' + attr + ' x="' + fmt(s.x) + '" y="' + fmt(s.y) +
                '" width="' + fmt(s.w) + '" height="' + fmt(s.h) + '"' +
                (s.r > 0 ? ' rx="' + fmt(s.r) + '"' : '') + '/>';
        }
    }

    /* Das fertige art einer Requisite: die Formen von hinten nach vorn. */
    function markup(shapes) {
        return (shapes || []).map(function (shape) {
            return shapeMarkup(shape);
        }).join('');
    }

    /* Formen, die überhaupt etwas ergeben — was gespeichert werden darf. */
    function clean(shapes) {
        return (shapes || []).filter(isDrawable).map(normalise);
    }

    return {
        BOX: BOX,
        TOOLS: TOOLS,
        MODES: MODES,
        newShape: newShape,
        normalise: normalise,
        isDrawable: isDrawable,
        bounds: bounds,
        boundsOf: boundsOf,
        moveBy: moveBy,
        setBounds: setBounds,
        shapeMarkup: shapeMarkup,
        markup: markup,
        clean: clean,
        clamp: clamp,
        round: r1
    };
}));
