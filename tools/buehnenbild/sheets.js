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
            /* „und lässt alles andere weg" — so steht es in der Erklärung, und
               so liegen die Blätter, die diese Mannschaft benutzt. Notizen und
               Fußzeile blieben trotzdem stehen; das Blatt heißt `is-bare` und
               war es nicht. */
            return sheet(ctx, 'sp-plan-sheet is-bare',
                '<div class="sp-plan-sheet-bare">' + number +
                '<div class="sp-plan-sheet-plan">' + svg + '</div></div>', 'scenePages');
        }

        return sheet(ctx, 'sp-plan-sheet',
            '<div class="sp-plan-sheet-head">' + number +
            /* Titel und Ort sind zwei Häkchen und zwei Entscheidungen. Vorher
               stand der Ort innerhalb des Titel-Zweigs: „Ort mitdrucken" tat
               nichts, solange „Titel neben der Nummer" aus war, ohne Hinweis. */
            (o.showTitle
                ? '<span class="sp-plan-sheet-title">' + esc(scene.title || t('Untitled scene')) + '</span>'
                : '') +
            (subtitle ? '<span class="sp-plan-sheet-sub">' + esc(subtitle) + '</span>' : '') +
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
                    /* `settingLine` entscheidet in plan.js seit dem Umbau von
                       C7 allein — vorher musste zusätzlich die Bühne zustimmen.
                       Also hier dieselbe Einstellung fragen wie das Szenenblatt,
                       sonst käme die Bauflucht auf die Übersicht, obwohl sie
                       abgehakt ist. `audience` kennt keine solche Rückfallebene
                       (plan.js: `opts.audience !== false`) und bleibt, wie es
                       war: auf dichten Rastern wird sie zu klein zum Lesen. */
                    audience: cols <= 3, settingLine: cols <= 3 && o.showGuides
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
                /* Gezeichnet wird über dieselbe Stelle wie auf dem Plan. Vorher
                   stand hier `prop.art` — was eine Bauvorschrift ist und kein
                   fertiges Bild hat, druckte damit das Wort „undefined“ in die
                   Liste. Der Tisch mit der Decke tat das. */
                var art = '';
                if (prop && prop.image) {
                    art = '<img src="' + esc(prop.image) + '" width="26" height="26" alt="">';
                } else if (prop) {
                    var big = Math.max(prop.w, prop.h) || 1;
                    var pad = big * 0.06;
                    var r4 = function (v) { return SP.round(v, 4); };
                    art = '<svg viewBox="' + r4(-big / 2 - pad) + ' ' + r4(-big / 2 - pad) + ' ' +
                        r4(big + pad * 2) + ' ' + r4(big + pad * 2) +
                        '" width="7mm" height="7mm" class="sp-plan">' +
                        SPPlan.propInner({ x: 0, y: 0, w: prop.w, h: prop.h, rot: 0 },
                            prop, big / 70, {}) + '</svg>';
                }
                var where = entry.scenes.map(function (s) {
                    return numbers[s.sceneId].label + (s.count > 1 ? '×' + s.count : '');
                }).join(', ');
                return '<tr><td style="width:9mm">' + art + '</td>' +
                    /* Zeigt eine Aufstellung auf etwas, das es nicht mehr
                       gibt, stand hier die rohe Kennung — während der
                       Umbauplan an derselben Stelle „Unbekanntes Requisit"
                       schreibt. Zwei Blätter, zwei Antworten. */
                    '<td>' + esc(prop ? t(prop.name) : t('Unknown prop')) + '</td>' +
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

    /*
     * Die Maße, mit denen der Umbruch rechnet. Sie sind kein Entwurf, sondern
     * eine Abschrift dessen, was `planner.css` im Abschnitt „Der Umbauplan“
     * tatsächlich setzt — im Browser nachgemessen. Wer dort einen Schriftgrad
     * oder einen Zeilenabstand ändert, muss ihn hier nachziehen, sonst schätzt
     * der Umbruch wieder zu knapp und `.sp-sheet { overflow: hidden }`
     * schneidet den Rest vom Blatt.
     *
     * Achtung bei `font`: `.sp-sheet table { font-size: 3mm }` ist
     * spezifischer als `.sp-uv-table { font-size: 10pt }` und gewinnt. Die
     * Tabelle steht also in 3 mm, nicht in 10 pt.
     */
    var PAGE = {
        width: 210, height: 297,
        marginX: 18, marginY: 14,

        /* Tabellenzellen */
        font: 3,            // .sp-sheet table { font-size: 3mm }
        line: 3.9605,       // × line-height 1.32
        cellPadX: 2.4,      // .sp-uv-table td { padding: 1.6mm 2.4mm }
        rowPadding: 1.6,    // dieselbe Vorgabe, oben und unten
        rule: 0.3,          // die waagerechte Linie zwischen zwei Zeilen
        minRow: 8.4,
        headRow: 7.7,       // gemessene Kopfzeile 7,62 mm

        /* Die kleine graue Zeile in der Übergangsspalte */
        presetFont: 2.8222, // .sp-uv-preset { font-size: 8pt }
        presetLine: 3.5278, // × line-height 1.25

        /* Die kursive Sternchenzeile */
        noteFont: 3.175,    // .sp-uv-note { font-size: 9pt }
        noteLine: 4.2864,   // × line-height 1.35
        noteIndent: 2.6,    // padding-left
        noteGap: 1.1,       // margin-top

        banner: 9.5,
        bannerSub: 4.6,

        /* Überschrift und Referenzkasten der ersten Seite */
        titleFont: 6,       // .sp-uv-title { font-size: 17pt }
        titleLine: 6.896,   // × line-height 1.15
        titleGap: 4,        // margin-bottom
        title: 15,          // Rückfall, wenn kein Titel bekannt ist
        refFont: 2.8222,    // .sp-uv-ref { font-size: 8pt }
        refLine: 4.0071,    // × line-height 1.42
        refPadX: 2.6,
        refPadY: 2.2,
        refHeadGap: 0.8,
        refBorder: 0.55,
        refGap: 4.5         // margin-bottom
    };

    /* Spaltenbreiten, zusammen die Satzbreite von 174 mm. */
    var COLUMNS = [22, 48, 54, 50];

    function contentHeight() { return PAGE.height - 2 * PAGE.marginY; }

    /* ---------------------------------------------------- Wie breit setzt? */

    /*
     * Der Umbauplan setzt Helvetica (ersatzweise Arial oder Liberation Sans —
     * alle drei tragen dieselben Vorschubbreiten). Die Tabelle unten gibt für
     * jedes Zeichen seine Breite in Tausendstel Geviert, so wie sie in der
     * Schriftdatei steht; im Browser nachgemessen, Abweichung null.
     *
     * Gebraucht wird das, weil vor dem Seitenumbruch feststehen muss, wie
     * hoch eine Zeile wird. Vorher zählte der Umbruch jeden Eintrag als eine
     * gesetzte Zeile. Ein Stuhl mit Beschriftung braucht in der 48-mm-Spalte
     * aber drei: bei vierzig beschrifteten Stühlen schätzte der Umbruch
     * 169 mm und bekam 320 — sieben Stühle standen unter der Blattkante und
     * fehlten im Ausdruck, ohne dass irgendetwas darauf hinwies.
     */
    var GLYPH = (function () {
        var w = {};
        function put(chars, width) {
            for (var i = 0; i < chars.length; i++) w[chars.charAt(i)] = width;
        }
        put('\'’', 191);
        put('ijl', 222);
        put(' !,./:;I[]\\ft|·', 278);
        put('()-r{}`', 333);
        put('"', 355);
        put('*', 389);
        put('°', 400);
        put('^', 469);
        put('cksvxyzJç ', 500);
        put('0123456789abdeghnopqu?#$_Läöüéèàñ–', 556);
        put('+=<>~×÷', 584);
        put('FTZß', 611);
        put('ABEKPSVXY&ÄÉ', 667);
        put('CDHNRUwÜ', 722);
        put('GOQÖ', 778);
        put('Mm', 833);
        put('%', 889);
        put('W', 944);
        put('—→←★', 1000);
        put('@', 1015);
        return w;
    })();

    var GLYPH_DEFAULT = 556;    /* alles Unbekannte so breit wie eine Ziffer */
    var BOLD_FACTOR = 1.09;     /* fett gesetzt läuft der Satz breiter */

    /* Ein Rest Luft auf jede Spaltenbreite: Ersatzschriften, Sperrung und
       Rundung sollen keine Zeile kosten. Lieber ein Blatt mehr als ein
       Requisit weniger. */
    var SAFETY = 0.97;

    function textWidth(text, fontMm, bold) {
        var s = String(text == null ? '' : text);
        var units = 0;
        for (var i = 0; i < s.length; i++) {
            var w = GLYPH[s.charAt(i)];
            units += w === undefined ? GLYPH_DEFAULT : w;
        }
        return units / 1000 * fontMm * (bold ? BOLD_FACTOR : 1);
    }

    /*
     * Bricht einen Text auf eine Spaltenbreite um, so wie der Browser es tut:
     * an den Leerzeichen, und ein Wort, das allein nicht in die Spalte passt,
     * mitten im Wort (`overflow-wrap: break-word`). Zurück kommen die Stellen
     * im Text, an denen je eine Zeile endet — damit lässt sich derselbe Text
     * später genau dort teilen, wo ihn auch das Papier teilt.
     */
    function wrapBreaks(text, widthMm, fontMm, bold) {
        var s = String(text == null ? '' : text);
        var width = Math.max(0.5, widthMm);
        var ends = [];
        var start = 0;      // Anfang der laufenden Zeile
        var used = 0;       // ihre bisherige Breite
        var lastGap = -1;   // letztes Leerzeichen in dieser Zeile
        var i = 0;

        while (i < s.length) {
            var ch = s.charAt(i);
            var cw = textWidth(ch, fontMm, bold);
            /* Ein eigener Zeilenumbruch zählt als Umbruch — auch wenn das
               Markup ihn heute zu einem Leerzeichen zusammenfaltet. Lieber
               eine Zeile zu hoch geschätzt als eine zu flach. */
            if (ch === '\n' || ch === '\r') {
                ends.push(i);
                start = i + 1;
                i = start;
                used = 0;
                lastGap = -1;
                continue;
            }
            if (ch === ' ' || ch === '\t' || ch === '\u2002') {
                lastGap = i;
                used += cw;
                i++;
                continue;
            }
            if (used + cw > width && i > start) {
                var cut = lastGap > start ? lastGap : i;
                ends.push(cut);
                start = cut;
                while (start < s.length && /\s/.test(s.charAt(start))) start++;
                i = start;
                used = 0;
                lastGap = -1;
                continue;
            }
            used += cw;
            i++;
        }
        ends.push(s.length);
        return ends;
    }

    function wrapCount(text, widthMm, fontMm, bold) {
        return wrapBreaks(text, widthMm, fontMm, bold).length;
    }

    /* Die Breite, die in einer Spalte für Text bleibt. */
    function columnText(index) {
        return (COLUMNS[index] - 2 * PAGE.cellPadX) * SAFETY;
    }

    function noteText() {
        return (COLUMNS[2] - 2 * PAGE.cellPadX - PAGE.noteIndent) * SAFETY;
    }

    /* So viele gesetzte Zeilen braucht eine Spalte. Eine leere Spalte trägt
       den Gedankenstrich und ist damit eine Zeile hoch. */
    function listLines(items, index, bold) {
        if (!items || !items.length) return 1;
        var lines = 0;
        for (var i = 0; i < items.length; i++) {
            lines += wrapCount(items[i], columnText(index), PAGE.font, bold);
        }
        return lines;
    }

    /* Stern und ein Halbgeviert — genau das, was changeoverTable setzt. */
    var NOTE_MARK = '★ ';

    function noteLines(note) {
        if (!note) return 0;
        return wrapCount(NOTE_MARK + note, noteText(), PAGE.noteFont);
    }

    function noteHeight(note) {
        var lines = noteLines(note);
        return lines ? PAGE.noteGap + lines * PAGE.noteLine : 0;
    }

    /*
     * Die Übergangsspalte steht auf `nowrap` und lässt sich nicht teilen:
     * „1 →“ und die Zielnummer sind immer zwei gesetzte Zeilen, beim
     * Grundaufbau die graue Zeile „Vor der Vorstellung“ und eine Nummer.
     */
    function transitionHeight(row) {
        var height = row.isPreset
            ? wrapCount(t('Before the show'), columnText(0), PAGE.presetFont) * PAGE.presetLine +
              PAGE.line
            : 2 * PAGE.line;
        /* Der Vermerk „Teil 2 von 3“ einer geteilten Zeile. Zwei Zeilen
           angesetzt, weil die Gesamtzahl beim Teilen noch nicht feststeht. */
        if (row.part) height += 2 * PAGE.presetLine;
        return height;
    }

    /*
     * Wie hoch wird der Referenzkasten? Kopfzeile und pro Ort so viele
     * Zeilen, wie sein Text in der Satzbreite umbricht, dazu Rahmen, Polster
     * und der Abstand zur Tabelle.
     */
    function referenceHeight(rows) {
        if (!rows.length) return 0;
        var width = (PAGE.width - 2 * PAGE.marginX - 2 * PAGE.refPadX) * SAFETY;
        var lines = wrapCount(t('For reference') + ' (' + t('The plan gives more') + '):',
            width, PAGE.refFont);
        rows.forEach(function (row) {
            var text = row.name + ': ' + row.items.join(', ') +
                (row.notes ? ' ' + row.notes : '');
            lines += wrapCount(text, width, PAGE.refFont);
        });
        return lines * PAGE.refLine + PAGE.refHeadGap + 2 * PAGE.refPadY +
            PAGE.refBorder + PAGE.refGap;
    }

    function titleHeight(title) {
        if (!title) return 0;
        var width = (PAGE.width - 2 * PAGE.marginX) * SAFETY;
        return wrapCount(title, width, PAGE.titleFont, true) * PAGE.titleLine + PAGE.titleGap;
    }

    function rowHeight(row) {
        if (row.type === 'banner') {
            return PAGE.banner + (row.sub ? PAGE.bannerSub : 0);
        }
        var bold = !!row.critical;
        var content = Math.max(
            transitionHeight(row),
            listLines(row.strike, 1, bold) * PAGE.line,
            listLines(row.setup, 2, bold) * PAGE.line + noteHeight(row.note),
            listLines(row.move, 3, bold) * PAGE.line);
        return Math.max(PAGE.minRow, content + 2 * PAGE.rowPadding + PAGE.rule);
    }

    /* ------------------------------------------- Eine Zeile teilen dürfen */

    /*
     * Nimmt so viele gesetzte Zeilen vom Anfang einer Spalte, wie erlaubt
     * sind, und gibt den Rest zurück. Ein einzelner Eintrag, der allein zu
     * hoch ist, wird selbst geteilt — sonst käme der Umbruch nie voran.
     */
    function takeLines(items, index, bold, allowed) {
        var head = [];
        var tail = [];
        var left = allowed;
        for (var i = 0; i < (items || []).length; i++) {
            if (left <= 0) { tail.push(items[i]); continue; }
            var ends = wrapBreaks(items[i], columnText(index), PAGE.font, bold);
            if (ends.length <= left) {
                head.push(items[i]);
                left -= ends.length;
                continue;
            }
            var cut = ends[left - 1];
            var kept = items[i].slice(0, cut);
            var rest = items[i].slice(cut).replace(/^\s+/, '');
            if (kept) head.push(kept);
            if (rest) tail.push(rest);
            left = 0;
        }
        return { head: head, tail: tail };
    }

    /* Dasselbe für die Sternchenzeile: geteilt wird an derselben Stelle, an
       der auch das Papier die Zeile umbricht — der Wortlaut bleibt heil. */
    function takeNote(note, availableMm) {
        if (!note) return { head: '', tail: '' };
        var room = Math.floor((availableMm - PAGE.noteGap) / PAGE.noteLine);
        if (room < 1) return { head: '', tail: note };
        var ends = wrapBreaks(NOTE_MARK + note, noteText(), PAGE.noteFont);
        if (ends.length <= room) return { head: note, tail: '' };
        var cut = Math.max(1, ends[room - 1] - NOTE_MARK.length);
        return {
            head: note.slice(0, cut).replace(/\s+$/, ''),
            tail: note.slice(cut).replace(/^\s+/, '')
        };
    }

    function pieceOf(row, strike, setup, move, note) {
        var out = {};
        Object.keys(row).forEach(function (k) { out[k] = row[k]; });
        out.strike = strike;
        out.setup = setup;
        out.move = move;
        out.note = note;
        return out;
    }

    /*
     * Teilt eine Zeile, die auf das angebotene Stück Blatt nicht passt, in
     * einen Kopf, der passt, und einen Rest. Vorher bekam so eine Zeile ein
     * eigenes Blatt — was nichts half, wenn sie höher war als ein Blatt:
     * `overflow: hidden` schnitt sie ab, und von 29 Absätzen einer Notiz
     * kamen 17 aufs Papier, mitten im Satz.
     *
     * Gibt `null` zurück, wenn sich nichts abtrennen lässt; dann ist die
     * Zeile so, wie sie ist, das Beste, was zu drucken bleibt.
     */
    function splitRow(row, availableMm) {
        if (row.type === 'banner') return null;
        var inner = availableMm - 2 * PAGE.rowPadding - PAGE.rule;
        var marked = row.part ? row : pieceOf(row, row.strike, row.setup, row.move, row.note);
        marked.part = row.part || { key: 0, n: 1, total: 0 };
        if (inner < transitionHeight(marked) || inner < PAGE.line) return null;

        var allowed = Math.floor(inner / PAGE.line);
        if (allowed < 1) return null;

        var bold = !!row.critical;
        var strike = takeLines(row.strike || [], 1, bold, allowed);
        var setup = takeLines(row.setup || [], 2, bold, allowed);
        var move = takeLines(row.move || [], 3, bold, allowed);
        /* Die Sternchenzeile steht unter der Aufbau-Spalte; sie kann erst
           mit, wenn die Liste darüber vollständig auf dem Blatt steht. */
        var note = setup.tail.length
            ? { head: '', tail: row.note || '' }
            : takeNote(row.note || '',
                inner - listLines(setup.head, 2, bold) * PAGE.line);

        if (!strike.tail.length && !setup.tail.length && !move.tail.length && !note.tail) {
            return null;
        }
        return {
            head: pieceOf(row, strike.head, setup.head, move.head, note.head),
            tail: pieceOf(row, strike.tail, setup.tail, move.tail, note.tail)
        };
    }

    /*
     * Bricht die Zeilen auf Blätter um. Die erste Seite trägt Titel und
     * Referenzkasten, jede weitere nur die Kopfzeile der Tabelle. Ein Balken
     * wandert mit auf die nächste Seite, wenn die Zeile darunter nicht mehr
     * mit draufpasst — sonst stünde „PAUSE“ allein am Fuß. Und eine Zeile,
     * die auch allein kein Blatt füllt, wird geteilt statt abgeschnitten.
     */
    function paginateChangeover(rows, firstPageExtra) {
        var pages = [];
        var page = [];
        var used = (firstPageExtra || 0) + PAGE.headRow;
        var limit = contentHeight();
        var keys = 0;

        function flush(force) {
            if (page.length || force) pages.push(page);
            page = [];
            used = PAGE.headRow;
        }

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var height = rowHeight(row);
            var needed = height;

            // Ein Balken zieht die folgende Zeile mit auf dieselbe Seite.
            if (row.type === 'banner' && rows[i + 1]) {
                needed += rowHeight(rows[i + 1]);
            }

            if (page.length && used + needed > limit) flush();
            /* Titel und Referenzkasten dürfen keine Zeile zerteilen, die auf
               einem eigenen Blatt Platz hätte. */
            if (!page.length && used > PAGE.headRow && used + height > limit) flush(true);

            if (used + height > limit) {
                var key = ++keys;
                var part = 0;
                var guard = 0;
                while (used + rowHeight(row) > limit && guard++ < 500) {
                    var piece = splitRow(row, limit - used);
                    if (!piece) break;
                    piece.head.part = { key: key, n: ++part, total: 0 };
                    page.push(piece.head);
                    flush();
                    row = piece.tail;
                }
                if (part) row.part = { key: key, n: part + 1, total: 0 };
            }

            page.push(row);
            used += rowHeight(row);
        }
        flush();

        /* „Teil 2 von 3“ steht erst fest, wenn alle Teile gezählt sind. */
        var counted = {};
        pages.forEach(function (p) {
            p.forEach(function (r) {
                if (r.part) counted[r.part.key] = (counted[r.part.key] || 0) + 1;
            });
        });
        pages.forEach(function (p) {
            p.forEach(function (r) {
                if (r.part) r.part.total = counted[r.part.key];
            });
        });

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
                ? '<div class="sp-uv-note">' + NOTE_MARK + esc(row.note) + '</div>' : '';
            /* Ein Umbau, der auf einem Blatt nicht ausgeht, läuft mit derselben
               Nummer auf dem nächsten weiter. Ohne diesen Vermerk läse man zwei
               Umbauten, wo einer gemeint ist. */
            var part = row.part && row.part.total > 1
                ? '<span class="sp-uv-preset">' + esc(t('part {n} of {total}',
                    { n: row.part.n, total: row.part.total })) + '</span>' : '';
            return '<tr' + (row.critical ? ' class="is-critical"' : '') + '>' +
                '<td class="sp-uv-from">' + (row.isPreset
                    ? '<span class="sp-uv-preset">' + esc(t('Before the show')) + '</span>' + label
                    : label) + part + '</td>' +
                '<td>' + cellLines(row.strike, row.critical) + '</td>' +
                '<td>' + cellLines(row.setup, row.critical) + note + '</td>' +
                '<td>' + cellLines(row.move, row.critical) + '</td>' +
                '</tr>';
        }).join('');

        return '<table class="sp-uv-table">' + head + '<tbody>' + body + '</tbody></table>';
    }

    /*
     * Grenzt einen fertig gerechneten Umbauplan auf die gewählten Szenen ein.
     *
     * Gerechnet wird über die ganze Produktion, eingegrenzt erst danach — und
     * das aus zwei Gründen, die beide entschieden sind (6. September 2026):
     * die Nummern bleiben die der ganzen Produktion (II.1, II.2 …), und der
     * Umbau, der *in* den Akt hineinführt, steht mit auf dem Blatt. Die Zeile
     * einer Szene ist ja genau dieser Umbau. Vorher bekam der Umbauplan die
     * gefilterte Liste: er zählte von vorn (Planblätter 4, 5, 6 gegen
     * Umbauplan 1, 2, 3) und nannte die erste Zeile „Vor der Vorstellung“,
     * obwohl davor der ganze erste Akt lag — für die Pause, den größten Umbau
     * des Abends, hing dann kein Blatt an der Bühnentür.
     *
     * Ein Balken gehört zu dem Umbau, an dem er hängt; die Buchführung dazu
     * kommt aus derselben Quelle wie in `changeoverRows`.
     */
    function scopeRows(production, rows, scoped) {
        var keep = {};
        scoped.forEach(function (s) { keep[s.id] = true; });
        var scenes = production.scenes || [];
        var out = [];
        var at = 0;
        for (var i = 0; i < scenes.length; i++) {
            var trans = SP.getTransition(production, i > 0 ? scenes[i - 1] : null, scenes[i]);
            var before = 0;
            var after = 0;
            ((trans && trans.banners) || []).forEach(function (b) {
                if (b.where === 'after') after++; else before++;
            });
            var row = rows[at + before];
            if (!row || row.type !== 'row' || row.sceneId !== scenes[i].id) {
                /* Die Buchführung geht nicht auf — dann lieber zu viel
                   drucken als eine Zeile stillschweigend verlieren. */
                return rows.filter(function (r) {
                    return r.type !== 'row' || keep[r.sceneId];
                });
            }
            var chunk = rows.slice(at, at + before + 1 + after);
            at += chunk.length;
            if (keep[scenes[i].id]) out = out.concat(chunk);
        }
        return out;
    }

    function buildChangeover(input) {
        var ctx = context(input);
        var o = ctx.options;
        var p = ctx.production;

        var all = p.scenes || [];
        var scoped = scopedScenes(ctx);
        var rows = SP.changeoverRows(
            { scenes: all, acts: p.acts, places: p.places, stage: p.stage,
              transitions: p.transitions, numbering: p.numbering },
            {
                nameOf: function (id) { return nameOf(ctx, id); },
                positions: o.positions
            });
        if (scoped.length !== all.length) rows = scopeRows(p, rows, scoped);

        /* Der Referenzkasten folgt demselben Ausschnitt wie die Tabelle.
           Vorher listete er bei einem einzeln gedruckten Akt weiter alle Orte
           des Abends — auch die, die in diesem Akt nicht vorkommen —, während
           die Erklärung „beschränkt beide Dokumente auf einen Akt" sagt. */
        var refSource = scoped.length === all.length ? p : {
            scenes: scoped,
            places: (p.places || []).filter(function (place) {
                return scoped.some(function (s) { return s.placeId === place.id; });
            })
        };
        var refRows = o.referenceBox
            ? SP.referenceRows(refSource, function (id) { return nameOf(ctx, id); }) : [];
        var title = o.changeoverTitle || (t('Change-over plan') +
            (p.name ? ' — ' + p.name : ''));

        var firstExtra = titleHeight(title) + referenceHeight(refRows);
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
        splitRow: splitRow,
        wrapCount: wrapCount,
        columnText: columnText,
        titleHeight: titleHeight,
        referenceHeight: referenceHeight,
        DEFAULT_OPTIONS: DEFAULT_OPTIONS,
        options: options,
        PAGE: PAGE,
        COLUMNS: COLUMNS
    };
}));
