/*
 * Szenen- und Requisitenplaner — die gedruckten Seiten.
 *
 * Zwei Dokumente, die getrennt gedruckt werden:
 *
 *   Die Pläne    — eine Szene pro Blatt, groß gezeichnet. Nummer und Titel,
 *                  sonst nichts zu lesen. Was zu tun ist, steht woanders.
 *   Der Umbauplan— eine Tabelle über den ganzen Abend: Abbau, Aufbau und
 *                  Umstellen zwischen je zwei Szenen, dazu ein Referenzkasten
 *                  mit den Orten. Satzbild nach der LaTeX-Vorlage: A4, 10 pt,
 *                  serifenlos, Ränder 1,4 cm oben und unten, 1,8 cm seitlich.
 *
 * Alle Maße in Millimetern — nur so misst eine Seite am Bildschirm dasselbe
 * wie im Papierfach. Die Tabelle wird hier selbst umbrochen, statt sie dem
 * Browser zu überlassen: dadurch steht die Kopfzeile auf jedem Blatt, und ein
 * Balken wie „PAUSE“ landet nie allein am Seitenende.
 */
(function (root, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory(require('./core.js'), require('./plan.js'), require('./i18n.js'));
    } else {
        root.SPSheets = factory(root.SP, root.SPPlan, root.SPI18n);
    }
}(typeof self !== 'undefined' ? self : this, function (SP, SPPlan, I18n) {
    'use strict';

    var esc = SPPlan.escape;
    var t = I18n ? I18n.t : function (key) { return key; };

    /* ------------------------------------------------------------ Optionen */

    /* Wer eine Produktion mit fünf Szenen anlegt und auf Drucken geht, bekam
       zehn Blätter: Titelblatt, Trennblätter, fünf Szenenblätter,
       Übersichtsblätter. Wer eine Szene nachdrucken wollte, druckte zehn.
       Voreingestellt sind jetzt die Szenenblätter, sonst nichts — alles
       andere hakt man an.

       Und auf dem Szenenblatt steht, was die Sache ausmacht: Nummer, Titel,
       Ort, Bühne mit Gassen und Vorhängen, Publikum, Maßstab. Kein
       Bodenraster (es macht das Blatt unruhig) und keine Fußzeile (sie ist
       leer, bis jemand sie füllt). */
    var DEFAULT_OPTIONS = {
        /* Die Pläne. Der Umbauplan steht immer hoch, das regelt buildChangeover. */
        orientation: 'landscape',
        cover: false,
        actPages: false,
        scenePages: true,
        overview: false,
        inventory: false,
        /* Ein Überblick, der auf zwei Blättern steht, ist keiner. Ab Werk
           rechnet der Planer das Raster so, dass alle Szenen auf ein Blatt
           passen; wer ein bestimmtes Raster will, stellt es ein. */
        overviewAuto: true,
        overviewCols: 3,
        overviewRows: 3,
        /* Ein Überblick auf mehreren Blättern ist keiner. */
        overviewSplitActs: false,
        labels: 'custom',
        showGrid: false,
        showNotes: false,
        showPlace: true,
        showTitle: true,
        showFooter: false,
        showScaleBar: true,
        showAudience: true,
        showGuides: true,
        showWings: true,
        showCurtains: true,
        numberOutside: false,

        /* Der Umbauplan */
        referenceBox: true,
        positions: false,
        changeoverTitle: '',

        /* Beides */
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

    function context(input) {
        return {
            production: input.production,
            resolve: input.resolve,
            options: options(input.options),
            today: input.today || new Date().toLocaleDateString(
                I18n && I18n.language() === 'en' ? 'en-GB' : 'de-DE',
                { year: 'numeric', month: 'long', day: 'numeric' })
        };
    }

    function stageFor(production, scene) {
        return (scene && scene.stage) || production.stage;
    }

    function nameOf(ctx, propId) {
        var prop = ctx.resolve(propId);
        return prop ? t(prop.name) : t('Unknown prop');
    }

    function scopedScenes(ctx) {
        var all = ctx.production.scenes || [];
        var scope = ctx.options.scope;
        if (!scope || scope === 'all') return all;
        return all.filter(function (s) { return s.actId === scope; });
    }

    /* ============================================================ *
     * Dokument 1 — Die Pläne
     * ============================================================ */

    /* `kind` sagt, welches Kästchen dieses Blatt gemacht hat. Die Vorschau
       hängt daran ihr × — damit man ein Blatt dort wegnimmt, wo man es sieht,
       statt es in einer Liste von Kästchen zu suchen. */
    function sheet(ctx, className, body, kind) {
        return '<article class="sp-sheet' +
            (ctx.options.orientation === 'landscape' ? ' is-landscape' : '') +
            (className ? ' ' + className : '') + '"' +
            (kind ? ' data-kind="' + kind + '"' : '') + '>' + body + '</article>';
    }

    function foot(ctx, left) {
        return '<div class="sp-sheet-foot"><span>' + esc(left || ctx.production.name) + '</span>' +
            (ctx.options.footer ? '<span>' + esc(ctx.options.footer) + '</span>' : '<span></span>') +
            '<span>' + esc(t('Page {n} of {total}', { n: '%%PAGE%%', total: '%%PAGES%%' })) + '</span></div>';
    }

    /*
     * Das Titelblatt zählt, was auch gedruckt wird. Vorher stand bei einem
     * einzeln gedruckten Akt die Zahl der Szenen der ganzen Produktion auf dem
     * Blatt — der Satz Papier darunter hatte eine andere.
     */
    function coverSheet(ctx, scenes) {
        var p = ctx.production;
        var stage = p.stage;
        var out = SP.stageOutline(stage);
        var shape = SP.shapeById(stage.shape);
        var onlyAct = null;
        if (ctx.options.scope && ctx.options.scope !== 'all') {
            (p.acts || []).forEach(function (a) {
                if (a.id === ctx.options.scope) onlyAct = a;
            });
        }
        var acts = {};
        scenes.forEach(function (s) { if (s.actId) acts[s.actId] = true; });
        var places = SP.referenceRows({ scenes: scenes, places: p.places },
            function (id) { return nameOf(ctx, id); });
        var rows = [
            [t('Scenes'), String(scenes.length)],
            [t('Act'), String(Object.keys(acts).length || '—')],
            [t('Stage'), t(shape.name) + ', ' + SP.formatLength(out.bounds.w) +
                ' × ' + SP.formatLength(out.bounds.h)],
            [t('Distinct props'), String(SP.propInventory({ scenes: scenes }).length)],
            [t('Drawn'), ctx.today]
        ];
        if (onlyAct) {
            rows.splice(1, 1, [t('Act'), onlyAct.name ||
                t('Act {n}', { n: SP.roman((p.acts || []).indexOf(onlyAct) + 1) })]);
        }
        if (places.length) rows.splice(3, 0, [t('Places'), String(places.length)]);
        if (p.venue) rows.splice(2, 0, [t('Venue'), p.venue]);

        return sheet(ctx, 'sp-cover',
            '<div style="flex:1 1 auto; display:flex; flex-direction:column; justify-content:center">' +
            '<p class="sp-act-kicker">' + esc(t('Prop and scene plan')) + '</p>' +
            '<h2>' + esc(p.name || t('Untitled production')) + '</h2>' +
            (p.subtitle ? '<p class="sp-cover-sub">' + esc(p.subtitle) + '</p>' : '') +
            '<dl>' + rows.map(function (r) {
                return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>';
            }).join('') + '</dl>' +
            (p.notes ? '<p style="font-size:3.4mm; max-width:120mm; line-height:1.6">' +
                esc(p.notes) + '</p>' : '') +
            '</div>' + foot(ctx), 'cover');
    }

    /* Der Name eines Akts, und wenn keiner dasteht, seine Nummer. Ohne das
       stand über der Übersicht eine leere Zeile. */
    function actTitle(ctx, act) {
        var index = (ctx.production.acts || []).indexOf(act) + 1;
        return act.name || t('Act {n}', { n: SP.roman(index || 1) });
    }

    function actSheet(ctx, group, numbers) {
        var act = group.act;
        var index = (ctx.production.acts || []).indexOf(act) + 1;
        var items = group.scenes.map(function (s) {
            return '<li class="is-keyed"><span class="sp-li-key">' + esc(numbers[s.id].label) + '</span>' +
                esc(s.title || t('Untitled scene')) + '</li>';
        }).join('');

        return sheet(ctx, 'sp-act-sheet',
            /* Bei einem Akt ohne Namen stand „Akt I" zweimal untereinander. */
            (act.name ? '<p class="sp-act-kicker">' +
                esc(t('Act {n}', { n: SP.roman(index || 1) })) + '</p>' : '') +
            '<h2>' + esc(actTitle(ctx, act)) + '</h2>' +
            (act.notes ? '<p style="font-size:3.6mm; max-width:130mm; margin-bottom:8mm; line-height:1.6">' +
                esc(act.notes) + '</p>' : '') +
            '<section><h3>' + esc(t('Scenes in this act')) + '</h3>' +
            '<ul class="sp-act-scenes">' + items + '</ul></section>' +
            foot(ctx), 'actPages');
    }

    /*
     * Ein Szenenblatt ist bewusst fast leer: die Zeichnung, so groß wie sie
     * auf das Blatt passt, darüber Nummer und Titel. Alles, was man lesen
     * statt sehen muss, steht im Umbauplan.
     */
    function sceneSheet(ctx, scene, numbers) {
        var o = ctx.options;
        var stage = stageFor(ctx.production, scene);
        var place = SP.placeForScene(ctx.production, scene);
        var subtitle = [
            o.showPlace && place ? place.name : '',
            scene.subtitle || ''
        ].filter(Boolean).join(' · ');

        var svg = SPPlan.svg({
            stage: stage,
            scene: scene,
            resolve: ctx.resolve,
            idPrefix: 'sheet-' + (sceneSheet.counter = (sceneSheet.counter || 0) + 1),
            labels: o.labels,
            grid: o.showGrid,
            scaleBar: o.showScaleBar,
            audience: o.showAudience,
            settingLine: o.showGuides,
            centreLine: o.showGuides,
            wings: o.showWings,
            curtains: o.showCurtains,
            wingNotes: scene.wingNotes || null
        });

        var number = '<span class="sp-plan-sheet-number">' + esc(numbers[scene.id].label) + '</span>';

        /* Die Nummer groß neben der Bühne, sonst nichts auf dem Blatt — so
           liegen die Blätter, die diese Mannschaft schon benutzt. */
        if (o.numberOutside) {
            return sheet(ctx, 'sp-plan-sheet is-bare',
                '<div class="sp-plan-sheet-bare">' + number +
                '<div class="sp-plan-sheet-plan">' + svg + '</div></div>' +
                (o.showNotes && scene.notes
                    ? '<p class="sp-plan-sheet-note">' + esc(scene.notes) + '</p>' : '') +
                (o.showFooter ? foot(ctx) : ''), 'scenePages');
        }

        return sheet(ctx, 'sp-plan-sheet',
            '<div class="sp-plan-sheet-head">' + number +
            (o.showTitle
                ? '<span class="sp-plan-sheet-title">' + esc(scene.title || t('Untitled scene')) + '</span>' +
                  (subtitle ? '<span class="sp-plan-sheet-sub">' + esc(subtitle) + '</span>' : '')
                : '') +
            '</div>' +
            '<div class="sp-plan-sheet-plan">' + svg + '</div>' +
            (o.showNotes && scene.notes
                ? '<p class="sp-plan-sheet-note">' + esc(scene.notes) + '</p>' : '') +
            (o.showFooter ? foot(ctx) : ''), 'scenePages');
    }

    /* Das Raster, in das alle Szenen auf ein Blatt gehen. Gesucht ist nicht
       das Raster mit den wenigsten leeren Zellen, sondern das, in dem der
       Grundriss am größten herauskommt: eine fast quadratische Zelle nützt
       einem querformatigen Plan nichts, sie lässt ihn nur schwimmen. Also
       jedes Raster durchrechnen und das nehmen, bei dem der Plan den meisten
       Platz bekommt — bei Gleichstand das mit den wenigeren Spalten, weil die
       Zeilen dann höher sind und die Nummer darüber Luft hat. */
    function fittingGrid(count) {
        var n = Math.max(1, count);
        var sheet = 1.68;   /* Breite zu Höhe der Rasterfläche, A4 quer */
        var plan = 1.33;    /* Breite zu Tiefe einer üblichen Bühne */
        var best = null;
        for (var cols = 1; cols <= n; cols++) {
            var rows = Math.ceil(n / cols);
            var scale = Math.min((sheet / cols) / plan, 1 / rows);
            if (!best || scale > best.scale + 1e-9) best = { cols: cols, rows: rows, scale: scale };
        }
        return { cols: best.cols, rows: best.rows };
    }

    function overviewSheets(ctx, scenes, numbers) {
        var o = ctx.options;
        var fit = o.overviewAuto && !o.overviewSplitActs
            ? fittingGrid(scenes.length)
            : { cols: Math.max(1, Math.round(o.overviewCols)), rows: Math.max(1, Math.round(o.overviewRows)) };
        var cols = fit.cols;
        var rows = fit.rows;
        var labels = cols <= 2 ? 'name' : 'none';
        var pages = SP.overviewPages({ scenes: scenes, acts: ctx.production.acts },
            cols, rows, o.overviewSplitActs);

        return pages.map(function (page, pageIndex) {
            var cells = page.map(function (scene) {
                var svg = SPPlan.svg({
                    stage: stageFor(ctx.production, scene), scene: scene,
                    resolve: ctx.resolve,
                    idPrefix: 'ov-' + (sceneSheet.counter = (sceneSheet.counter || 0) + 1),
                    labels: labels, grid: cols <= 3 && o.showGrid, scaleBar: false,
                    audience: cols <= 3, settingLine: cols <= 3
                });
                /* Nur die Nummer. Bei fünfundzwanzig Bühnenbildern auf einem
                   Blatt ist der Titel nicht mehr zu lesen und nimmt dem Bild
                   den Platz, den es braucht. */
                return '<div class="sp-overview-cell"><div class="sp-overview-cell-head">' +
                    '<b>' + esc(numbers[scene.id].label) + '</b></div>' +
                    '<div class="sp-overview-plan">' + svg + '</div></div>';
            }).join('');

            return sheet(ctx, '',
                '<div class="sp-sheet-head"><div class="sp-sheet-titles">' +
                '<h2>' + esc(page.act ? actTitle(ctx, page.act) : t('Overview')) + '</h2>' +
                '<p>' + esc(pages.length > 1
                    ? t('{cols} by {rows} overview, sheet {n} of {total}',
                        { cols: cols, rows: rows, n: pageIndex + 1, total: pages.length })
                    : I18n.plural(scenes.length, 'All 1 scene at a glance', 'All {n} scenes at a glance')) + '</p>' +
                '</div><div class="sp-sheet-meta">' + esc(ctx.production.name || '') + '</div></div>' +
                '<div class="sp-overview-grid" style="grid-template-columns: repeat(' + cols +
                ', 1fr); grid-template-rows: repeat(' + rows + ', 1fr)">' + cells + '</div>' +
                foot(ctx), 'overview');
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
                    ? '<svg viewBox="0 0 100 100" width="7mm" height="7mm" class="sp-plan">' +
                      '<g class="sp-art" stroke-width="' + (4 * (prop.sw || 1)) + '">' + prop.art + '</g></svg>'
                    : (prop && prop.image ? '<img src="' + esc(prop.image) + '" width="26" height="26" alt="">' : '');
                var where = entry.scenes.map(function (s) {
                    return numbers[s.sceneId].label + (s.count > 1 ? '×' + s.count : '');
                }).join(', ');
                return '<tr><td style="width:9mm">' + art + '</td>' +
                    '<td>' + esc(prop ? t(prop.name) : entry.propId) + '</td>' +
                    '<td class="sp-num">' + entry.peak + '</td>' +
                    '<td class="sp-num">' + entry.scenes.length + '</td>' +
                    '<td>' + esc(where) + '</td></tr>';
            }).join('');

            return sheet(ctx, '',
                '<div class="sp-sheet-head"><div class="sp-sheet-titles">' +
                '<h2>' + esc(t('Prop inventory')) + '</h2><p>' +
                esc(t('Every prop used, and the most needed at any one time') +
                    (all.length > 1 ? ', ' + t('part {n} of {total}',
                        { n: index + 1, total: all.length }) : '')) + '</p></div>' +
                '<div class="sp-sheet-meta">' + esc(ctx.production.name || '') + '</div></div>' +
                '<div style="flex:1 1 auto; padding-top:4mm"><table><thead><tr>' +
                '<th></th><th>' + esc(t('Props')) + '</th><th>' + esc(t('Most at once')) + '</th>' +
                '<th>' + esc(t('Scenes')) + '</th><th>' + esc(t('Appears in')) + '</th>' +
                '</tr></thead><tbody>' + body + '</tbody></table></div>' + foot(ctx), 'inventory');
        });
    }

    /* Baut das Plan-Dokument: Titel, Trennblätter, Szenen, Übersicht, Liste. */
    function buildPlans(input) {
        var ctx = context(input);
        var o = ctx.options;
        var numbers = SP.sceneNumbers(ctx.production);
        var scenes = scopedScenes(ctx);
        var sheets = [];

        if (o.cover) sheets.push(coverSheet(ctx, scenes));

        if (o.scenePages || o.actPages) {
            SP.groupScenesByAct({ acts: ctx.production.acts, scenes: scenes })
                .forEach(function (group) {
                    if (o.actPages && group.act) sheets.push(actSheet(ctx, group, numbers));
                    if (!o.scenePages) return;
                    group.scenes.forEach(function (scene) {
                        sheets.push(sceneSheet(ctx, scene, numbers));
                    });
                });
        }

        if (o.overview) sheets = sheets.concat(overviewSheets(ctx, scenes, numbers));
        if (o.inventory) sheets = sheets.concat(inventorySheets(ctx, scenes, numbers));

        return paginate(sheets);
    }

    /* ============================================================ *
     * Dokument 2 — Der Umbauplan
     *
     * Satzbild der LaTeX-Vorlage, in Millimetern nachgebaut.
     * ============================================================ */

    var PAGE = {
        width: 210, height: 297,
        marginX: 18, marginY: 14,
        line: 4.1,          // Zeilenhöhe im Tabellentext
        rowPadding: 2.6,    // Luft über und unter einer Zeile
        minRow: 8.4,
        headRow: 7.2,
        banner: 9.5,
        bannerSub: 4.6,
        title: 15,
        noteLine: 4.1
    };

    /* Spaltenbreiten, zusammen die Satzbreite von 174 mm. */
    var COLUMNS = [22, 48, 54, 50];

    function contentWidth() { return PAGE.width - 2 * PAGE.marginX; }
    function contentHeight() { return PAGE.height - 2 * PAGE.marginY; }

    /*
     * Wie hoch wird der Referenzkasten? Eine Zeile Überschrift, dann pro Ort
     * so viele Zeilen, wie sein Text umbricht. Grob geschätzt über die
     * Zeichenzahl — genau genug, damit unten nichts überläuft.
     */
    function referenceHeight(rows) {
        if (!rows.length) return 0;
        var lines = 1;
        rows.forEach(function (row) {
            var text = row.name + ': ' + row.items.join(', ');
            lines += Math.max(1, Math.ceil(text.length / 96));
        });
        return lines * 3.9 + 5.5;
    }

    function rowHeight(row) {
        if (row.type === 'banner') {
            return PAGE.banner + (row.sub ? PAGE.bannerSub : 0);
        }
        var lines = Math.max(1, row.strike.length, row.setup.length, row.move.length);
        var height = lines * PAGE.line + 2 * PAGE.rowPadding;
        if (row.note) {
            /* Die Notizspalte ist schmal: gemessen bricht sie bei etwa
               dreißig Zeichen um, nicht bei sechzig. Mit der doppelt zu
               großzügigen Schätzung lief die Tabelle über den Blattrand, die
               Fußzeile wurde überdruckt, und bei einer langen Notiz fielen
               ein Balken und ein ganzer Umbau vom Blatt — ausgerechnet die
               Auskunft, für die der Umbauplan da ist. Eigene Zeilenumbrüche
               zählen mit. */
            var noteLines = 0;
            String(row.note).split('\n').forEach(function (part) {
                noteLines += Math.max(1, Math.ceil(part.length / 30));
            });
            height += noteLines * PAGE.noteLine;
        }
        return Math.max(PAGE.minRow, height);
    }

    /*
     * Bricht die Zeilen auf Blätter um. Die erste Seite trägt Titel und
     * Referenzkasten, jede weitere nur die Kopfzeile der Tabelle. Ein Balken
     * wandert mit auf die nächste Seite, wenn die Zeile darunter nicht mehr
     * mit draufpasst — sonst stünde „PAUSE“ allein am Fuß.
     */
    function paginateChangeover(rows, firstPageExtra) {
        var pages = [];
        var page = [];
        var used = (firstPageExtra || 0) + PAGE.headRow;
        var limit = contentHeight();

        function flush() {
            if (page.length) pages.push(page);
            page = [];
            used = PAGE.headRow;
        }

        for (var i = 0; i < rows.length; i++) {
            var height = rowHeight(rows[i]);
            var needed = height;

            // Ein Balken zieht die folgende Zeile mit auf dieselbe Seite.
            if (rows[i].type === 'banner' && rows[i + 1]) {
                needed += rowHeight(rows[i + 1]);
            }

            if (page.length && used + needed > limit) flush();
            page.push(rows[i]);
            used += height;
        }
        flush();
        return pages.length ? pages : [[]];
    }

    function cellLines(items, critical) {
        if (!items.length) return '<span class="sp-uv-empty">—</span>';
        return items.map(function (line) {
            return critical
                ? '<b>' + esc(line) + '</b>'
                : esc(line);
        }).join('<br>');
    }

    function referenceBox(ctx, rows) {
        if (!rows.length) return '';
        var body = rows.map(function (row) {
            return '<div class="sp-uv-ref-line"><b>' + esc(row.name) + ':</b> ' +
                esc(row.items.join(', ')) +
                (row.notes ? ' <i>' + esc(row.notes) + '</i>' : '') + '</div>';
        }).join('');
        return '<div class="sp-uv-ref">' +
            '<div class="sp-uv-ref-head"><b>' + esc(t('For reference')) + '</b> ' +
            '(' + esc(t('The plan gives more')) + ')<b>:</b></div>' +
            body + '</div>';
    }

    function changeoverTable(ctx, rows) {
        var head = '<thead><tr>' +
            '<th style="width:' + COLUMNS[0] + 'mm">' + esc(t('Transition')) + '</th>' +
            '<th style="width:' + COLUMNS[1] + 'mm">' + esc(t('Strike')) + ' ↓</th>' +
            '<th style="width:' + COLUMNS[2] + 'mm">' + esc(t('Bring on')) + ' ↑</th>' +
            '<th style="width:' + COLUMNS[3] + 'mm">' + esc(t('Move')) + '</th>' +
            '</tr></thead>';

        var body = rows.map(function (row) {
            if (row.type === 'banner') {
                return '<tr class="sp-uv-banner"><td colspan="4">' +
                    '<span class="sp-uv-banner-text">— &nbsp; ' + esc(row.text) + ' &nbsp; —</span>' +
                    (row.sub ? '<span class="sp-uv-banner-sub">' + esc(row.sub) + '</span>' : '') +
                    '</td></tr>';
            }
            var label = '<span class="sp-uv-pair">' + (row.isPreset
                ? '<b>' + esc(row.toLabel) + '</b>'
                : esc(row.fromLabel) + ' →<br><b>' + esc(row.toLabel) + '</b>') + '</span>';
            var note = row.note
                ? '<div class="sp-uv-note">★ ' + esc(row.note) + '</div>' : '';
            return '<tr' + (row.critical ? ' class="is-critical"' : '') + '>' +
                '<td class="sp-uv-from">' + (row.isPreset
                    ? '<span class="sp-uv-preset">' + esc(t('Before the show')) + '</span>' + label
                    : label) + '</td>' +
                '<td>' + cellLines(row.strike, row.critical) + '</td>' +
                '<td>' + cellLines(row.setup, row.critical) + note + '</td>' +
                '<td>' + cellLines(row.move, row.critical) + '</td>' +
                '</tr>';
        }).join('');

        return '<table class="sp-uv-table">' + head + '<tbody>' + body + '</tbody></table>';
    }

    function buildChangeover(input) {
        var ctx = context(input);
        var o = ctx.options;
        var p = ctx.production;

        var scoped = scopedScenes(ctx);
        var rows = SP.changeoverRows(
            { scenes: scoped, acts: p.acts, places: p.places, stage: p.stage,
              transitions: p.transitions, numbering: p.numbering },
            {
                nameOf: function (id) { return nameOf(ctx, id); },
                positions: o.positions
            });

        var refRows = o.referenceBox
            ? SP.referenceRows(p, function (id) { return nameOf(ctx, id); }) : [];
        var title = o.changeoverTitle || (t('Change-over plan') +
            (p.name ? ' — ' + p.name : ''));

        var firstExtra = PAGE.title + referenceHeight(refRows);
        var pages = paginateChangeover(rows, firstExtra);

        return pages.map(function (pageRows, index) {
            var isFirst = index === 0;
            return '<article class="sp-sheet sp-uv-sheet">' +
                (isFirst
                    ? '<h1 class="sp-uv-title">' + esc(title) + '</h1>' + referenceBox(ctx, refRows)
                    : '') +
                changeoverTable(ctx, pageRows) +
                '<div class="sp-uv-foot"><span>' + esc(p.name || '') + '</span>' +
                (o.footer ? '<span>' + esc(o.footer) + '</span>' : '<span></span>') +
                '<span>' + esc(t('Page {n} of {total}',
                    { n: index + 1, total: pages.length })) + '</span></div>' +
                '</article>';
        });
    }

    /* ------------------------------------------------------------ Hilfen */

    function paginate(sheets) {
        var total = sheets.length;
        return sheets.map(function (html, i) {
            return html.replace(/%%PAGE%%/g, String(i + 1))
                .replace(/%%PAGES%%/g, String(total));
        });
    }

    /* Alte Signatur: baut weiterhin das Plan-Dokument. */
    function build(input) {
        return buildPlans(input);
    }

    return {
        build: build,
        buildPlans: buildPlans,
        buildChangeover: buildChangeover,
        paginateChangeover: paginateChangeover,
        rowHeight: rowHeight,
        referenceHeight: referenceHeight,
        DEFAULT_OPTIONS: DEFAULT_OPTIONS,
        options: options,
        PAGE: PAGE,
        COLUMNS: COLUMNS
    };
}));
