/*
 * Scene & Prop Planner — the ground plan drawing.
 *
 * One renderer feeds both the editor canvas and the printed sheets, so what
 * the artist arranges on screen is exactly what comes out of the printer.
 * Everything is measured in metres and drawn into a viewBox in metres, which
 * means line weights and type stay in proportion whether the plan ends up
 * 300 pixels wide or half of an A4 sheet.
 */
(function (root, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory(require('./core.js'), require('./i18n.js'), require('./shapes.js'));
    } else {
        root.SPPlan = factory(root.SP, root.SPI18n, root.SPShapes);
    }
}(typeof self !== 'undefined' ? self : this, function (SP, I18n, Shapes) {
    'use strict';

    var t = I18n ? I18n.t : function (key) { return key; };

    function esc(text) {
        return String(text === undefined || text === null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function n(value) {
        return Math.round(value * 1000) / 1000;
    }

    /* `true` heißt zeichnen, `false` heißt nicht zeichnen, und ohne Angabe
       entscheidet die Bühne. Vorher galt die Bühne bei Maßstabsbalken,
       Mittelachse und Bauflucht immer mit: das Kästchen im Drucken-Reiter
       blieb angehakt stehen und zeichnete nichts, solange dieselbe Sache im
       Bühne-Reiter ausgeschaltet war. Beim Raster war die Abhängigkeit schon
       aufgehoben — vier Nachbarn, die sich verschieden verhielten. */
    function wants(option, fallback) {
        return option === undefined || option === null ? !!fallback : !!option;
    }

    /* A drawn curtain: a run of soft folds rather than a straight line, so it
       reads as fabric at a glance. */
    function folds(x0, x1, y, amp, wavelength) {
        var span = x1 - x0;
        if (span <= 0) return '';
        var count = Math.max(2, Math.round(span / wavelength));
        var step = span / count;
        var d = 'M' + n(x0) + ' ' + n(y);
        for (var i = 0; i < count; i++) {
            var sign = i % 2 === 0 ? -1 : 1;
            d += ' Q' + n(x0 + step * (i + 0.5)) + ' ' + n(y + amp * sign) +
                 ' ' + n(x0 + step * (i + 1)) + ' ' + n(y);
        }
        return d;
    }

    function niceStep(target) {
        var candidates = [0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50];
        for (var i = 0; i < candidates.length; i++) {
            if (candidates[i] >= target) return candidates[i];
        }
        return candidates[candidates.length - 1];
    }

    /*
     * opts:
     *   stage, scene, resolve(propId) -> prop
     *   grid, gridLabels, centreLine, settingLine, curtains, audience,
     *   scaleBar, labels: 'none' | 'name' | 'custom' | 'both'
     *   ghosts: placements from the previous scene, drawn faintly
     *   interactive: adds hit targets and data-id attributes
     *   emphasise: { added: [id], moved: [id] }
     */
    function build(opts) {
        var stage = opts.stage || SP.DEFAULT_STAGE;
        var scene = opts.scene || { placements: [] };
        var resolve = opts.resolve || function () { return null; };
        var out = SP.stageOutline(stage);
        var b = out.bounds;

        var pad = Math.max(b.w, b.h) * 0.07;
        var audienceFront = out.audience.indexOf('front') !== -1 || out.audience.indexOf('ring') !== -1;
        var bottomPad = pad + (audienceFront ? Math.max(b.w, b.h) * 0.05 : 0);
        var view = {
            x: b.x - pad, y: b.y - pad,
            w: b.w + pad * 2, h: b.h + pad + bottomPad
        };

        var u = Math.max(b.w, b.h) / 500;          // one hairline, in metres
        var fs = Math.max(b.w, b.h) / 55;          // body type on the plan
        var parts = [];

        /* ---------------------------------------------------------- grid */
        var wantsGrid = wants(opts.grid, stage.grid && stage.grid.show);
        if (wantsGrid && stage.grid) {
            var spacing = SP.num(stage.grid.spacing, 1);
            var lines = SP.gridLines(stage, spacing);
            var g = [];
            lines.vertical.forEach(function (x) {
                g.push('M' + n(x) + ' ' + n(b.y) + ' V' + n(b.y + b.h));
            });
            lines.horizontal.forEach(function (y) {
                g.push('M' + n(b.x) + ' ' + n(y) + ' H' + n(b.x + b.w));
            });
            parts.push('<g class="sp-grid" clip-path="url(#' + (opts.idPrefix || 'sp') + '-clip)">' +
                '<path d="' + g.join(' ') + '" stroke-width="' + n(u * 0.7) + '"/></g>');

            if (stage.grid.labels) {
                var labels = [];
                for (var vi = 0; vi < lines.vertical.length - 1; vi++) {
                    var cx = (lines.vertical[vi] + lines.vertical[vi + 1]) / 2;
                    labels.push('<text x="' + n(cx) + '" y="' + n(b.y + fs * 1.1) +
                        '" font-size="' + n(fs * 0.72) + '" text-anchor="middle">' +
                        SP.columnLetter(vi) + '</text>');
                }
                for (var hi = lines.horizontal.length - 1; hi > 0; hi--) {
                    var cy = (lines.horizontal[hi] + lines.horizontal[hi - 1]) / 2;
                    if (cy > out.frontY) continue;   // the apron is not numbered
                    var rowNumber = SP.gridReference(stage, b.x + 0.01, cy, spacing).replace(/^[A-Z]+/, '');
                    labels.push('<text x="' + n(b.x + fs * 0.8) + '" y="' + n(cy + fs * 0.26) +
                        '" font-size="' + n(fs * 0.72) + '" text-anchor="middle">' + rowNumber + '</text>');
                }
                parts.push('<g class="sp-grid-label">' + labels.join('') + '</g>');
            }
        }

        /* ------------------------------------------------- stage outline */
        parts.push('<path class="sp-stage" d="' + out.d + '" stroke-width="' + n(u * 2.4) + '"/>');

        /* ---------------------------------------- centre and setting line */
        if (wants(opts.centreLine, stage.centreLine)) {
            parts.push('<path class="sp-guide sp-centre" d="M0 ' + n(b.y) + ' V' + n(b.y + b.h) +
                '" stroke-width="' + n(u * 1.1) + '" stroke-dasharray="' + n(u * 9) + ' ' + n(u * 5) + ' ' + n(u * 2) + ' ' + n(u * 5) + '"/>');
        }
        if (wants(opts.settingLine, stage.settingLine)) {
            var sl = spanAtSafe(stage, out.frontY);
            if (sl) {
                parts.push('<path class="sp-guide" d="M' + n(sl[0]) + ' ' + n(out.frontY) + ' H' + n(sl[1]) +
                    '" stroke-width="' + n(u * 1.1) + '" stroke-dasharray="' + n(u * 7) + ' ' + n(u * 4) + '"/>');
                var onEdge = Math.abs(out.frontY - (b.y + b.h)) < u * 2;
                parts.push('<text class="sp-guide-label" x="' + n(sl[1] - fs * 1.1) +
                    '" y="' + n(out.frontY + (onEdge ? fs * 0.95 : -fs * 0.55)) +
                    '" font-size="' + n(fs * 0.62) + '" text-anchor="end">' +
                    esc(t('Setting line')) + '</text>');
            }
        }

        /* ----------------------------------------------------------- Gassen */
        if (opts.wings !== false) {
            var wingSides = ['left', 'right'];
            SP.wingLines(stage).forEach(function (line, side) {
                var d = 'M' + line.map(function (pt) { return n(pt[0]) + ' ' + n(pt[1]); }).join(' L');
                parts.push('<path class="sp-guide sp-wing" d="' + d +
                    '" stroke-width="' + n(u * 1.4) + '" stroke-dasharray="' +
                    n(u * 3.2) + ' ' + n(u * 3.2) + '" stroke-linecap="butt"/>');
                /* Ein Zettel gehört in die Gasse, also legt man ihn dort an.
                   Bisher ging das nur über einen Knopf ganz unten im
                   Szene-Bereich, den niemand fand. */
                if (!opts.interactive) return;
                var corner = line[1];
                var edge = line[2][0];
                var cx = (corner[0] + edge) / 2;
                /* Ans Kopfende der Gasse, dorthin, wo der erste Zettel
                   erscheint. Gemessen an der Bühnenkante und nicht am Anfang
                   der Gassenlinie — die liegt weiter oben, und die Marke ritt
                   dadurch auf der Kante statt in der Gasse zu liegen. */
                var r = u * 8;
                /* Luft zwischen Bühnenkante und Marke. Bei zwei Haarlinien
                   klebte sie an der Kante und sah aus, als gehörte sie zur
                   Linie statt in die Gasse. */
                var cy = b.y + r + u * 8;
                /* Die Marke sagt, wie viele Zettel in dieser Gasse liegen. Als
                   blasses Plus in Haarlinie war sie von einer Bühnenmarkierung
                   nicht zu unterscheiden — die Griffe im Bühne-Reiter sind aus
                   demselben Grund kräftig. */
                var here = (opts.wingNotes || []).filter(function (note) {
                    return (note.side === 'left' ? 'left' : 'right') === wingSides[side];
                }).length;
                parts.push('<g class="sp-wing-add" data-act="wing-add" data-wing-add="' +
                    wingSides[side] + '">' +
                    '<circle class="sp-wing-add-ring" cx="' + n(cx) + '" cy="' + n(cy) +
                    '" r="' + n(r) + '" stroke-width="' + n(u * 1.2) + '"/>' +
                    (here
                        ? '<text class="sp-wing-add-count" x="' + n(cx) + '" y="' + n(cy + r * 0.36) +
                          '" font-size="' + n(r * 1.05) + '" text-anchor="middle">' + here + '</text>'
                        : '<path class="sp-wing-add-mark" d="M' + n(cx - r * 0.45) + ' ' + n(cy) +
                          'h' + n(r * 0.9) + 'M' + n(cx) + ' ' + n(cy - r * 0.45) + 'v' + n(r * 0.9) +
                          '" stroke-width="' + n(u * 1.4) + '"/>') +
                    '<circle class="sp-wing-add-hit" cx="' + n(cx) + '" cy="' + n(cy) +
                    '" r="' + n(r * 1.6) + '"><title>' + esc(here
                        ? I18n.plural(here, '1 thing waiting in this wing', '{n} things waiting in this wing')
                        : t('Something waiting in this wing')) +
                    '</title></circle></g>');
            });
        }

        /* ------------------------------------------------------ Gassenzettel
           Ein kleines Bild mit Bildunterschrift, in die Gasse gestellt: was
           dort bereitliegen muss, ohne dass es auf der Bühne steht. */
        if (opts.wingNotes && opts.wingNotes.length) {
            var wl = SP.wingLines(stage);
            if (wl.length) {
                /* Ein Zettelbild ist ein Zeichen, kein Maß: es sagt „diese
                   Sache", nicht „so groß". Bei neun Prozent der Bühne wurde
                   daraus ein halber Meter Papier für eine Tasse. Fünfeinhalb
                   Prozent sind auf A4 rund zehn Millimeter — doppelt so viel,
                   wie zum Erkennen nötig ist, und halb so viel wie vorher. */
                var noteSize = Math.min(b.w, b.h) * 0.055;
                /* Ein Maß für jeden Abstand in der Gasse: unter der Kante,
                   zwischen Marke und Bild, zwischen Bild und Unterschrift,
                   zwischen zwei Zetteln. Vorher war jeder davon eine eigene
                   Zahl, und keine passte zur anderen. */
                var gap = noteSize * 0.34;
                var lineH = fs * 0.85;
                var wingDepth = Math.abs(wl[0][1][1] - wl[0][0][1]);
                /* Der Platz oben gehört der Marke: sie endet bei 24
                   Haarlinien unter der Kante, darunter beginnt der Stapel. */
                var top = b.y + u * 24 + gap;
                var bottom = b.y + wingDepth;
                var noteFs = fs * 0.66;
                /* So breit ist die Gasse, in der der Zettel steht. */
                var column = Math.abs(wl[0][0][0] - b.x) - gap;
                var sides = { left: [], right: [] };
                opts.wingNotes.forEach(function (note) {
                    sides[note.side === 'left' ? 'left' : 'right'].push(note);
                });

                /* Was ein Zettel an Höhe braucht — und was von ihm bleibt,
                   wenn die Gasse nicht so tief ist. Vorher wurde der erste
                   Zettel ungeprüft gesetzt und seine eigene Höhe nie
                   gedeckelt: sechzig Wörter reichten für 61 Zeilen, deren
                   unterste anderthalb Meter unterhalb des Blattes lag. */
                function fitWing(list, limit) {
                    var y = top;
                    var placed = [];
                    var dropped = 0;
                    list.forEach(function (note) {
                        var prop = opts.resolve ? opts.resolve(note.propId) : null;
                        /* Ein Bild behält seine Form: aus einem Stück Kreide
                           von elf mal zwei Zentimetern wurde sonst ein
                           Quadrat, weil der Zettel jedem Bild dieselbe
                           Kantenlänge gab. */
                        var big = prop ? Math.max(prop.w, prop.h) || 1 : 1;
                        var shrink = noteSize / big;
                        var nw = prop ? prop.w * shrink : 0;
                        var nh = prop ? prop.h * shrink : 0;
                        var head = prop ? nh + gap : 0;
                        var lines = wrapToWidth(note.text, noteFs, column);
                        var room = limit - y - head - gap;
                        var fits = lines.length ? Math.floor(room / lineH) : 0;
                        if (!lines.length ? head && y + head + gap > limit : fits < 1) {
                            dropped += 1;
                            return;
                        }
                        /* Lieber der Anfang eines langen Zettels mit einem
                           Auslassungszeichen als ein Zettel, der über das
                           Blatt hinausläuft — oder gar keiner. */
                        if (lines.length > fits) {
                            lines = lines.slice(0, fits);
                            lines[fits - 1] = lines[fits - 1] + '…';
                        }
                        placed.push({ prop: prop, nw: nw, nh: nh, k: shrink, lines: lines, y: y });
                        y += head + lines.length * lineH + gap;
                    });
                    return { placed: placed, dropped: dropped, y: y };
                }

                /* Die Meldung bricht wie ein Zettel um: gekürzt wäre sie
                   „noch 26, kein…" und sagte damit gerade das nicht mehr,
                   wofür sie da ist. */
                function noRoom(count) {
                    return wrapToWidth(
                        I18n.plural(count, '1 more, no room here', '{n} more, no room here'),
                        noteFs, column);
                }

                ['left', 'right'].forEach(function (side) {
                    var list = sides[side];
                    if (!list.length) return;
                    var edge = side === 'left' ? b.x : b.x + b.w;
                    var inner = side === 'left' ? wl[0][0][0] : wl[1][0][0];
                    var cx = (edge + inner) / 2;
                    /* Zweimal gerechnet: passt alles, gehört die Gasse den
                       Zetteln. Bleibt etwas weg, gehören die untersten Zeilen
                       der Meldung darüber — sonst stünde sie auf dem letzten
                       Zettel oder, wie vorher, unter dem Blattrand. */
                    var laid = fitWing(list, bottom);
                    if (laid.dropped) {
                        laid = fitWing(list, bottom - noRoom(laid.dropped).length * lineH);
                    }

                    laid.placed.forEach(function (item) {
                        var y = item.y;
                        if (item.prop) {
                            /* Gezeichnet wird das Requisit in seiner wirklichen
                               Größe und danach auf Zettelmaß verkleinert — nicht
                               in Zettelmaß neu gebaut. Eine Bauvorschrift rechnet
                               sich sonst für das kleine Maß neu aus: eine Leiter
                               von 36 Zentimetern bekommt eine einzige Sprosse
                               und steht als „H" in der Gasse.

                               Die Haarlinie geht durch dieselbe Verkleinerung
                               und kommt hinterher wieder bei ihrer Stärke
                               heraus. Ohne eigene id, denn ein Gassenzettel ist
                               keine Aufstellung auf der Bühne. */
                            parts.push('<g class="sp-wing-note" transform="translate(' + n(cx) + ' ' +
                                n(y + item.nh / 2) + ') scale(' + n(item.k) + ')">' +
                                propInner({ x: 0, y: 0, w: item.prop.w, h: item.prop.h, rot: 0 },
                                    item.prop, u / item.k, {}) + '</g>');
                            y += item.nh + gap;
                        }
                        item.lines.forEach(function (line, i) {
                            parts.push('<text class="sp-wing-note-label" x="' + n(cx) + '" y="' +
                                n(y + lineH * (i + 0.8)) + '" font-size="' + n(noteFs) +
                                '" text-anchor="middle">' + esc(line) + '</text>');
                        });
                    });

                    /* Was nicht mehr in die Gasse passt, verschweigt der Plan
                       nicht — vorher lief der Stapel stumm über das Blatt
                       hinaus, samt dieser Meldung. */
                    if (!laid.dropped) return;
                    var msg = noRoom(laid.dropped);
                    var msgTop = Math.min(laid.y, bottom - msg.length * lineH);
                    msg.forEach(function (line, i) {
                        parts.push('<text class="sp-wing-note-label" x="' + n(cx) +
                            '" y="' + n(msgTop + lineH * (i + 0.8)) +
                            '" font-size="' + n(noteFs) + '" text-anchor="middle">' +
                            esc(line) + '</text>');
                    });
                });
            }
        }

        /* ------------------------------------------------------- curtains */
        if (opts.curtains !== false && stage.curtains && stage.curtains.length) {
            var states = (scene && scene.curtains) || {};
            stage.curtains.forEach(function (curtain) {
                var y = out.frontY - SP.num(curtain.offset, 0);
                var span = spanAtSafe(stage, y);
                if (!span) return;
                var state = states[curtain.id] || curtain.state || 'closed';
                var amp = Math.max(b.w, b.h) * 0.012;
                var wl = (span[1] - span[0]) / 18;
                var sw = n(u * 2.2);
                var pieces = [];

                if (state === 'closed') {
                    pieces.push('<path d="' + folds(span[0], span[1], y, amp, wl) + '" stroke-width="' + sw + '"/>');
                } else {
                    var share = state === 'half' ? 0.34 : 0.16;
                    var width = (span[1] - span[0]) * share;
                    pieces.push('<path d="' + folds(span[0], span[0] + width, y, amp, wl * 0.7) + '" stroke-width="' + sw + '"/>');
                    pieces.push('<path d="' + folds(span[1] - width, span[1], y, amp, wl * 0.7) + '" stroke-width="' + sw + '"/>');
                    pieces.push('<path class="sp-curtain-track" d="M' + n(span[0] + width) + ' ' + n(y) +
                        ' H' + n(span[1] - width) + '" stroke-width="' + n(u * 0.9) +
                        '" stroke-dasharray="' + n(u * 4) + ' ' + n(u * 4) + '"/>');
                }
                /* Der Vorhangname ist ein <text> ohne Grenze: 552 Zeichen
                   liefen 469 Bildpunkte über den rechten Blattrand hinaus und
                   brachen dort mitten im Wort ab. Jetzt endet er am Blatt. */
                var labelX = span[0] + fs * 1.9;
                var labelText = (curtain.name || t('Curtain')) +
                    (state === 'closed' ? '' : ', ' + t('curtain state ' + state));
                pieces.push('<text class="sp-curtain-label" x="' + n(labelX) +
                    '" y="' + n(y - amp - fs * 0.55) +
                    '" font-size="' + n(fs * 0.62) + '">' +
                    esc(Shapes.clipText(labelText, fs * 0.62, view.x + view.w - labelX - fs * 0.4)) + '</text>');
                parts.push('<g class="sp-curtain">' + pieces.join('') + '</g>');
            });
        }

        /* ------------------------------------------------------- audience */
        if (opts.audience !== false) {
            parts.push(audienceMarks(out, b, u, fs));
        }

        /* --------------------------------------------------------- ghosts */
        if (opts.ghosts && opts.ghosts.length) {
            var ghostParts = [];
            opts.ghosts.forEach(function (p) {
                var prop = resolve(p.propId);
                if (!prop) return;
                ghostParts.push(drawProp(p, prop, u, { ghost: true }));
            });
            if (opts.ghostArrows) {
                opts.ghostArrows.forEach(function (move) {
                    ghostParts.push(moveArrow(move.from, move.to, u));
                });
            }
            parts.push('<g class="sp-ghosts">' + ghostParts.join('') + '</g>');
        }

        /* ---------------------------------------------------------- props */
        var placements = (scene.placements || []).slice();
        var emphasise = opts.emphasise || {};
        var body = [];
        var captions = [];
        var solid = [];
        placements.forEach(function (p, index) {
            var prop = resolve(p.propId);
            if (!prop) return;
            var flags = {
                added: emphasise.added && emphasise.added.indexOf(p.id) !== -1,
                moved: emphasise.moved && emphasise.moved.indexOf(p.id) !== -1,
                selected: opts.selected && opts.selected.indexOf(p.id) !== -1,
                interactive: opts.interactive
            };
            body.push(drawProp(p, prop, u, flags));
            var reach = Math.max(p.w, p.h) / 2;
            /* Was auf dem Plan steht, ist für eine Beschriftung im Weg. */
            solid.push({ x: p.x, y: p.y, w: p.w, h: p.h, r: reach });
            var caption = captionFor(p, prop, index, opts.labels);
            if (caption) {
                captions.push({ x: p.x, y: p.y, reach: reach, text: caption });
            }
        });
        parts.push('<g class="sp-items">' + body.join('') + '</g>');

        /* Eine Beschriftung wich bisher nur anderen Beschriftungen aus, und
           immer nach unten — deshalb landete sie auf dem nächsten Requisit,
           und dessen Name wurde noch weiter geschoben, bis er bei einem
           dritten stand. Jetzt sind auch die Requisiten selbst im Weg, und
           gesucht wird ringsherum. Findet sich nichts, bleibt der Name nah
           dran und ein dünner Strich sagt, wozu er gehört.

           Die Textbreite wird geschätzt: SVG misst Text nicht, ohne ihn zu
           setzen. Zum Ausweichen reicht das. */
        if (captions.length) {
            var line = fs * 1.25;
            var taken = [];
            /* unten, oben, rechts, links — und dasselbe eine Zeile weiter weg */
            var SPOTS = [[0, 1], [0, -1], [1, 0], [-1, 0], [0, 2], [0, -2], [1.6, 0.6], [-1.6, 0.6]];
            captions.sort(function (a, b) { return a.y - b.y || a.x - b.x; });

            var free = function (cx, cy, w) {
                var hits = function (o) {
                    return Math.abs(cx - o.x) < (w + o.w) / 2 && Math.abs(cy - o.y) < (line + o.h) / 2;
                };
                return !taken.some(hits) && !solid.some(hits);
            };

            var drawn = captions.map(function (label) {
                var w = Math.max(Shapes.textWidth(label.text, fs), fs);
                var best = null;
                for (var i = 0; i < SPOTS.length && !best; i++) {
                    var cx = label.x + SPOTS[i][0] * (label.reach + w / 2 + fs * 0.35);
                    var cy = label.y + SPOTS[i][1] * (label.reach + line * 0.75);
                    if (free(cx, cy, w)) best = { x: cx, y: cy, far: i > 3 };
                }
                /* Sind alle acht Plätze besetzt — vier Tassen auf einem Tisch
                   schaffen das —, wird weiter nach unten gesucht, statt alles
                   auf denselben Fleck zu legen. Genau das passierte vorher:
                   drei Namen übereinander und einer davon zweimal. */
                for (var k = 1; k <= 12 && !best; k++) {
                    var below = label.y + label.reach + line * (0.75 + k);
                    if (free(label.x, below, w)) best = { x: label.x, y: below, far: true };
                }
                if (!best) best = { x: label.x, y: label.y + label.reach + line * 13, far: true };
                taken.push({ x: best.x, y: best.y, w: w, h: line });
                /* Der Strich nur dort, wo der Name nicht mehr offensichtlich
                   zu seinem Requisit gehört. */
                var leader = best.far
                    ? '<path class="sp-label-leader" d="M' + n(label.x) + ' ' + n(label.y) +
                      'L' + n(best.x) + ' ' + n(best.y) + '" stroke-width="' + n(u * 0.8) + '"/>'
                    : '';
                return leader + '<text class="sp-item-label" x="' + n(best.x) + '" y="' +
                    n(best.y + fs * 0.35) + '" font-size="' + n(fs) +
                    '" text-anchor="middle" paint-order="stroke">' + esc(label.text) + '</text>';
            });
            parts.push('<g class="sp-labels">' + drawn.join('') + '</g>');
        }

        /* ------------------------------------------------------ scale bar */
        if (wants(opts.scaleBar, stage.scaleBar)) {
            parts.push(scaleBar(view, b, u, fs));
        }

        var clip = '<clipPath id="' + (opts.idPrefix || 'sp') + '-clip"><path d="' + out.d + '"/></clipPath>';

        return {
            viewBox: n(view.x) + ' ' + n(view.y) + ' ' + n(view.w) + ' ' + n(view.h),
            inner: '<defs>' + clip + '</defs>' + parts.join(''),
            bounds: b,
            view: view,
            unit: u,
            fontSize: fs,
            outline: out
        };
    }

    function spanAtSafe(stage, y) {
        try { return SP.spanAt(stage, y); } catch (err) { return null; }
    }

    /* ------------------------------------------------------------------ *
     * Woran man auf der Bühne ziehen darf
     *
     *   free    beide Kanten frei          gerechnete Möbel, Markierungen
     *   derived die Tiefe folgt der Breite  Tür
     *   ratio   das Verhältnis bleibt      Zeichnungen
     *   square  immer quadratisch          Klebemarke
     *   width   nur in die Breite          Bank, Bett, Stift
     *   depth   nur in die Tiefe           Leiter
     *   none    gar nicht                  was es nur in einer Größe gibt
     *
     * Das gilt für die Griffe auf der Bühne und für sonst nichts. Im
     * Auswahl-Bereich steht jede Zahl weiter frei: eine Kaffeetasse ist keine
     * Kaffeetasse mehr, wenn sie 80 cm misst, aber wer eine Riesentasse auf
     * der Bühne hat, muss sie eintragen können. Verstecken tut der Planer
     * nichts — er macht nur das Übliche leicht und das Ungewöhnliche
     * ausdrücklich.
     * ------------------------------------------------------------------ */

    var GRIPS = ['free', 'derived', 'ratio', 'square', 'width', 'depth', 'none'];

    function gripOf(prop) {
        if (prop && GRIPS.indexOf(prop.grip) !== -1) return prop.grip;
        if (Shapes.naturalDepth(prop, 1, null) !== null) return 'derived';
        return Shapes.has(prop) ? 'free' : 'ratio';
    }

    /* Behält eine Zeichnung ihre Form, wenn eine Kante eingetragen wird? Jede
       tut das: gezogen würde aus dem Kreis eine Ellipse und aus der Kontur
       zwei verschiedene Strichstärken. Was gerechnet wird, hat die Form in
       der Vorschrift und darf beide Kanten getrennt annehmen. */
    function keepsAspect(prop) {
        return !Shapes.has(prop);
    }

    /* Bricht eine Bildunterschrift nach Wörtern um, damit sie in die Gasse passt. */
    function wrapWords(text, width) {
        var words = String(text).split(/\s+/).filter(Boolean);
        var lines = [];
        var line = '';
        words.forEach(function (word) {
            if (!line) line = word;
            else if ((line + ' ' + word).length <= width) line += ' ' + word;
            else { lines.push(line); line = word; }
        });
        if (line) lines.push(line);
        return lines;
    }

    /* Umbrechen nach der Breite, die zur Verfügung steht, nicht nach einer
       Zahl von Zeichen. Fünfzehn Zeichen sind in der Gasse mal zu wenig und
       mal zu viel: „bereitstellen," lief über die Gassenlinie auf die Bühne,
       während „im Off" die halbe Spalte frei ließ. Ein einzelnes Wort, das
       selbst zu breit ist, wird gekürzt statt hinausgeschoben. */
    function wrapToWidth(text, fs, max) {
        var words = String(text === undefined || text === null ? '' : text)
            .split(/\s+/).filter(Boolean);
        var lines = [];
        var line = '';
        words.forEach(function (word) {
            if (!line) line = word;
            else if (Shapes.textWidth(line + ' ' + word, fs) <= max) line += ' ' + word;
            else { lines.push(line); line = word; }
        });
        if (line) lines.push(line);
        return lines.map(function (one) { return Shapes.clipText(one, fs, max); });
    }

    function captionFor(placement, prop, index, mode) {
        var custom = SP.oneLine(placement.label);
        var name = t(prop.name);
        /* Markierungen tragen ihren Namen nicht unter sich her. Beim Textfeld
           steht der Text schon im Feld, bei Pfeil und Klebemarke sagt das Wort
           „Pfeil" auf dem Plan nichts, was das Zeichen nicht selbst sagt.
           Was jemand selbst hineingeschrieben hat, bleibt. */
        if (prop.mark === 'label') return '';
        if (prop.mark && !custom) return '';
        switch (mode) {
        case 'none': return '';
        case 'custom': return custom;
        case 'both': return custom ? name + ' — ' + custom : name;
        default: return custom || name;
        }
    }

    /* ------------------------------------------------------------------ *
     * Markierungen
     *
     * Bereich, Klebemarke, Pfeil und Textfeld sind keine Requisiten. Sie als
     * Zeichnung in ein 100er-Feld zu legen und auf die Fläche zu ziehen war
     * falsch: die Strichelung wuchs beim Aufziehen mit, der Pfeilkopf wurde
     * lang gezogen, und im Textfeld stand nie Text, sondern ein gedehntes
     * Kästchen. Sie werden deshalb direkt in Bühnenmetern gezeichnet. Alles,
     * was seine Größe behalten soll — Strichlänge, Pfeilkopf, Schrift —
     * rechnet in u, der Haarlinie, und nicht in w und h.
     * ------------------------------------------------------------------ */

    function drawShape(placement, prop, w, h, u, flags) {
        return Shapes.draw(prop, w, h, placement.params, u, {
            text: placement.label,
            flip: !!placement.flip,
            hint: flags.interactive ? t(prop.name) : ''
        });
    }

    /* Das Innere eines Requisits, ohne die Hülle. Es steht für sich, weil
       das schnelle Nachziehen beim Aufziehen einer Ecke dasselbe braucht wie
       der volle Aufbau — liefen die beiden auseinander, sähe das Requisit
       während des Ziehens anders aus als danach. */
    /* Eine Tasse ist zwölf Zentimeter breit. Auf einer Neun-Meter-Bühne, auf
       A4 gedruckt, sind das anderthalb Millimeter — ein Fleck, den niemand
       erkennt. Kleine Sachen werden deshalb wie ein Kartenzeichen gezeichnet:
       vergrößert, aber nur bis zum Mindestmaß, und nur nach oben. Die
       angeschriebene Zahl bleibt die wahre; vergrößert wird das Bild, nicht
       das Requisit. Was schon groß genug ist, rührt die Regel nicht an.

       Das Maß ist so gewählt, dass die Tasse auf einem quer gedruckten
       Szenenblatt bei einer Neun-Meter-Bühne rund sechs Millimeter breit
       wird. Bei zwölf lagen vier Sachen auf einem Cafétisch als Traube
       übereinander; bei drei ist die Tasse wieder ein Fleck. */
    var SYMBOL_MIN = 12;        // in Haarlinien, also etwa 2,4 % der Bühnenbreite

    function symbolScale(w, h, u) {
        var big = Math.max(w, h);
        var least = u * SYMBOL_MIN;
        return big >= least ? 1 : least / big;
    }

    function propInner(placement, prop, u, flags) {
        flags = flags || {};
        var w = Math.max(0.05, placement.w || prop.w);
        var h = Math.max(0.05, placement.h || prop.h);
        var k = symbolScale(w, h, u);
        /* Bei einem Bereich, einer Klebemarke, einem Pfeil oder einem Textfeld
           ist die Größe die Aussage — sie wird nicht aufgeblasen. */
        if (prop.mark) k = 1;
        var inner = k > 1
            ? '<g class="sp-symbol" transform="scale(' + n(k) + ')">' +
              drawShape(placement, prop, w, h, u / k, flags) + '</g>'
            : drawShape(placement, prop, w, h, u, flags);
        if (flags.interactive && !flags.ghost) {
            /* Ein Stück Kreide ist 11 × 1,8 cm groß. Als Klickfläche ist das
               ein Strich, den man nicht trifft. Sie bekommt deshalb ein
               Mindestmaß, das an der Haarlinie hängt und damit am Zoom: was
               klein aussieht, ist trotzdem anfassbar. */
            var hw = Math.max(w, u * 12) / 2;
            var hh = Math.max(h, u * 12) / 2;
            inner += '<rect class="sp-hit" x="' + n(-hw) + '" y="' + n(-hh) +
                '" width="' + n(hw * 2) + '" height="' + n(hh * 2) + '"/>';
        }
        return inner;
    }

    function drawProp(placement, prop, u, flags) {
        flags = flags || {};
        var classes = ['sp-item'];
        if (flags.ghost) classes.push('sp-item-ghost');
        if (flags.added) classes.push('is-added');
        if (flags.moved) classes.push('is-moved');
        if (flags.selected) classes.push('is-selected');
        if (placement.locked) classes.push('is-locked');

        var inner = propInner(placement, prop, u, flags);

        return '<g class="' + classes.join(' ') + '"' +
            (flags.ghost ? '' : ' data-id="' + esc(placement.id) + '"') +
            ' transform="translate(' + n(placement.x) + ' ' + n(placement.y) + ') rotate(' + n(placement.rot || 0) + ')">' +
            inner + '</g>';
    }

    function moveArrow(from, to, u) {
        var dx = to.x - from.x, dy = to.y - from.y;
        var len = Math.sqrt(dx * dx + dy * dy);
        if (len < u * 20) return '';
        var ux = dx / len, uy = dy / len;
        var head = Math.min(len * 0.3, u * 22);
        var tipX = to.x - ux * (Math.max(to.w, to.h) / 2);
        var tipY = to.y - uy * (Math.max(to.w, to.h) / 2);
        var tailX = from.x + ux * (Math.max(from.w, from.h) / 2);
        var tailY = from.y + uy * (Math.max(from.h, from.w) / 2);
        var leftX = tipX - ux * head + uy * head * 0.45;
        var leftY = tipY - uy * head - ux * head * 0.45;
        var rightX = tipX - ux * head - uy * head * 0.45;
        var rightY = tipY - uy * head + ux * head * 0.45;
        return '<path class="sp-move-arrow" d="M' + n(tailX) + ' ' + n(tailY) + ' L' + n(tipX) + ' ' + n(tipY) +
            ' M' + n(leftX) + ' ' + n(leftY) + ' L' + n(tipX) + ' ' + n(tipY) + ' L' + n(rightX) + ' ' + n(rightY) +
            '" stroke-width="' + n(u * 1.6) + '"/>';
    }

    function audienceMarks(out, b, u, fs) {
        var pieces = [];
        var gap = fs * 0.5;

        function chevronRow(x0, x1, y, flip) {
            var count = Math.max(3, Math.round((x1 - x0) / (fs * 1.4)));
            var step = (x1 - x0) / count;
            var d = '';
            for (var i = 0; i < count; i++) {
                var cx = x0 + step * (i + 0.5);
                var half = step * 0.32;
                var rise = fs * 0.3 * (flip ? -1 : 1);
                d += ' M' + n(cx - half) + ' ' + n(y) + ' L' + n(cx) + ' ' + n(y + rise) + ' L' + n(cx + half) + ' ' + n(y);
            }
            return d.trim();
        }

        if (out.audience.indexOf('front') !== -1) {
            var y = b.y + b.h + gap;
            pieces.push('<path d="' + chevronRow(b.x + b.w * 0.12, b.x + b.w * 0.88, y, false) +
                '" stroke-width="' + n(u * 1.2) + '"/>');
            pieces.push('<text x="' + n(b.x + b.w / 2) + '" y="' + n(y + fs * 1.25) +
                '" font-size="' + n(fs * 0.72) + '" text-anchor="middle">' + esc(t('Audience')) + '</text>');
        }
        if (out.audience.indexOf('ring') !== -1) {
            var yr = b.y + b.h + gap;
            pieces.push('<text x="' + n(b.x + b.w / 2) + '" y="' + n(yr + fs * 0.8) +
                '" font-size="' + n(fs * 0.72) + '" text-anchor="middle">' + esc(t('Audience on all sides')) + '</text>');
        }
        if (out.audience.indexOf('left') !== -1) {
            pieces.push('<text transform="translate(' + n(b.x - gap * 0.6) + ' ' + n(b.y + b.h / 2) + ') rotate(-90)" ' +
                'font-size="' + n(fs * 0.72) + '" text-anchor="middle">' + esc(t('Audience')) + '</text>');
        }
        if (out.audience.indexOf('right') !== -1) {
            pieces.push('<text transform="translate(' + n(b.x + b.w + gap * 0.6) + ' ' + n(b.y + b.h / 2) + ') rotate(90)" ' +
                'font-size="' + n(fs * 0.72) + '" text-anchor="middle">' + esc(t('Audience')) + '</text>');
        }
        return '<g class="sp-audience">' + pieces.join('') + '</g>';
    }

    function scaleBar(view, b, u, fs) {
        var lengthMetres = niceStep(b.w * 0.18);
        var segments = 4;
        var x0 = view.x + fs * 0.8;
        /* Platz für die Beschriftung unter dem Balken, nicht daneben. */
        var y0 = view.y + view.h - fs * 1.6;
        var seg = lengthMetres / segments;
        var pieces = [];
        for (var i = 0; i < segments; i++) {
            pieces.push('<rect class="' + (i % 2 ? 'sp-scale-dark' : 'sp-scale-light') + '" x="' + n(x0 + seg * i) +
                '" y="' + n(y0) + '" width="' + n(seg) + '" height="' + n(fs * 0.28) +
                '" stroke-width="' + n(u * 0.9) + '"/>');
        }
        /* Luft zwischen Balken und Zahl. Bei 0,9 saß die Zahl am Balken an
           und las sich wie ein Teil von ihm. */
        pieces.push('<text x="' + n(x0 + lengthMetres / 2) + '" y="' + n(y0 + fs * 1.2) +
            '" text-anchor="middle" font-size="' + n(fs * 0.68) + '">' +
            esc(SP.formatLength(lengthMetres)) + '</text>');
        return '<g class="sp-scale">' + pieces.join('') + '</g>';
    }

    /* Convenience: a complete <svg> element as a string. */
    function svg(opts) {
        var plan = build(opts);
        return '<svg class="sp-plan' + (opts.className ? ' ' + opts.className : '') +
            '" viewBox="' + plan.viewBox + '" preserveAspectRatio="xMidYMid meet" ' +
            'xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' +
            esc(opts.ariaLabel || t('Stage ground plan')) + '">' + plan.inner + '</svg>';
    }

    return { build: build, svg: svg, escape: esc, folds: folds, niceStep: niceStep,
             propInner: propInner, keepsAspect: keepsAspect, gripOf: gripOf, GRIPS: GRIPS };
}));
