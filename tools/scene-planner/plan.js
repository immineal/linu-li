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
        module.exports = factory(require('./core.js'));
    } else {
        root.SPPlan = factory(root.SP);
    }
}(typeof self !== 'undefined' ? self : this, function (SP) {
    'use strict';

    function esc(text) {
        return String(text === undefined || text === null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function n(value) {
        return Math.round(value * 1000) / 1000;
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
     *   stage, scene, resolve(propId) -> prop, units
     *   grid, gridLabels, centreLine, settingLine, curtains, audience,
     *   scaleBar, labels: 'none' | 'name' | 'custom' | 'both' | 'number'
     *   ghosts: placements from the previous scene, drawn faintly
     *   interactive: adds hit targets and data-id attributes
     *   emphasise: { added: [id], moved: [id] }
     */
    function build(opts) {
        var stage = opts.stage || SP.DEFAULT_STAGE;
        var scene = opts.scene || { placements: [] };
        var resolve = opts.resolve || function () { return null; };
        var units = opts.units || 'm';
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
        if (opts.grid !== false && stage.grid && stage.grid.show) {
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
        if (opts.centreLine !== false && stage.centreLine) {
            parts.push('<path class="sp-guide sp-centre" d="M0 ' + n(b.y) + ' V' + n(b.y + b.h) +
                '" stroke-width="' + n(u * 1.1) + '" stroke-dasharray="' + n(u * 9) + ' ' + n(u * 5) + ' ' + n(u * 2) + ' ' + n(u * 5) + '"/>');
        }
        if (opts.settingLine !== false && stage.settingLine) {
            var sl = spanAtSafe(stage, out.frontY);
            if (sl) {
                parts.push('<path class="sp-guide" d="M' + n(sl[0]) + ' ' + n(out.frontY) + ' H' + n(sl[1]) +
                    '" stroke-width="' + n(u * 1.1) + '" stroke-dasharray="' + n(u * 7) + ' ' + n(u * 4) + '"/>');
                parts.push('<text class="sp-guide-label" x="' + n(sl[1] - fs * 0.4) + '" y="' + n(out.frontY - fs * 0.55) +
                    '" font-size="' + n(fs * 0.62) + '" text-anchor="end">Setting line</text>');
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
                pieces.push('<text class="sp-curtain-label" x="' + n(span[0] + fs * 1.9) + '" y="' + n(y - fs * 0.5) +
                    '" font-size="' + n(fs * 0.62) + '">' + esc(curtain.name || 'Curtain') +
                    (state === 'closed' ? '' : ', ' + state) + '</text>');
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
            var caption = captionFor(p, prop, index, opts.labels);
            if (caption) {
                var reach = Math.max(p.w, p.h) / 2 + fs * 0.95;
                captions.push('<text class="sp-item-label" x="' + n(p.x) + '" y="' + n(p.y + reach) +
                    '" font-size="' + n(fs) + '" text-anchor="middle" paint-order="stroke">' +
                    esc(caption) + '</text>');
            }
        });
        parts.push('<g class="sp-items">' + body.join('') + '</g>');
        if (captions.length) parts.push('<g class="sp-labels">' + captions.join('') + '</g>');

        /* ------------------------------------------------------ scale bar */
        if (opts.scaleBar !== false && stage.scaleBar) {
            parts.push(scaleBar(view, b, u, fs, units));
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

    function captionFor(placement, prop, index, mode) {
        var custom = (placement.label || '').trim();
        switch (mode) {
        case 'none': return '';
        case 'number': return String(index + 1);
        case 'custom': return custom;
        case 'both': return custom ? prop.name + ' — ' + custom : prop.name;
        default: return custom || prop.name;
        }
    }

    function drawProp(placement, prop, u, flags) {
        flags = flags || {};
        var w = Math.max(0.05, placement.w || prop.w);
        var h = Math.max(0.05, placement.h || prop.h);
        var sx = (placement.flip ? -1 : 1) * w / 100;
        var sy = h / 100;
        var strokeWidth = u / ((w + h) / 200);

        var classes = ['sp-item'];
        if (flags.ghost) classes.push('sp-item-ghost');
        if (flags.added) classes.push('is-added');
        if (flags.moved) classes.push('is-moved');
        if (flags.selected) classes.push('is-selected');
        if (placement.locked) classes.push('is-locked');

        var art = prop.image
            ? '<image href="' + esc(prop.image) + '" x="0" y="0" width="100" height="100" preserveAspectRatio="none"/>'
            : prop.art;

        var inner = '<g class="sp-art" transform="scale(' + n(sx) + ' ' + n(sy) + ') translate(-50 -50)" ' +
            'stroke-width="' + n(strokeWidth) + '">' + art + '</g>';

        if (flags.interactive && !flags.ghost) {
            inner += '<rect class="sp-hit" x="' + n(-w / 2) + '" y="' + n(-h / 2) + '" width="' + n(w) +
                '" height="' + n(h) + '"/>';
        }

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
                '" font-size="' + n(fs * 0.72) + '" text-anchor="middle">Audience</text>');
        }
        if (out.audience.indexOf('ring') !== -1) {
            var yr = b.y + b.h + gap;
            pieces.push('<text x="' + n(b.x + b.w / 2) + '" y="' + n(yr + fs * 0.8) +
                '" font-size="' + n(fs * 0.72) + '" text-anchor="middle">Audience on all sides</text>');
        }
        if (out.audience.indexOf('left') !== -1) {
            pieces.push('<text transform="translate(' + n(b.x - gap * 0.6) + ' ' + n(b.y + b.h / 2) + ') rotate(-90)" ' +
                'font-size="' + n(fs * 0.72) + '" text-anchor="middle">Audience</text>');
        }
        if (out.audience.indexOf('right') !== -1) {
            pieces.push('<text transform="translate(' + n(b.x + b.w + gap * 0.6) + ' ' + n(b.y + b.h / 2) + ') rotate(90)" ' +
                'font-size="' + n(fs * 0.72) + '" text-anchor="middle">Audience</text>');
        }
        return '<g class="sp-audience">' + pieces.join('') + '</g>';
    }

    function scaleBar(view, b, u, fs, units) {
        var target = b.w * 0.18;
        var lengthMetres = units === 'ft'
            ? SP.toMetres(niceStep(SP.toUnit(target, 'ft')), 'ft')
            : niceStep(target);
        var segments = 4;
        var x0 = view.x + fs * 0.8;
        var y0 = view.y + view.h - fs * 0.9;
        var seg = lengthMetres / segments;
        var pieces = [];
        for (var i = 0; i < segments; i++) {
            pieces.push('<rect class="' + (i % 2 ? 'sp-scale-dark' : 'sp-scale-light') + '" x="' + n(x0 + seg * i) +
                '" y="' + n(y0) + '" width="' + n(seg) + '" height="' + n(fs * 0.28) +
                '" stroke-width="' + n(u * 0.9) + '"/>');
        }
        pieces.push('<text x="' + n(x0 + lengthMetres + fs * 0.35) + '" y="' + n(y0 + fs * 0.3) +
            '" font-size="' + n(fs * 0.68) + '">' + esc(SP.formatLength(lengthMetres, units)) + '</text>');
        return '<g class="sp-scale">' + pieces.join('') + '</g>';
    }

    /* Convenience: a complete <svg> element as a string. */
    function svg(opts) {
        var plan = build(opts);
        return '<svg class="sp-plan' + (opts.className ? ' ' + opts.className : '') +
            '" viewBox="' + plan.viewBox + '" preserveAspectRatio="xMidYMid meet" ' +
            'xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' +
            esc(opts.ariaLabel || 'Stage ground plan') + '">' + plan.inner + '</svg>';
    }

    return { build: build, svg: svg, escape: esc, folds: folds, niceStep: niceStep };
}));
