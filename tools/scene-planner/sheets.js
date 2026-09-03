/*
 * Scene & Prop Planner — the printed pages.
 *
 * Builds A4 sheets as plain HTML so the browser's own print dialogue can turn
 * them into paper or a PDF. Sizes are written in millimetres throughout, which
 * is the only reliable way to get a page that measures the same on screen and
 * in the tray.
 */
(function (root, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory(require('./core.js'), require('./plan.js'));
    } else {
        root.SPSheets = factory(root.SP, root.SPPlan);
    }
}(typeof self !== 'undefined' ? self : this, function (SP, SPPlan) {
    'use strict';

    var esc = SPPlan.escape;

    var DEFAULT_OPTIONS = {
        orientation: 'portrait',
        cover: true,
        actPages: true,
        scenePages: true,
        overview: true,
        runSheet: true,
        inventory: false,
        overviewCols: 3,
        overviewRows: 3,
        overviewSplitActs: true,
        labels: 'name',
        showGrid: true,
        showChanges: true,
        showPropList: true,
        showNotes: true,
        showGhosts: false,
        scope: 'all',
        footer: ''
    };

    function options(given) {
        var o = {};
        Object.keys(DEFAULT_OPTIONS).forEach(function (k) { o[k] = DEFAULT_OPTIONS[k]; });
        Object.keys(given || {}).forEach(function (k) {
            if (given[k] !== undefined) o[k] = given[k];
        });
        return o;
    }

    function stageFor(production, scene) {
        return (scene && scene.stage) || production.stage;
    }

    function planSvg(ctx, scene, opts) {
        var stage = stageFor(ctx.production, scene);
        var settings = {
            stage: stage,
            scene: scene,
            resolve: ctx.resolve,
            units: ctx.units,
            idPrefix: 'sheet-' + (planSvg.counter = (planSvg.counter || 0) + 1),
            labels: opts.labels,
            grid: opts.grid,
            scaleBar: opts.scaleBar,
            audience: opts.audience,
            ghosts: opts.ghosts,
            ghostArrows: opts.ghostArrows
        };
        return SPPlan.svg(settings);
    }

    /* Where a prop sits, said the way a crew would write it on a sheet. */
    function positionText(stage, placement, units) {
        var text = SP.describePosition(stage, placement.x, placement.y, units);
        if (stage.grid && stage.grid.show && stage.grid.labels) {
            text = SP.gridReference(stage, placement.x, placement.y, SP.num(stage.grid.spacing, 1)) + ' · ' + text;
        }
        return text;
    }

    function nameOf(ctx, propId) {
        var prop = ctx.resolve(propId);
        return prop ? prop.name : 'Unknown prop';
    }

    function describeGroup(group) {
        return (group.count > 1 ? group.count + ' × ' : '') + group.name +
            (group.label ? ' (' + group.label + ')' : '');
    }

    /* The three things a crew can be asked to do between two scenes. */
    function changeLines(ctx, diff, stage) {
        var resolveName = function (id) { return nameOf(ctx, id); };
        return {
            on: SP.groupByProp(diff.added, resolveName).map(describeGroup),
            off: SP.groupByProp(diff.removed, resolveName).map(describeGroup),
            move: diff.moved.map(function (m) {
                var label = nameOf(ctx, m.to.propId) + (m.to.label ? ' (' + m.to.label + ')' : '');
                if (m.distance <= 0.12 && m.turned > 4) {
                    return label + ' — turn to ' + Math.round(m.to.rot) + '°';
                }
                return label + ' — to ' + positionText(stage, m.to, ctx.units);
            })
        };
    }

    function listBlock(title, items, emptyText) {
        if (!items.length && !emptyText) return '';
        var body = items.length
            ? '<ul>' + items.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>'
            : '<ul><li class="sp-li-note">' + esc(emptyText) + '</li></ul>';
        return '<section><h3>' + esc(title) + '</h3>' + body + '</section>';
    }

    /* ------------------------------------------------------------- sheets */

    function sheet(ctx, className, body) {
        return '<article class="sp-sheet' + (ctx.options.orientation === 'landscape' ? ' is-landscape' : '') +
            (className ? ' ' + className : '') + '">' + body + '</article>';
    }

    function foot(ctx, left) {
        return '<div class="sp-sheet-foot"><span>' + esc(left || ctx.production.name) + '</span>' +
            (ctx.options.footer ? '<span>' + esc(ctx.options.footer) + '</span>' : '<span></span>') +
            '<span>Page %%PAGE%% of %%PAGES%%</span></div>';
    }

    function coverSheet(ctx) {
        var p = ctx.production;
        var scenes = p.scenes || [];
        var stage = p.stage;
        var out = SP.stageOutline(stage);
        var shape = SP.shapeById(stage.shape);
        var propCount = SP.propInventory(p).length;
        var rows = [
            ['Scenes', String(scenes.length)],
            ['Acts', String((p.acts || []).length || '—')],
            ['Stage', shape.name + ', ' + SP.formatLength(out.bounds.w, ctx.units) + ' by ' +
                SP.formatLength(out.bounds.h, ctx.units)],
            ['Distinct props', String(propCount)],
            ['Curtains', (stage.curtains || []).length
                ? stage.curtains.map(function (c) { return c.name; }).join(', ') : 'None marked'],
            ['Drawn', ctx.today]
        ];
        if (p.venue) rows.splice(2, 0, ['Venue', p.venue]);

        return sheet(ctx, 'sp-cover',
            '<div style="flex:1 1 auto; display:flex; flex-direction:column; justify-content:center">' +
            '<p class="sp-act-kicker">Prop and scene plan</p>' +
            '<h2>' + esc(p.name || 'Untitled production') + '</h2>' +
            (p.subtitle ? '<p class="sp-cover-sub">' + esc(p.subtitle) + '</p>' : '') +
            '<dl>' + rows.map(function (r) {
                return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>';
            }).join('') + '</dl>' +
            (p.notes ? '<p style="font-size:3.4mm; max-width:120mm; line-height:1.6">' + esc(p.notes) + '</p>' : '') +
            '</div>' + foot(ctx));
    }

    function actSheet(ctx, group, numbers) {
        var act = group.act;
        var index = (ctx.production.acts || []).indexOf(act) + 1;
        var items = group.scenes.map(function (s) {
            return '<li class="is-keyed"><span class="sp-li-key">' + esc(numbers[s.id].label) + '</span>' +
                esc(s.title || 'Untitled scene') + '</li>';
        }).join('');

        var props = {};
        group.scenes.forEach(function (s) {
            (s.placements || []).forEach(function (pl) { props[pl.propId] = true; });
        });
        var propNames = Object.keys(props).map(function (id) { return nameOf(ctx, id); }).sort();

        return sheet(ctx, 'sp-act-sheet',
            '<p class="sp-act-kicker">Act ' + esc(SP.roman(index || 1)) + '</p>' +
            '<h2>' + esc(act.name || ('Act ' + SP.roman(index || 1))) + '</h2>' +
            (act.notes ? '<p style="font-size:3.6mm; max-width:130mm; margin-bottom:8mm; line-height:1.6">' +
                esc(act.notes) + '</p>' : '') +
            '<section><h3>Scenes in this act</h3><ul class="sp-act-scenes">' + items + '</ul></section>' +
            (propNames.length ? '<section style="margin-top:8mm"><h3>Props needed during the act</h3>' +
                '<p style="font-size:3.2mm; line-height:1.7; color:#554d44">' + esc(propNames.join(' · ')) + '</p></section>' : '') +
            foot(ctx));
    }

    function sceneSheet(ctx, scene, previous, numbers) {
        var o = ctx.options;
        var stage = stageFor(ctx.production, scene);
        var number = numbers[scene.id];
        var act = (ctx.production.acts || []).filter(function (a) { return a.id === scene.actId; })[0];
        var diff = SP.diffScenes(previous, scene);
        var lines = changeLines(ctx, diff, stage);

        var emphasise = {
            added: diff.added.map(function (p) { return p.id; }),
            moved: diff.moved.map(function (m) { return m.to.id; })
        };

        var planOptions = {
            labels: o.labels,
            grid: o.showGrid,
            scaleBar: true,
            audience: true,
            ghosts: o.showGhosts && previous ? previous.placements : null,
            ghostArrows: o.showGhosts ? diff.moved : null
        };
        var stageSettings = {
            stage: stage, scene: scene, resolve: ctx.resolve, units: ctx.units,
            idPrefix: 'sheet-' + (planSvg.counter = (planSvg.counter || 0) + 1),
            labels: planOptions.labels, grid: planOptions.grid, scaleBar: true,
            audience: true, ghosts: planOptions.ghosts, ghostArrows: planOptions.ghostArrows,
            emphasise: o.showChanges ? emphasise : null
        };
        var svg = SPPlan.svg(stageSettings);

        var propItems = (scene.placements || []).map(function (p, i) {
            var name = nameOf(ctx, p.propId);
            return '<li class="is-keyed"><span class="sp-li-key">' + (i + 1) + '</span>' + esc(name) +
                (p.label ? ' <span class="sp-li-note">' + esc(p.label) + '</span>' : '') +
                '<span class="sp-li-pos">' + esc(positionText(stage, p, ctx.units)) +
                (p.rot ? ', turned ' + Math.round(p.rot) + '°' : '') + '</span></li>';
        }).join('');

        var changeSections = '';
        if (o.showChanges) {
            if (!previous) {
                changeSections = '<section><h3>Preset before the house opens</h3>' +
                    '<ul><li class="sp-li-note">Everything on this sheet is set before the show starts.</li></ul></section>';
            } else {
                changeSections =
                    listBlock('Bring on', lines.on, 'Nothing new') +
                    listBlock('Strike', lines.off, 'Nothing struck') +
                    listBlock('Move', lines.move, 'Nothing moved');
            }
        }

        var head =
            '<div class="sp-sheet-head">' +
            '<div class="sp-sheet-number">' + esc(number.label) + '</div>' +
            '<div class="sp-sheet-titles"><h2>' + esc(scene.title || 'Untitled scene') + '</h2>' +
            '<p>' + esc([act ? act.name : '', scene.subtitle || ''].filter(Boolean).join(' · ') || ' ') + '</p></div>' +
            '<div class="sp-sheet-meta">' + esc(ctx.production.name || '') + '<br>' +
            esc(SP.shapeById(stage.shape).name) + ' stage<br>' +
            (scene.placements || []).length + ' props' +
            '</div></div>';

        var longList = (scene.placements || []).length > 6;
        var lists =
            (o.showPropList ? '<section' + (longList ? ' class="is-long"' : '') +
                '><h3>On stage</h3><ol>' + (propItems || '<li class="sp-li-note">Bare stage</li>') +
                '</ol></section>' : '') +
            changeSections +
            (o.showNotes && scene.notes ? '<section><h3>Notes</h3><ul><li>' + esc(scene.notes) + '</li></ul></section>' : '');

        var body;
        if (o.orientation === 'landscape') {
            body = head +
                '<div class="sp-sheet-body"><div class="sp-sheet-plan">' + svg + '</div>' +
                '<div class="sp-sheet-side">' + lists + '</div></div>';
        } else {
            body = head +
                '<div class="sp-sheet-plan">' + svg + '</div>' +
                '<div class="sp-sheet-cols">' + lists + '</div>';
        }
        return sheet(ctx, '', body + foot(ctx));
    }

    function overviewSheets(ctx, scenes, numbers) {
        var o = ctx.options;
        var cols = Math.max(1, Math.round(o.overviewCols));
        var rows = Math.max(1, Math.round(o.overviewRows));
        var labels = cols <= 2 ? 'name' : 'none';
        var pages = SP.overviewPages({ scenes: scenes, acts: ctx.production.acts },
            cols, rows, o.overviewSplitActs);

        return pages.map(function (page, pageIndex) {
            var cells = page.map(function (scene) {
                var stage = stageFor(ctx.production, scene);
                var svg = SPPlan.svg({
                    stage: stage, scene: scene, resolve: ctx.resolve, units: ctx.units,
                    idPrefix: 'ov-' + (planSvg.counter = (planSvg.counter || 0) + 1),
                    labels: labels, grid: cols <= 3 && o.showGrid, scaleBar: false,
                    audience: cols <= 3, settingLine: cols <= 3
                });
                return '<div class="sp-overview-cell"><div class="sp-overview-cell-head">' +
                    '<b>' + esc(numbers[scene.id].label) + '</b>' +
                    '<span>' + esc(scene.title || 'Untitled scene') + '</span></div>' +
                    '<div class="sp-overview-plan">' + svg + '</div></div>';
            }).join('');

            var heading = page.act ? page.act.name : 'Overview';
            return sheet(ctx, '',
                '<div class="sp-sheet-head"><div class="sp-sheet-titles">' +
                '<h2>' + esc(heading) + '</h2>' +
                '<p>' + cols + ' by ' + rows + ' overview, sheet ' + (pageIndex + 1) + ' of ' + pages.length + '</p>' +
                '</div><div class="sp-sheet-meta">' + esc(ctx.production.name || '') + '</div></div>' +
                '<div class="sp-overview-grid" style="grid-template-columns: repeat(' + cols +
                ', 1fr); grid-template-rows: repeat(' + rows + ', 1fr)">' + cells + '</div>' +
                foot(ctx));
        });
    }

    function runSheets(ctx, scenes, numbers) {
        var perPage = ctx.options.orientation === 'landscape' ? 7 : 11;
        var rows = [];
        for (var i = 1; i < scenes.length; i++) {
            var stage = stageFor(ctx.production, scenes[i]);
            var diff = SP.diffScenes(scenes[i - 1], scenes[i]);
            var lines = changeLines(ctx, diff, stage);
            rows.push({
                from: numbers[scenes[i - 1].id].label,
                to: numbers[scenes[i].id].label,
                title: scenes[i].title || 'Untitled scene',
                on: lines.on, off: lines.off, move: lines.move,
                count: SP.changeCount(diff)
            });
        }
        if (!rows.length) return [];

        return SP.chunk(rows, perPage).map(function (page, index, all) {
            var body = page.map(function (r) {
                return '<tr>' +
                    '<td class="sp-num">' + esc(r.from) + ' &rarr; ' + esc(r.to) + '</td>' +
                    '<td>' + esc(r.title) + '</td>' +
                    '<td>' + (r.on.length ? esc(r.on.join('; ')) : '—') + '</td>' +
                    '<td>' + (r.off.length ? esc(r.off.join('; ')) : '—') + '</td>' +
                    '<td>' + (r.move.length ? esc(r.move.join('; ')) : '—') + '</td>' +
                    '</tr>';
            }).join('');
            return sheet(ctx, '',
                '<div class="sp-sheet-head"><div class="sp-sheet-titles">' +
                '<h2>Change-over list</h2><p>What happens between scenes' +
                (all.length > 1 ? ', part ' + (index + 1) + ' of ' + all.length : '') + '</p></div>' +
                '<div class="sp-sheet-meta">' + esc(ctx.production.name || '') + '</div></div>' +
                '<div style="flex:1 1 auto; padding-top:4mm"><table><thead><tr>' +
                '<th style="width:20mm">Change</th><th style="width:32mm">Into</th>' +
                '<th>Bring on</th><th>Strike</th><th>Move</th></tr></thead><tbody>' +
                body + '</tbody></table></div>' + foot(ctx));
        });
    }

    function inventorySheets(ctx, scenes, numbers) {
        var perPage = ctx.options.orientation === 'landscape' ? 16 : 24;
        var inventory = SP.propInventory({ scenes: scenes });
        if (!inventory.length) return [];

        return SP.chunk(inventory, perPage).map(function (page, index, all) {
            var body = page.map(function (entry) {
                var prop = ctx.resolve(entry.propId);
                var art = prop && !prop.image
                    ? '<svg viewBox="0 0 100 100" width="7mm" height="7mm" class="sp-plan"><g class="sp-art" stroke-width="4">' + prop.art + '</g></svg>'
                    : (prop && prop.image ? '<img src="' + esc(prop.image) + '" width="26" height="26" alt="">' : '');
                var where = entry.scenes.map(function (s) {
                    return numbers[s.sceneId].label + (s.count > 1 ? '×' + s.count : '');
                }).join(', ');
                return '<tr><td style="width:9mm">' + art + '</td>' +
                    '<td>' + esc(prop ? prop.name : entry.propId) + '</td>' +
                    '<td class="sp-num">' + entry.peak + '</td>' +
                    '<td class="sp-num">' + entry.scenes.length + '</td>' +
                    '<td>' + esc(where) + '</td></tr>';
            }).join('');
            return sheet(ctx, '',
                '<div class="sp-sheet-head"><div class="sp-sheet-titles">' +
                '<h2>Prop inventory</h2><p>Every prop used, and the most needed at any one time' +
                (all.length > 1 ? ', part ' + (index + 1) + ' of ' + all.length : '') + '</p></div>' +
                '<div class="sp-sheet-meta">' + esc(ctx.production.name || '') + '</div></div>' +
                '<div style="flex:1 1 auto; padding-top:4mm"><table><thead><tr>' +
                '<th></th><th>Prop</th><th>Most at once</th><th>Scenes</th><th>Appears in</th>' +
                '</tr></thead><tbody>' + body + '</tbody></table></div>' + foot(ctx));
        });
    }

    /* ------------------------------------------------------------- build */

    function build(input) {
        var ctx = {
            production: input.production,
            resolve: input.resolve,
            units: input.units || input.production.units || 'm',
            options: options(input.options),
            today: input.today || new Date().toLocaleDateString(undefined, {
                year: 'numeric', month: 'long', day: 'numeric'
            })
        };
        var o = ctx.options;
        var numbers = SP.sceneNumbers(ctx.production);
        var all = ctx.production.scenes || [];
        var scenes = o.scope && o.scope !== 'all'
            ? all.filter(function (s) { return s.actId === o.scope; })
            : all;

        var sheets = [];
        if (o.cover) sheets.push(coverSheet(ctx));

        if (o.scenePages || o.actPages) {
            SP.groupScenesByAct({ acts: ctx.production.acts, scenes: scenes }).forEach(function (group) {
                if (o.actPages && group.act) sheets.push(actSheet(ctx, group, numbers));
                if (!o.scenePages) return;
                group.scenes.forEach(function (scene) {
                    var index = all.indexOf(scene);
                    var previous = index > 0 ? all[index - 1] : null;
                    sheets.push(sceneSheet(ctx, scene, previous, numbers));
                });
            });
        }

        if (o.overview) sheets = sheets.concat(overviewSheets(ctx, scenes, numbers));
        if (o.runSheet) sheets = sheets.concat(runSheets(ctx, scenes, numbers));
        if (o.inventory) sheets = sheets.concat(inventorySheets(ctx, scenes, numbers));

        var total = sheets.length;
        return sheets.map(function (html, i) {
            return html.replace(/%%PAGE%%/g, String(i + 1)).replace(/%%PAGES%%/g, String(total));
        });
    }

    return {
        build: build,
        DEFAULT_OPTIONS: DEFAULT_OPTIONS,
        options: options,
        changeLines: changeLines,
        positionText: positionText
    };
}));
