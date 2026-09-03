/*
 * Scene & Prop Planner
 *
 * Everything lives in this browser: productions, scenes, stages, custom prop
 * drawings. Nothing is uploaded, and the only thing standing between the user
 * and a lost evening's work is localStorage, so the export button is never
 * more than one click away.
 */
(function () {
    'use strict';

    var STORE_KEY = 'sp.planner.v1';
    var UI_KEY = 'sp.planner.ui.v1';
    var UNDO_DEPTH = 40;
    var MM = 96 / 25.4;

    var $ = function (sel, root) { return (root || document).querySelector(sel); };
    var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
    var esc = SPPlan.escape;

    /* ================================================================== *
     * State
     * ================================================================== */

    var db = null;
    var ui = {
        tab: 'scenes',
        inspector: 'props',
        sceneId: null,
        selection: [],
        view: null,
        snap: true,
        ghosts: false,
        labels: 'name',
        propSearch: '',
        propCategory: 'all',
        librarySearch: '',
        libraryCategory: 'all',
        print: null
    };
    var undoStack = [];
    var redoStack = [];
    var clipboard = [];
    var saveTimer = null;

    function defaultStage() {
        var stage = JSON.parse(JSON.stringify(SP.DEFAULT_STAGE));
        stage.curtains = [{ id: SP.uid('cur'), name: 'House curtain', offset: 0.4, state: 'closed' }];
        return stage;
    }

    function newScene(title) {
        return {
            id: SP.uid('sc'), actId: null, title: title || '', subtitle: '',
            notes: '', label: '', placements: [], curtains: {}
        };
    }

    function newProduction(name) {
        return {
            id: SP.uid('prod'),
            name: name || 'Untitled production',
            subtitle: '', venue: '', notes: '',
            units: 'm',
            numbering: 'continuous',
            stage: defaultStage(),
            acts: [],
            scenes: [newScene('Opening')],
            presets: [],
            print: null,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
    }

    function blankDb() {
        var production = newProduction('Untitled production');
        return {
            version: 1,
            activeId: production.id,
            productions: [production],
            library: []
        };
    }

    function load() {
        var raw = null;
        try { raw = localStorage.getItem(STORE_KEY); } catch (err) { raw = null; }
        if (!raw) return blankDb();
        try {
            var parsed = JSON.parse(raw);
            if (!parsed || !Array.isArray(parsed.productions) || !parsed.productions.length) return blankDb();
            parsed.library = parsed.library || [];
            parsed.productions.forEach(migrateProduction);
            if (!parsed.productions.some(function (p) { return p.id === parsed.activeId; })) {
                parsed.activeId = parsed.productions[0].id;
            }
            return parsed;
        } catch (err) {
            console.warn('Saved plan could not be read, starting fresh.', err);
            return blankDb();
        }
    }

    /* Fills in anything a plan saved by an earlier version is missing, so an
       old file never lands the editor in a half-built state. */
    function migrateProduction(p) {
        p.units = p.units || 'm';
        p.numbering = p.numbering || 'continuous';
        p.acts = p.acts || [];
        p.presets = p.presets || [];
        p.scenes = p.scenes || [];
        p.stage = Object.assign({}, SP.DEFAULT_STAGE, p.stage || {});
        p.stage.grid = Object.assign({ show: true, spacing: 1, labels: false }, p.stage.grid || {});
        p.stage.curtains = p.stage.curtains || [];
        p.stage.markers = p.stage.markers || [];
        p.scenes.forEach(function (s) {
            s.placements = s.placements || [];
            s.curtains = s.curtains || {};
            s.placements.forEach(function (pl) {
                if (!pl.trackId) pl.trackId = SP.uid('trk');
                if (typeof pl.rot !== 'number') pl.rot = 0;
            });
            if (s.stage) s.stage = Object.assign({}, SP.DEFAULT_STAGE, s.stage);
        });
        return p;
    }

    function loadUi() {
        try {
            var raw = localStorage.getItem(UI_KEY);
            if (raw) Object.assign(ui, JSON.parse(raw));
        } catch (err) { /* preferences are not worth an error message */ }
        ui.selection = [];
        ui.view = null;
    }

    function persistUi() {
        try {
            localStorage.setItem(UI_KEY, JSON.stringify({
                tab: ui.tab, inspector: ui.inspector, snap: ui.snap, ghosts: ui.ghosts,
                labels: ui.labels, propCategory: ui.propCategory, libraryCategory: ui.libraryCategory,
                print: ui.print
            }));
        } catch (err) { /* ignore */ }
    }

    function setSaveState(text, tone) {
        var el = $('#spSaveState');
        if (!el) return;
        el.textContent = text;
        el.style.color = tone === 'bad' ? 'var(--accent)' : '';
    }

    function persist() {
        clearTimeout(saveTimer);
        setSaveState('Saving…');
        saveTimer = setTimeout(saveNow, 350);
    }

    function saveNow() {
        clearTimeout(saveTimer);
        try {
            production().updatedAt = Date.now();
            localStorage.setItem(STORE_KEY, JSON.stringify(db));
            setSaveState('Saved locally');
        } catch (err) {
            setSaveState('Could not save: storage is full', 'bad');
            toast('This browser will not store any more. Export a backup, then delete an old production or a heavy custom prop.', 'error');
        }
    }

    function toast(message, type) {
        if (typeof showToast === 'function') showToast(message, type || 'info');
        else console.log(message);
    }

    /* ------------------------------------------------------------ access */

    function production() {
        for (var i = 0; i < db.productions.length; i++) {
            if (db.productions[i].id === db.activeId) return db.productions[i];
        }
        return db.productions[0];
    }

    function scenes() { return production().scenes; }

    function scene() {
        var list = scenes();
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === ui.sceneId) return list[i];
        }
        return list[0] || null;
    }

    function sceneIndex(target) {
        return scenes().indexOf(target || scene());
    }

    function previousScene() {
        var i = sceneIndex();
        return i > 0 ? scenes()[i - 1] : null;
    }

    function stageOf(target) {
        return (target && target.stage) || production().stage;
    }

    function units() { return production().units || 'm'; }

    function libraryById(id) {
        for (var i = 0; i < db.library.length; i++) {
            if (db.library[i].id === id) return db.library[i];
        }
        return null;
    }

    function resolveProp(id) {
        return SPProps.get(id) || libraryById(id);
    }

    function allProps() {
        return SPProps.LIBRARY.concat(db.library);
    }

    function findPlacement(id, target) {
        var list = (target || scene()).placements;
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id) return list[i];
        }
        return null;
    }

    function selectedPlacements() {
        var sc = scene();
        if (!sc) return [];
        return ui.selection.map(function (id) { return findPlacement(id, sc); })
            .filter(Boolean);
    }

    /* ------------------------------------------------------------- undo */

    function snapshot() {
        return JSON.stringify({ activeId: db.activeId, productions: db.productions, library: db.library });
    }

    function restore(state) {
        var parsed = JSON.parse(state);
        db.activeId = parsed.activeId;
        db.productions = parsed.productions;
        db.library = parsed.library;
        db.productions.forEach(migrateProduction);
        if (!scene() || scenes().indexOf(scene()) === -1) ui.sceneId = (scenes()[0] || {}).id;
        ui.selection = ui.selection.filter(function (id) { return !!findPlacement(id); });
    }

    var pendingHistory = null;

    function beginHistory() {
        pendingHistory = snapshot();
    }

    function commitHistory() {
        if (pendingHistory === null) return;
        pushHistory(pendingHistory);
        pendingHistory = null;
    }

    function cancelHistory() { pendingHistory = null; }

    function pushHistory(state) {
        undoStack.push(state);
        if (undoStack.length > UNDO_DEPTH) undoStack.shift();
        redoStack.length = 0;
    }

    /* Every model change goes through here: one snapshot, one save, one draw. */
    function change(fn) {
        var before = snapshot();
        fn();
        pushHistory(before);
        persist();
        render();
    }

    function undo() {
        if (!undoStack.length) return;
        var current = snapshot();
        restore(undoStack.pop());
        redoStack.push(current);
        persist();
        render();
    }

    function redo() {
        if (!redoStack.length) return;
        var current = snapshot();
        restore(redoStack.pop());
        undoStack.push(current);
        persist();
        render();
    }

    /* ------------------------------------------------------------ units */

    function fromField(value, fallback) {
        var n = parseFloat(String(value).replace(',', '.'));
        if (!isFinite(n)) return fallback;
        return SP.toMetres(n, units());
    }

    function toField(metres, digits) {
        var v = SP.toUnit(metres, units());
        return String(SP.round(v, digits === undefined ? 2 : digits));
    }

    function lengthLabel() { return units() === 'ft' ? 'ft' : 'm'; }

    /* ================================================================== *
     * A worked example, for anyone who would rather see it than read it
     * ================================================================== */

    function buildExample() {
        var p = newProduction('The Winter Guest');
        p.subtitle = 'A play in two acts';
        p.venue = 'Studio theatre';
        p.numbering = 'per-act';
        p.stage.shape = 'thrust';
        p.stage.width = 11;
        p.stage.depth = 7.5;
        p.stage.apronWidth = 6.5;
        p.stage.apronDepth = 2.2;
        p.stage.grid.labels = true;
        p.stage.curtains = [
            { id: SP.uid('cur'), name: 'House curtain', offset: 0.3, state: 'closed' },
            { id: SP.uid('cur'), name: 'Mid traveller', offset: 4.2, state: 'open' }
        ];

        var act1 = { id: SP.uid('act'), name: 'Act one', notes: 'The house, over one long evening.' };
        var act2 = { id: SP.uid('act'), name: 'Act two', notes: 'The garden, the following spring.' };
        p.acts = [act1, act2];

        function place(propId, x, y, rot, label) {
            var prop = SPProps.get(propId);
            var pl = SP.makePlacement(prop, x, y);
            pl.rot = rot || 0;
            if (label) pl.label = label;
            return pl;
        }

        var drawingRoom = [
            place('sofa-3', -2.2, 4.4, 0, 'Family sofa'),
            place('armchair', 1.9, 4.1, -35),
            place('table-round', -0.2, 5.6, 0, 'Tea table'),
            place('side-table', 3.1, 3.2, 0),
            place('floor-lamp', 3.5, 4.6, 0),
            place('bookshelf', -4.3, 1.2, 0),
            place('door-frame', 3.9, 0.6, 0, 'To the hall'),
            place('window-frame', -1.6, 0.35, 0),
            place('rug', -0.6, 5.0, 0)
        ];

        var s1 = newScene('The drawing room');
        s1.actId = act1.id;
        s1.subtitle = 'Evening, the first frost';
        s1.notes = 'Tea things preset on the round table. Fire lit.';
        s1.placements = drawingRoom;

        var s2 = newScene('After the argument');
        s2.actId = act1.id;
        s2.subtitle = 'Later the same night';
        s2.placements = SP.copyPlacements(drawingRoom, true);
        s2.placements[2].x = -2.6;      // the tea table is pushed aside
        s2.placements[2].y = 6.4;
        s2.placements[1].rot = 20;
        s2.placements.push(place('suitcase', 2.4, 6.2, 15, 'Anna packed'));

        var s3 = newScene('Empty house');
        s3.actId = act1.id;
        s3.subtitle = 'Dawn';
        s3.placements = [
            SP.copyPlacements([drawingRoom[0]], true)[0],
            place('window-frame', -1.6, 0.35, 0),
            place('door-frame', 3.9, 0.6, 0, 'To the hall')
        ];

        var s4 = newScene('The garden');
        s4.actId = act2.id;
        s4.subtitle = 'Spring, late afternoon';
        s4.placements = [
            place('tree', -3.4, 2.1, 0, 'The old cherry'),
            place('bench', 0.4, 5.2, 0),
            place('bush', 3.2, 2.4, 0),
            place('bush', 4.1, 3.6, 0),
            place('railing', 0, 0.6, 0)
        ];

        var s5 = newScene('The last visit');
        s5.actId = act2.id;
        s5.placements = SP.copyPlacements(s4.placements, true);
        s5.placements[1].x = -1.4;
        s5.placements[1].rot = -18;
        s5.placements.push(place('suitcase', 2.2, 5.8, 0, 'Anna packed'));
        s5.placements.push(place('table-square', 2.6, 4.4, 0));

        p.scenes = [s1, s2, s3, s4, s5];
        p.stage.curtains.forEach(function (c) {
            p.scenes.forEach(function (s) { s.curtains[c.id] = c.name === 'House curtain' ? 'open' : 'open'; });
        });
        s1.curtains[p.stage.curtains[0].id] = 'closed';

        p.presets = [{
            id: SP.uid('pre'),
            name: 'Drawing room, full set',
            placements: SP.copyPlacements(drawingRoom, false)
        }];
        return p;
    }

    /* ================================================================== *
     * Drawing the interface
     * ================================================================== */

    function render() {
        renderTopBar();
        if (ui.tab === 'scenes') { renderSceneList(); renderCanvas(true); renderInspector(); }
        if (ui.tab === 'stage') renderStageTab();
        if (ui.tab === 'props') renderLibraryTab();
        if (ui.tab === 'print') renderPrintTab();
    }

    function renderTopBar() {
        var select = $('#spProductionSelect');
        select.innerHTML = db.productions.map(function (p) {
            return '<option value="' + esc(p.id) + '"' + (p.id === db.activeId ? ' selected' : '') + '>' +
                esc(p.name || 'Untitled production') + '</option>';
        }).join('');
        $('#spUndo').disabled = !undoStack.length;
        $('#spRedo').disabled = !redoStack.length;
        $$('.sp-tab-btn').forEach(function (btn) {
            btn.setAttribute('aria-selected', btn.dataset.tab === ui.tab ? 'true' : 'false');
        });
        $$('.sp-panel').forEach(function (panel) {
            panel.classList.toggle('is-active', panel.id === 'spPanel-' + ui.tab);
        });
    }

    /* ------------------------------------------------------ running order */

    function renderSceneList() {
        var host = $('#spSceneList');
        var p = production();
        var numbers = SP.sceneNumbers(p);
        var groups = SP.groupScenesByAct(p);

        if (!p.scenes.length) {
            host.innerHTML = '<div class="sp-empty">No scenes yet.<br>' +
                '<button class="sp-btn" data-act="add-scene" style="margin-top:0.7rem">Add the first scene</button>' +
                '<button class="sp-btn is-quiet" data-act="load-example" style="margin-top:0.7rem">Open an example</button></div>';
            return;
        }

        var html = groups.map(function (group) {
            var head = '';
            if (group.act) {
                head = '<div class="sp-act-head"><strong>' + esc(group.act.name || 'Act') + '</strong>' +
                    '<button class="sp-btn is-quiet" data-act="edit-act" data-id="' + esc(group.act.id) + '" title="Rename this act">Edit</button></div>';
            } else if (groups.length > 1 || p.acts.length) {
                head = '<div class="sp-act-head"><strong>Not in an act</strong></div>';
            }

            return head + group.scenes.map(function (s) {
                var index = p.scenes.indexOf(s);
                var diff = index > 0 ? SP.diffScenes(p.scenes[index - 1], s) : null;
                var changes = diff ? SP.changeCount(diff) : 0;
                var sub = s.placements.length + ' prop' + (s.placements.length === 1 ? '' : 's');
                if (diff) sub += changes ? ' · <em>' + changes + ' change' + (changes === 1 ? '' : 's') + '</em>' : ' · no change';
                else sub += ' · preset';

                return '<div class="sp-scene-row' + (s.id === (scene() || {}).id ? ' is-active' : '') +
                    '" data-act="pick-scene" data-id="' + esc(s.id) + '" draggable="true">' +
                    '<span class="sp-scene-no">' + esc(numbers[s.id].label) + '</span>' +
                    '<span class="sp-scene-main"><span class="sp-scene-title">' +
                    esc(s.title || 'Untitled scene') + '</span>' +
                    '<span class="sp-scene-sub">' + sub + '</span></span>' +
                    '<span class="sp-scene-tools">' +
                    '<button class="sp-btn is-quiet" data-act="duplicate-scene" data-id="' + esc(s.id) + '" title="Duplicate this scene">Copy</button>' +
                    '<button class="sp-btn is-quiet is-danger" data-act="delete-scene" data-id="' + esc(s.id) + '" title="Delete this scene">&times;</button>' +
                    '</span></div>';
            }).join('');
        }).join('');

        host.innerHTML = html;
    }

    /* ------------------------------------------------------------ canvas */

    function planSettings(sc, extra) {
        var prev = previousScene();
        var diff = prev ? SP.diffScenes(prev, sc) : null;
        var settings = {
            stage: stageOf(sc),
            scene: sc,
            resolve: resolveProp,
            units: units(),
            labels: ui.labels,
            idPrefix: 'edit',
            interactive: true,
            selected: ui.selection,
            ghosts: ui.ghosts && prev ? prev.placements : null,
            ghostArrows: ui.ghosts && diff ? diff.moved : null,
            emphasise: diff ? {
                added: diff.added.map(function (x) { return x.id; }),
                moved: diff.moved.map(function (m) { return m.to.id; })
            } : null
        };
        return Object.assign(settings, extra || {});
    }

    function renderCanvas(keepView) {
        var svg = $('#spCanvas');
        var note = $('#spCanvasNote');
        var sc = scene();

        if (!sc) {
            svg.innerHTML = '';
            note.hidden = false;
            note.textContent = 'No scene selected. Add one on the left to start placing props.';
            $('#spSceneTitle').value = '';
            $('#spSceneTitle').disabled = true;
            return;
        }
        $('#spSceneTitle').disabled = false;
        if (document.activeElement !== $('#spSceneTitle')) $('#spSceneTitle').value = sc.title || '';

        var plan = SPPlan.build(planSettings(sc));
        svg.innerHTML = plan.inner + '<g id="spOverlay"></g>';
        canvasPlan = plan;

        if (!keepView || !ui.view) ui.view = Object.assign({}, plan.view);
        applyView();
        renderOverlay();

        note.hidden = sc.placements.length > 0;
        if (!sc.placements.length) {
            var untouched = production().scenes.length === 1 && !production().acts.length &&
                !production().presets.length;
            note.innerHTML = untouched
                ? 'Bare stage. Drag a prop in from the right to start.<br>' +
                  '<button class="sp-btn" data-act="load-example" style="margin-top:0.6rem">' +
                  'Or open a worked example</button>'
                : 'Bare stage. Drag a prop in from the right, or copy the layout from another scene.';
        }

        var offstage = sc.placements.filter(function (pl) {
            return !SP.containsPoint(stageOf(sc), pl.x, pl.y);
        });
        $('#spOffstageWarning').textContent = offstage.length
            ? offstage.length + (offstage.length === 1 ? ' prop sits' : ' props sit') + ' outside the stage outline'
            : '';

        $('#spSnapToggle').classList.toggle('is-on', ui.snap);
        $('#spGhostToggle').classList.toggle('is-on', ui.ghosts);
        $('#spLabelMode').value = ui.labels;
    }

    var canvasPlan = null;

    function applyView() {
        var v = ui.view;
        if (!v) return;
        $('#spCanvas').setAttribute('viewBox', [v.x, v.y, v.w, v.h].map(function (n) {
            return Math.round(n * 1000) / 1000;
        }).join(' '));
    }

    /* The four corners of a placement, in stage coordinates. */
    function corners(p) {
        var a = (p.rot || 0) * Math.PI / 180;
        var cos = Math.cos(a), sin = Math.sin(a);
        var hw = p.w / 2, hh = p.h / 2;
        return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(function (c) {
            return [p.x + c[0] * cos - c[1] * sin, p.y + c[0] * sin + c[1] * cos];
        });
    }

    function renderOverlay(temp) {
        var layer = $('#spOverlay');
        if (!layer) return;
        var sel = selectedPlacements();
        if (!sel.length || !ui.view) { layer.innerHTML = ''; return; }

        var scale = ui.view.w;
        var hair = scale / 480;
        var handle = scale / 60;
        var parts = [];

        if (sel.length === 1) {
            var p = temp && temp.id === sel[0].id ? temp : sel[0];
            var hw = p.w / 2, hh = p.h / 2;
            parts.push('<g transform="translate(' + p.x + ' ' + p.y + ') rotate(' + (p.rot || 0) + ')">' +
                '<rect class="sp-select-box" x="' + (-hw) + '" y="' + (-hh) + '" width="' + p.w +
                '" height="' + p.h + '" stroke-width="' + hair * 1.6 + '"/>' +
                (p.locked ? '' :
                    '<line class="sp-select-box" x1="0" y1="' + (-hh) + '" x2="0" y2="' + (-hh - handle * 1.6) +
                    '" stroke-width="' + hair * 1.2 + '"/>' +
                    '<circle class="sp-handle" cx="0" cy="' + (-hh - handle * 1.6) + '" r="' + handle * 0.5 +
                    '" stroke-width="' + hair * 1.4 + '"/>' +
                    '<circle class="sp-handle-hit" data-handle="rotate" cx="0" cy="' + (-hh - handle * 1.6) +
                    '" r="' + handle + '"/>' +
                    '<rect class="sp-handle" x="' + (hw - handle * 0.4) + '" y="' + (hh - handle * 0.4) +
                    '" width="' + handle * 0.8 + '" height="' + handle * 0.8 + '" stroke-width="' + hair * 1.4 + '"/>' +
                    '<rect class="sp-handle-hit" data-handle="scale" x="' + (hw - handle) + '" y="' + (hh - handle) +
                    '" width="' + handle * 2 + '" height="' + handle * 2 + '"/>') +
                '</g>');
        } else {
            var xs = [], ys = [];
            sel.forEach(function (item) {
                corners(item).forEach(function (c) { xs.push(c[0]); ys.push(c[1]); });
            });
            var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
            var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
            parts.push('<rect class="sp-select-box" x="' + x0 + '" y="' + y0 + '" width="' + (x1 - x0) +
                '" height="' + (y1 - y0) + '" stroke-width="' + hair * 1.6 +
                '" stroke-dasharray="' + hair * 6 + ' ' + hair * 4 + '"/>');
        }
        layer.innerHTML = parts.join('');
    }

    /* --------------------------------------------------------- inspector */

    function renderInspector() {
        $$('[data-inspector]').forEach(function (btn) {
            btn.setAttribute('aria-selected', btn.dataset.inspector === ui.inspector ? 'true' : 'false');
        });
        $('#spInspectorProps').hidden = ui.inspector !== 'props';
        $('#spInspectorItem').hidden = ui.inspector !== 'item';
        $('#spInspectorScene').hidden = ui.inspector !== 'scene';

        if (ui.inspector === 'props') renderPalette();
        if (ui.inspector === 'item') renderItemInspector();
        if (ui.inspector === 'scene') renderSceneInspector();

        var sel = selectedPlacements();
        $('#spSelectionReadout').textContent = sel.length === 1
            ? (resolveProp(sel[0].propId) || {}).name + ' — ' + SP.describePosition(stageOf(scene()), sel[0].x, sel[0].y, units())
            : (sel.length ? sel.length + ' props selected' : '');
    }

    function propTile(prop) {
        var art = prop.image
            ? '<img src="' + esc(prop.image) + '" alt="" style="width:100%;height:40px;object-fit:contain">'
            : '<svg viewBox="0 0 100 100" class="sp-plan"><g class="sp-art" stroke-width="4">' + prop.art + '</g></svg>';
        return '<div class="sp-tile" draggable="true" data-act="add-prop" data-prop="' + esc(prop.id) + '" title="' +
            esc(prop.name) + '">' + art +
            '<span class="sp-tile-name">' + esc(prop.name) + '</span>' +
            '<span class="sp-tile-size">' + toField(prop.w, 2) + ' × ' + toField(prop.h, 2) + ' ' + lengthLabel() + '</span></div>';
    }

    function matchesSearch(prop, query) {
        if (!query) return true;
        var q = query.toLowerCase();
        return (prop.name + ' ' + (prop.tags || '') + ' ' + prop.cat).toLowerCase().indexOf(q) !== -1;
    }

    function categoryOptions(selected) {
        var cats = SPProps.CATEGORIES.slice();
        db.library.forEach(function (p) { if (cats.indexOf(p.cat) === -1) cats.push(p.cat); });
        return '<option value="all"' + (selected === 'all' ? ' selected' : '') + '>Every category</option>' +
            cats.map(function (c) {
                return '<option value="' + esc(c) + '"' + (selected === c ? ' selected' : '') + '>' + esc(c) + '</option>';
            }).join('');
    }

    function renderPalette() {
        var select = $('#spPropCategory');
        if (select.dataset.built !== 'yes' || select.dataset.count !== String(db.library.length)) {
            select.innerHTML = categoryOptions(ui.propCategory);
            select.dataset.built = 'yes';
            select.dataset.count = String(db.library.length);
        }
        select.value = ui.propCategory;
        $('#spPropSearch').value = ui.propSearch;

        var list = allProps().filter(function (p) {
            return (ui.propCategory === 'all' || p.cat === ui.propCategory) && matchesSearch(p, ui.propSearch);
        });

        if (!list.length) {
            $('#spPalette').innerHTML = '<p class="sp-empty" style="grid-column:1/-1">Nothing matches that.</p>';
            return;
        }

        var html = '';
        var lastCat = null;
        list.forEach(function (prop) {
            if (prop.cat !== lastCat && ui.propCategory === 'all') {
                html += '<div class="sp-cat-head">' + esc(prop.cat) + '</div>';
                lastCat = prop.cat;
            }
            html += propTile(prop);
        });
        $('#spPalette').innerHTML = html;
    }

    function renderItemInspector() {
        var host = $('#spInspectorItem');
        var sel = selectedPlacements();
        var sc = scene();

        if (!sel.length) {
            host.innerHTML = '<div class="sp-empty">Nothing selected.<br>Click a prop on the stage, or drag a box around several.</div>';
            return;
        }

        if (sel.length > 1) {
            host.innerHTML =
                '<div class="sp-section"><h3>' + sel.length + ' props selected</h3>' +
                '<div class="sp-btn-row">' +
                '<button class="sp-btn" data-act="align" data-axis="x">Line up across</button>' +
                '<button class="sp-btn" data-act="align" data-axis="y">Line up upstage</button>' +
                '<button class="sp-btn" data-act="spread" data-axis="x">Space evenly</button>' +
                '<button class="sp-btn" data-act="mirror-selection">Mirror</button>' +
                '<button class="sp-btn" data-act="duplicate-selection">Duplicate</button>' +
                '<button class="sp-btn is-danger" data-act="delete-selection">Delete</button>' +
                '</div></div>' +
                '<div class="sp-section"><h3>In this selection</h3><ul style="list-style:none;padding:0;margin:0">' +
                SP.groupByProp(sel, function (id) { return (resolveProp(id) || {}).name || id; }).map(function (g) {
                    return '<li style="font-size:0.82rem;padding:0.15rem 0">' +
                        (g.count > 1 ? g.count + ' × ' : '') + esc(g.name) + '</li>';
                }).join('') + '</ul></div>';
            return;
        }

        var p = sel[0];
        var prop = resolveProp(p.propId) || { name: 'Unknown prop', cat: '' };
        var stage = stageOf(sc);
        var out = SP.stageOutline(stage);
        var gridRef = stage.grid && stage.grid.labels
            ? SP.gridReference(stage, p.x, p.y, SP.num(stage.grid.spacing, 1)) : null;

        host.innerHTML =
            '<div class="sp-section">' +
            '<h3>' + esc(prop.name) + '</h3>' +
            '<div class="sp-field"><label for="spItemLabel">Written on the plan</label>' +
            '<input type="text" id="spItemLabel" data-bind="item.label" value="' + esc(p.label || '') +
            '" placeholder="e.g. Anna&rsquo;s chair"></div>' +
            '<div class="sp-field"><label for="spItemNote">Note for the crew</label>' +
            '<textarea id="spItemNote" data-bind="item.note" placeholder="Comes on from stage right">' +
            esc(p.note || '') + '</textarea></div>' +
            '</div>' +

            '<div class="sp-section"><h3>Position</h3>' +
            '<div class="sp-field-row">' +
            '<div><label for="spItemX">Across from centre (' + lengthLabel() + ')</label>' +
            '<input type="number" step="0.05" id="spItemX" data-bind="item.x" value="' + toField(p.x) + '"></div>' +
            '<div><label for="spItemY">Upstage of setting line (' + lengthLabel() + ')</label>' +
            '<input type="number" step="0.05" id="spItemY" data-bind="item.upstage" value="' +
            toField(out.frontY - p.y) + '"></div>' +
            '</div>' +
            '<div class="sp-field-row">' +
            '<div><label for="spItemRot">Turned (degrees)</label>' +
            '<input type="number" step="5" id="spItemRot" data-bind="item.rot" value="' + SP.round(p.rot || 0, 1) + '"></div>' +
            '<div><label>Reads as</label><p class="sp-hint" style="margin-top:0.3rem">' +
            esc(SP.zoneName(stage, p.x, p.y)) + (gridRef ? ', square ' + gridRef : '') + '</p></div>' +
            '</div>' +
            '<p class="sp-hint">' + esc(SP.describePosition(stage, p.x, p.y, units())) + '</p>' +
            '</div>' +

            '<div class="sp-section"><h3>Size</h3>' +
            '<div class="sp-field-row">' +
            '<div><label for="spItemW">Across (' + lengthLabel() + ')</label>' +
            '<input type="number" step="0.05" min="0.05" id="spItemW" data-bind="item.w" value="' + toField(p.w) + '"></div>' +
            '<div><label for="spItemH">Deep (' + lengthLabel() + ')</label>' +
            '<input type="number" step="0.05" min="0.05" id="spItemH" data-bind="item.h" value="' + toField(p.h) + '"></div>' +
            '</div>' +
            '<div class="sp-btn-row">' +
            '<button class="sp-btn" data-act="reset-size">Back to catalogue size</button>' +
            '<button class="sp-btn' + (p.flip ? ' is-on' : '') + '" data-act="flip">Flip</button>' +
            '<button class="sp-btn' + (p.locked ? ' is-on' : '') + '" data-act="lock">' +
            (p.locked ? 'Locked' : 'Lock') + '</button>' +
            '</div></div>' +

            '<div class="sp-section"><h3>Order and copies</h3><div class="sp-btn-row">' +
            '<button class="sp-btn" data-act="raise">Bring forward</button>' +
            '<button class="sp-btn" data-act="lower">Send back</button>' +
            '<button class="sp-btn" data-act="duplicate-selection">Duplicate</button>' +
            '<button class="sp-btn" data-act="push-forward">Carry into later scenes…</button>' +
            '<button class="sp-btn is-danger" data-act="delete-selection">Delete</button>' +
            '</div></div>';
    }

    function renderSceneInspector() {
        var host = $('#spInspectorScene');
        var sc = scene();
        var p = production();
        if (!sc) { host.innerHTML = '<div class="sp-empty">No scene selected.</div>'; return; }

        var numbers = SP.sceneNumbers(p);
        var prev = previousScene();
        var diff = prev ? SP.diffScenes(prev, sc) : null;
        var stage = stageOf(sc);

        var changeHtml;
        if (!diff) {
            changeHtml = '<p class="sp-hint">This is the first scene, so everything here is a preset before the house opens.</p>';
        } else if (!SP.changeCount(diff)) {
            changeHtml = '<p class="sp-hint">Nothing changes from the scene before.</p>';
        } else {
            var lines = SPSheets.changeLines({ resolve: resolveProp, units: units() }, diff, stage);
            changeHtml = '<div class="sp-changes">' +
                changeGroup('Bring on', 'on', lines.on) +
                changeGroup('Strike', 'off', lines.off) +
                changeGroup('Move', 'move', lines.move) + '</div>';
        }

        var curtainRows = (stage.curtains || []).map(function (c) {
            var state = sc.curtains[c.id] || c.state || 'closed';
            return '<div class="sp-field"><label>' + esc(c.name) + '</label>' +
                '<select data-act="set-curtain" data-id="' + esc(c.id) + '">' +
                ['closed', 'half', 'open'].map(function (opt) {
                    return '<option value="' + opt + '"' + (state === opt ? ' selected' : '') + '>' +
                        (opt === 'half' ? 'Half open' : opt.charAt(0).toUpperCase() + opt.slice(1)) + '</option>';
                }).join('') + '</select></div>';
        }).join('');

        host.innerHTML =
            '<div class="sp-section">' +
            '<h3>Scene ' + esc(numbers[sc.id].label) + '</h3>' +
            '<div class="sp-field"><label for="spSceneSub">Subtitle, time of day</label>' +
            '<input type="text" id="spSceneSub" data-bind="scene.subtitle" value="' + esc(sc.subtitle || '') +
            '" placeholder="Evening, the first frost"></div>' +
            '<div class="sp-field"><label for="spSceneAct">Act</label>' +
            '<select id="spSceneAct" data-bind="scene.actId">' +
            '<option value="">Not in an act</option>' +
            p.acts.map(function (a) {
                return '<option value="' + esc(a.id) + '"' + (sc.actId === a.id ? ' selected' : '') + '>' +
                    esc(a.name) + '</option>';
            }).join('') + '</select></div>' +
            '<div class="sp-field"><label for="spSceneLabel">Number shown on the sheet</label>' +
            '<input type="text" id="spSceneLabel" data-bind="scene.label" value="' + esc(sc.label || '') +
            '" placeholder="' + esc(numbers[sc.id].label) + ' (worked out automatically)"></div>' +
            '<div class="sp-field"><label for="spSceneNotes">Notes</label>' +
            '<textarea id="spSceneNotes" data-bind="scene.notes" placeholder="Tea things preset. Fire lit.">' +
            esc(sc.notes || '') + '</textarea></div>' +
            '</div>' +

            '<div class="sp-section"><h3>Changes from the scene before</h3>' + changeHtml + '</div>' +

            (curtainRows ? '<div class="sp-section"><h3>Curtains in this scene</h3>' + curtainRows + '</div>' : '') +

            '<div class="sp-section"><h3>Layout</h3><div class="sp-btn-row">' +
            '<button class="sp-btn" data-act="copy-layout">Copy from another scene…</button>' +
            '<button class="sp-btn" data-act="mirror-scene">Mirror across the centre</button>' +
            '<button class="sp-btn" data-act="save-preset">Save as preset</button>' +
            '<button class="sp-btn" data-act="apply-preset">Apply a preset…</button>' +
            '<button class="sp-btn" data-act="push-layout">Copy this layout to other scenes…</button>' +
            '<button class="sp-btn" data-act="export-png">Save this plan as a picture</button>' +
            '<button class="sp-btn is-danger" data-act="clear-scene">Clear the stage</button>' +
            '</div></div>' +

            '<div class="sp-section"><h3>Stage for this scene</h3>' +
            (sc.stage
                ? '<p class="sp-hint">This scene uses its own stage, set on the Stage tab while the scene is selected.</p>' +
                  '<div class="sp-btn-row"><button class="sp-btn" data-act="drop-scene-stage">Go back to the production stage</button></div>'
                : '<p class="sp-hint">Using the production stage: ' + esc(SP.shapeById(stage.shape).name) + '.</p>' +
                  '<div class="sp-btn-row"><button class="sp-btn" data-act="own-scene-stage">Give this scene its own stage</button></div>') +
            '</div>';
    }

    function changeGroup(title, kind, items) {
        if (!items.length) return '';
        return '<div class="sp-change-group"><h4><span class="sp-dot ' + kind + '"></span>' + esc(title) + '</h4>' +
            '<ul>' + items.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>';
    }

    /* ================================================================== *
     * Modals
     * ================================================================== */

    function openModal(config) {
        var backdrop = document.createElement('div');
        backdrop.className = 'sp-modal-backdrop';
        var actions = (config.actions || []).map(function (a, i) {
            return '<button class="sp-btn' + (a.primary ? ' is-primary' : '') + (a.danger ? ' is-danger' : '') +
                '" data-action-index="' + i + '">' + esc(a.label) + '</button>';
        }).join('');
        backdrop.innerHTML =
            '<div class="sp-modal" role="dialog" aria-modal="true">' +
            '<header><h2>' + esc(config.title) + '</h2></header>' +
            '<div class="sp-modal-body"></div>' +
            '<footer><button class="sp-btn" data-close="1">' + esc(config.cancelLabel || 'Cancel') + '</button>' +
            actions + '</footer></div>';

        var body = $('.sp-modal-body', backdrop);
        if (typeof config.body === 'string') body.innerHTML = config.body;
        else if (config.body) body.appendChild(config.body);

        function close() {
            document.removeEventListener('keydown', onKey, true);
            backdrop.remove();
        }
        function onKey(e) {
            if (e.key === 'Escape') { e.stopPropagation(); close(); }
        }

        backdrop.addEventListener('click', function (e) {
            if (e.target === backdrop || e.target.dataset.close) { close(); return; }
            // Shortcut buttons are run by the document-level handler; close up first
            // so the modal's own key listener goes with it.
            if (e.target.closest('[data-act]')) { close(); return; }
            var btn = e.target.closest('[data-action-index]');
            if (!btn) return;
            var action = config.actions[Number(btn.dataset.actionIndex)];
            if (action && action.onClick) {
                if (action.onClick(body, close) === false) return;
            }
            close();
        });

        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(backdrop);
        var first = $('input, select, textarea', body);
        if (first) first.focus();
        return { element: backdrop, body: body, close: close };
    }

    function sceneChecklist(exclude, checked) {
        var numbers = SP.sceneNumbers(production());
        return '<div class="sp-pick-list">' + scenes().filter(function (s) {
            return s.id !== exclude;
        }).map(function (s) {
            return '<label><input type="checkbox" value="' + esc(s.id) + '"' + (checked ? ' checked' : '') + '> ' +
                '<span class="sp-scene-no">' + esc(numbers[s.id].label) + '</span> ' +
                esc(s.title || 'Untitled scene') + '</label>';
        }).join('') + '</div>';
    }

    function checkedIds(body) {
        return $$('input[type="checkbox"]:checked', body).map(function (i) { return i.value; });
    }

    /* ================================================================== *
     * Editing actions
     * ================================================================== */

    function selectOnly(ids) {
        ui.selection = ids;
        if (ids.length) ui.inspector = 'item';
        renderCanvas(true);
        renderInspector();
    }

    function addProp(propId, x, y) {
        var prop = resolveProp(propId);
        var sc = scene();
        if (!prop || !sc) return;
        change(function () {
            var placement = SP.makePlacement(prop, snap(x), snap(y));
            sc.placements.push(placement);
            ui.selection = [placement.id];
            ui.inspector = 'item';
        });
    }

    function snap(value) {
        if (!ui.snap) return SP.round(value, 3);
        var step = SP.num((stageOf(scene()).grid || {}).spacing, 1) / 2;
        return SP.round(Math.round(value / step) * step, 3);
    }

    function addScene(after) {
        change(function () {
            var p = production();
            var index = after === undefined ? p.scenes.length : after + 1;
            var fresh = newScene('');
            var neighbour = p.scenes[index - 1];
            if (neighbour) fresh.actId = neighbour.actId;
            p.scenes.splice(index, 0, fresh);
            ui.sceneId = fresh.id;
            ui.selection = [];
        });
    }

    function duplicateScene(id) {
        change(function () {
            var p = production();
            var index = p.scenes.map(function (s) { return s.id; }).indexOf(id);
            if (index === -1) return;
            var source = p.scenes[index];
            var copy = JSON.parse(JSON.stringify(source));
            copy.id = SP.uid('sc');
            copy.title = source.title ? source.title + ' (copy)' : '';
            copy.placements = SP.copyPlacements(source.placements, true);
            p.scenes.splice(index + 1, 0, copy);
            ui.sceneId = copy.id;
        });
    }

    function deleteScene(id) {
        var p = production();
        var target = p.scenes.filter(function (s) { return s.id === id; })[0];
        if (!target) return;
        var proceed = !target.placements.length ||
            window.confirm('Delete “' + (target.title || 'this scene') + '” and its ' +
                target.placements.length + ' props?');
        if (!proceed) return;
        change(function () {
            var index = p.scenes.indexOf(target);
            p.scenes.splice(index, 1);
            if (ui.sceneId === id) ui.sceneId = (p.scenes[Math.max(0, index - 1)] || {}).id;
            ui.selection = [];
        });
    }

    function moveScene(id, targetIndex) {
        change(function () {
            var p = production();
            var from = p.scenes.map(function (s) { return s.id; }).indexOf(id);
            if (from === -1) return;
            var moved = p.scenes.splice(from, 1)[0];
            if (targetIndex > from) targetIndex -= 1;
            p.scenes.splice(Math.max(0, Math.min(p.scenes.length, targetIndex)), 0, moved);
            var neighbour = p.scenes[p.scenes.indexOf(moved) - 1];
            if (neighbour) moved.actId = neighbour.actId;
        });
    }

    function deleteSelection() {
        var sc = scene();
        if (!sc || !ui.selection.length) return;
        change(function () {
            sc.placements = sc.placements.filter(function (p) {
                return ui.selection.indexOf(p.id) === -1 || p.locked;
            });
            ui.selection = [];
        });
    }

    function duplicateSelection() {
        var sc = scene();
        var sel = selectedPlacements();
        if (!sel.length) return;
        change(function () {
            var offset = SP.num((stageOf(sc).grid || {}).spacing, 1) / 2;
            var copies = sel.map(function (p) {
                var copy = Object.assign({}, p);
                copy.id = SP.uid('pl');
                copy.trackId = SP.uid('trk');
                copy.x = SP.round(p.x + offset, 3);
                copy.y = SP.round(p.y + offset, 3);
                sc.placements.push(copy);
                return copy.id;
            });
            ui.selection = copies;
        });
    }

    function nudge(dx, dy) {
        var sel = selectedPlacements().filter(function (p) { return !p.locked; });
        if (!sel.length) return;
        change(function () {
            sel.forEach(function (p) {
                p.x = SP.round(p.x + dx, 3);
                p.y = SP.round(p.y + dy, 3);
            });
        });
    }

    function rotateSelection(delta) {
        var sel = selectedPlacements().filter(function (p) { return !p.locked; });
        if (!sel.length) return;
        change(function () {
            sel.forEach(function (p) { p.rot = SP.normaliseAngle((p.rot || 0) + delta); });
        });
    }

    function alignSelection(axis) {
        var sel = selectedPlacements().filter(function (p) { return !p.locked; });
        if (sel.length < 2) return;
        change(function () {
            var mean = sel.reduce(function (sum, p) { return sum + p[axis]; }, 0) / sel.length;
            sel.forEach(function (p) { p[axis] = SP.round(mean, 3); });
        });
    }

    function spreadSelection(axis) {
        var sel = selectedPlacements().filter(function (p) { return !p.locked; });
        if (sel.length < 3) return;
        change(function () {
            var sorted = sel.slice().sort(function (a, b) { return a[axis] - b[axis]; });
            var first = sorted[0][axis];
            var last = sorted[sorted.length - 1][axis];
            var step = (last - first) / (sorted.length - 1);
            sorted.forEach(function (p, i) { p[axis] = SP.round(first + step * i, 3); });
        });
    }

    function mirrorScene() {
        var sc = scene();
        if (!sc) return;
        change(function () {
            sc.placements = SP.mirrorPlacements(sc.placements, 'horizontal', stageOf(sc));
        });
    }

    function mirrorSelection() {
        var sc = scene();
        var sel = selectedPlacements();
        if (!sel.length) return;
        change(function () {
            var mirrored = SP.mirrorPlacements(sel, 'horizontal', stageOf(sc));
            mirrored.forEach(function (m, i) { Object.assign(sel[i], m); });
        });
    }

    function reorderSelection(direction) {
        var sc = scene();
        var sel = selectedPlacements();
        if (!sel.length) return;
        change(function () {
            sel.forEach(function (p) {
                var index = sc.placements.indexOf(p);
                var next = direction > 0 ? Math.min(sc.placements.length - 1, index + 1) : Math.max(0, index - 1);
                sc.placements.splice(index, 1);
                sc.placements.splice(next, 0, p);
            });
        });
    }

    function copyLayoutDialog() {
        var sc = scene();
        var numbers = SP.sceneNumbers(production());
        var others = scenes().filter(function (s) { return s.id !== sc.id; });
        if (!others.length) { toast('There is only one scene so far.'); return; }

        openModal({
            title: 'Copy a layout into this scene',
            body: '<div class="sp-field"><label for="spCopySource">Take the layout from</label>' +
                '<select id="spCopySource">' + others.map(function (s) {
                    return '<option value="' + esc(s.id) + '">' + esc(numbers[s.id].label) + ' · ' +
                        esc(s.title || 'Untitled scene') + ' (' + s.placements.length + ' props)</option>';
                }).join('') + '</select></div>' +
                '<div class="sp-field"><label for="spCopyMode">And</label>' +
                '<select id="spCopyMode">' +
                '<option value="replace">replace what is here</option>' +
                '<option value="merge">add to what is here</option></select></div>' +
                '<label class="sp-check"><input type="checkbox" id="spCopyMirror"> Mirror it across the centre line</label>' +
                '<p class="sp-hint">Props keep their identity, so the change list will say “moved” rather than ' +
                '“struck and brought back on”.</p>',
            actions: [{
                label: 'Copy the layout', primary: true,
                onClick: function (body) {
                    var source = scenes().filter(function (s) { return s.id === $('#spCopySource', body).value; })[0];
                    if (!source) return;
                    var mode = $('#spCopyMode', body).value;
                    var doMirror = $('#spCopyMirror', body).checked;
                    change(function () {
                        var copied = SP.copyPlacements(source.placements, true);
                        if (doMirror) copied = SP.mirrorPlacements(copied, 'horizontal', stageOf(sc));
                        sc.placements = mode === 'replace' ? copied : sc.placements.concat(copied);
                        ui.selection = [];
                    });
                }
            }]
        });
    }

    function pushLayoutDialog() {
        var sc = scene();
        if (scenes().length < 2) { toast('Add another scene first.'); return; }
        openModal({
            title: 'Copy this layout to other scenes',
            body: '<p class="sp-hint" style="margin-bottom:0.7rem">Useful for a set that comes back later in ' +
                'the evening. Tick the scenes that should look like this one.</p>' +
                sceneChecklist(sc.id, false) +
                '<div class="sp-field" style="margin-top:0.7rem"><label for="spPushMode">In those scenes</label>' +
                '<select id="spPushMode"><option value="replace">replace the layout</option>' +
                '<option value="merge">add these props to it</option></select></div>',
            actions: [{
                label: 'Copy it over', primary: true,
                onClick: function (body) {
                    var ids = checkedIds(body);
                    if (!ids.length) return false;
                    var mode = $('#spPushMode', body).value;
                    change(function () {
                        scenes().forEach(function (s) {
                            if (ids.indexOf(s.id) === -1) return;
                            var copied = SP.copyPlacements(sc.placements, true);
                            s.placements = mode === 'replace' ? copied : s.placements.concat(copied);
                        });
                    });
                    toast('Layout copied into ' + ids.length + ' scene' + (ids.length === 1 ? '' : 's') + '.', 'success');
                }
            }]
        });
    }

    function pushForwardDialog() {
        var sc = scene();
        var sel = selectedPlacements();
        if (!sel.length) return;
        var index = sceneIndex();
        var later = scenes().slice(index + 1);
        if (!later.length) { toast('This is the last scene.'); return; }
        var numbers = SP.sceneNumbers(production());

        openModal({
            title: 'Carry ' + (sel.length === 1 ? 'this prop' : 'these props') + ' into later scenes',
            body: '<p class="sp-hint" style="margin-bottom:0.7rem">The same prop, in the same spot. It keeps its ' +
                'identity, so it will not show up as struck and brought back.</p>' +
                '<div class="sp-pick-list">' + later.map(function (s) {
                    return '<label><input type="checkbox" value="' + esc(s.id) + '" checked> ' +
                        '<span class="sp-scene-no">' + esc(numbers[s.id].label) + '</span> ' +
                        esc(s.title || 'Untitled scene') + '</label>';
                }).join('') + '</div>',
            actions: [{
                label: 'Carry it over', primary: true,
                onClick: function (body) {
                    var ids = checkedIds(body);
                    if (!ids.length) return false;
                    change(function () {
                        scenes().forEach(function (s) {
                            if (ids.indexOf(s.id) === -1) return;
                            sel.forEach(function (p) {
                                var already = s.placements.some(function (q) { return q.trackId === p.trackId; });
                                if (already) return;
                                var copy = Object.assign({}, p);
                                copy.id = SP.uid('pl');
                                s.placements.push(copy);
                            });
                        });
                    });
                }
            }]
        });
    }

    function savePresetDialog() {
        var sc = scene();
        if (!sc || !sc.placements.length) { toast('There is nothing on the stage to save.'); return; }
        openModal({
            title: 'Save this layout as a preset',
            body: '<div class="sp-field"><label for="spPresetName">Name it</label>' +
                '<input type="text" id="spPresetName" value="' + esc(sc.title || 'Set') + '" ' +
                'placeholder="Drawing room, full set"></div>' +
                '<p class="sp-hint">Presets belong to this production and can be dropped into any scene.</p>',
            actions: [{
                label: 'Save the preset', primary: true,
                onClick: function (body) {
                    var name = $('#spPresetName', body).value.trim();
                    if (!name) return false;
                    change(function () {
                        production().presets.push({
                            id: SP.uid('pre'), name: name,
                            placements: SP.copyPlacements(sc.placements, false)
                        });
                    });
                    toast('Preset saved.', 'success');
                }
            }]
        });
    }

    function applyPresetDialog() {
        var p = production();
        var sc = scene();
        if (!p.presets.length) {
            toast('No presets yet. Arrange a scene and choose “Save as preset”.');
            return;
        }
        openModal({
            title: 'Presets',
            body: '<div class="sp-field"><label for="spPresetPick">Preset</label><select id="spPresetPick">' +
                p.presets.map(function (pre) {
                    return '<option value="' + esc(pre.id) + '">' + esc(pre.name) + ' (' +
                        pre.placements.length + ' props)</option>';
                }).join('') + '</select></div>' +
                '<div class="sp-field"><label for="spPresetMode">Apply it</label>' +
                '<select id="spPresetMode"><option value="replace">replacing this scene</option>' +
                '<option value="merge">on top of this scene</option></select></div>' +
                '<label class="sp-check"><input type="checkbox" id="spPresetMirror"> Mirror it</label>' +
                '<p class="sp-hint" style="margin-top:0.7rem">Also apply to other scenes:</p>' +
                sceneChecklist(sc.id, false),
            actions: [
                {
                    label: 'Delete this preset', danger: true,
                    onClick: function (body) {
                        var id = $('#spPresetPick', body).value;
                        change(function () {
                            p.presets = p.presets.filter(function (pre) { return pre.id !== id; });
                        });
                    }
                },
                {
                    label: 'Apply', primary: true,
                    onClick: function (body) {
                        var preset = p.presets.filter(function (pre) {
                            return pre.id === $('#spPresetPick', body).value;
                        })[0];
                        if (!preset) return false;
                        var mode = $('#spPresetMode', body).value;
                        var doMirror = $('#spPresetMirror', body).checked;
                        var targets = [sc.id].concat(checkedIds(body));
                        change(function () {
                            scenes().forEach(function (s) {
                                if (targets.indexOf(s.id) === -1) return;
                                var copied = SP.copyPlacements(preset.placements, false);
                                if (doMirror) copied = SP.mirrorPlacements(copied, 'horizontal', stageOf(s));
                                s.placements = mode === 'replace' ? copied : s.placements.concat(copied);
                            });
                            ui.selection = [];
                        });
                    }
                }
            ]
        });
    }

    function editActDialog(id) {
        var act = production().acts.filter(function (a) { return a.id === id; })[0];
        if (!act) return;
        openModal({
            title: 'Act',
            body: '<div class="sp-field"><label for="spActName">Name</label>' +
                '<input type="text" id="spActName" value="' + esc(act.name) + '"></div>' +
                '<div class="sp-field"><label for="spActNotes">Notes for the divider page</label>' +
                '<textarea id="spActNotes">' + esc(act.notes || '') + '</textarea></div>',
            actions: [
                {
                    label: 'Delete the act', danger: true,
                    onClick: function () {
                        change(function () {
                            var p = production();
                            p.acts = p.acts.filter(function (a) { return a.id !== id; });
                            p.scenes.forEach(function (s) { if (s.actId === id) s.actId = null; });
                        });
                    }
                },
                {
                    label: 'Save', primary: true,
                    onClick: function (body) {
                        change(function () {
                            act.name = $('#spActName', body).value.trim() || act.name;
                            act.notes = $('#spActNotes', body).value;
                        });
                    }
                }
            ]
        });
    }

    function addAct() {
        change(function () {
            var p = production();
            var act = { id: SP.uid('act'), name: 'Act ' + SP.roman(p.acts.length + 1), notes: '' };
            p.acts.push(act);
            var current = scene();
            if (current) {
                var from = p.scenes.indexOf(current);
                for (var i = from; i < p.scenes.length; i++) p.scenes[i].actId = act.id;
            }
        });
        toast('Act added. Every scene from here on belongs to it. Move a scene out again on the Scene panel.', 'success');
    }

    /* ================================================================== *
     * Stage tab
     * ================================================================== */

    var FIELD_LABELS = {
        width: 'Width, wall to wall',
        depth: 'Depth, back wall to setting line',
        backWidth: 'Width at the back',
        diameter: 'Diameter',
        sides: 'Number of sides',
        apronWidth: 'Apron width',
        apronDepth: 'Apron depth'
    };

    function editingStage() {
        var sc = scene();
        return (sc && sc.stage) || production().stage;
    }

    function editingStageIsScene() {
        var sc = scene();
        return !!(sc && sc.stage);
    }

    function renderStageTab() {
        var stage = editingStage();
        var isScene = editingStageIsScene();
        var numbers = SP.sceneNumbers(production());
        var sc = scene();

        $('#spStageHeading').textContent = isScene
            ? 'Stage for scene ' + numbers[sc.id].label
            : 'The stage';
        $('#spStageIntro').textContent = isScene
            ? 'This scene has been given a stage of its own. Every other scene keeps the production stage.'
            : 'Set the playing area once and every scene inherits it. A single scene can be given a stage of its own on the Scene panel if the set changes shape at the interval.';

        $('#spShapeGrid').innerHTML = SP.STAGE_SHAPES.map(function (shape) {
            var sample = Object.assign({}, SP.DEFAULT_STAGE, {
                shape: shape.id, width: 12, depth: 9, backWidth: 8, diameter: 10, sides: 6,
                apronWidth: 7, apronDepth: 2.5
            });
            var out = SP.stageOutline(sample);
            var b = out.bounds;
            var pad = Math.max(b.w, b.h) * 0.06;
            return '<button class="sp-shape-card" data-act="set-shape" data-shape="' + esc(shape.id) + '"' +
                ' aria-pressed="' + (stage.shape === shape.id ? 'true' : 'false') + '">' +
                '<svg viewBox="' + (b.x - pad) + ' ' + (b.y - pad) + ' ' + (b.w + pad * 2) + ' ' + (b.h + pad * 2) +
                '" preserveAspectRatio="xMidYMid meet"><path d="' + out.d + '"/></svg>' +
                '<strong style="font-weight:500">' + esc(shape.name) + '</strong><br>' +
                '<span style="color:var(--sp-muted); font-size:0.7rem">' + esc(shape.blurb) + '</span></button>';
        }).join('');

        $('#spStagePreview').innerHTML = SPPlan.svg({
            stage: stage,
            scene: sc || { placements: [] },
            resolve: resolveProp,
            units: units(),
            labels: 'none',
            idPrefix: 'stage-preview'
        });

        var shape = SP.shapeById(stage.shape);
        var dimensionFields = shape.fields.map(function (field) {
            var isCount = field === 'sides';
            var value = isCount ? SP.num(stage[field], 6) : toField(SP.num(stage[field], 1));
            return '<div><label for="spDim-' + field + '">' + esc(FIELD_LABELS[field] || field) +
                (isCount ? '' : ' (' + lengthLabel() + ')') + '</label>' +
                '<input type="number" id="spDim-' + field + '" data-stage-field="' + field + '"' +
                ' step="' + (isCount ? '1' : '0.1') + '" min="' + (isCount ? '3' : '0.5') + '"' +
                (isCount ? ' max="24"' : '') + ' value="' + value + '"></div>';
        }).join('');

        var curtains = (stage.curtains || []).map(function (c) {
            return '<div class="sp-curtain-row">' +
                '<input type="text" value="' + esc(c.name) + '" data-curtain="' + esc(c.id) + '" data-curtain-field="name" aria-label="Curtain name">' +
                '<input type="number" step="0.1" min="0" value="' + toField(SP.num(c.offset, 0)) +
                '" data-curtain="' + esc(c.id) + '" data-curtain-field="offset" aria-label="Distance upstage">' +
                '<select data-curtain="' + esc(c.id) + '" data-curtain-field="state" aria-label="Normally">' +
                ['closed', 'half', 'open'].map(function (opt) {
                    return '<option value="' + opt + '"' + ((c.state || 'closed') === opt ? ' selected' : '') + '>' +
                        (opt === 'half' ? 'Half open' : opt.charAt(0).toUpperCase() + opt.slice(1)) + '</option>';
                }).join('') + '</select>' +
                '<button class="sp-btn is-quiet is-danger" data-act="remove-curtain" data-id="' + esc(c.id) + '">&times;</button>' +
                '</div>';
        }).join('');

        $('#spStageSide').innerHTML =
            '<div class="sp-section"><h3>Measurements</h3>' +
            '<div class="' + (shape.fields.length > 2 ? 'sp-field-row' : 'sp-field-row') + '">' + dimensionFields + '</div>' +
            '<p class="sp-hint" style="margin-top:0.5rem">' +
            'The playing area comes out ' + esc(SP.formatLength(SP.stageOutline(stage).bounds.w, units())) +
            ' across by ' + esc(SP.formatLength(SP.stageOutline(stage).bounds.h, units())) + ' deep.</p></div>' +

            '<div class="sp-section"><h3>Grid</h3>' +
            '<label class="sp-check"><input type="checkbox" data-stage-flag="grid.show"' +
            (stage.grid.show ? ' checked' : '') + '> Draw a grid on the floor</label>' +
            '<label class="sp-check"><input type="checkbox" data-stage-flag="grid.labels"' +
            (stage.grid.labels ? ' checked' : '') + '> Letter and number the squares</label>' +
            '<div class="sp-field" style="margin-top:0.5rem"><label for="spGridSpacing">Squares are (' +
            lengthLabel() + ')</label><input type="number" id="spGridSpacing" step="0.25" min="0.25" ' +
            'data-stage-field="grid.spacing" value="' + toField(SP.num(stage.grid.spacing, 1)) + '"></div>' +
            '<p class="sp-hint">Lettered squares give the crew something to call out: “the trunk goes in C4”.</p></div>' +

            '<div class="sp-section"><h3>Guides</h3>' +
            '<label class="sp-check"><input type="checkbox" data-stage-flag="centreLine"' +
            (stage.centreLine ? ' checked' : '') + '> Centre line</label>' +
            '<label class="sp-check"><input type="checkbox" data-stage-flag="settingLine"' +
            (stage.settingLine ? ' checked' : '') + '> Setting line</label>' +
            '<label class="sp-check"><input type="checkbox" data-stage-flag="scaleBar"' +
            (stage.scaleBar ? ' checked' : '') + '> Scale bar</label></div>' +

            '<div class="sp-section"><h3>Curtains</h3>' +
            (curtains ? '<div style="margin-bottom:0.5rem"><div class="sp-curtain-row" style="font-size:0.7rem;color:var(--sp-muted)">' +
                '<span>Name</span><span>Upstage (' + lengthLabel() + ')</span><span>Normally</span><span></span></div>' +
                curtains + '</div>' : '<p class="sp-hint">No curtain marked.</p>') +
            '<div class="sp-btn-row"><button class="sp-btn" data-act="add-curtain">Add a curtain</button></div>' +
            '<p class="sp-hint" style="margin-top:0.5rem">Measured upstage from the setting line. Each scene can ' +
            'open or close them on its own.</p></div>' +

            '<div class="sp-section"><h3>This production</h3>' +
            '<div class="sp-field"><label for="spUnits">Measure in</label>' +
            '<select id="spUnits" data-bind="prod.units">' +
            '<option value="m"' + (units() === 'm' ? ' selected' : '') + '>Metres</option>' +
            '<option value="ft"' + (units() === 'ft' ? ' selected' : '') + '>Feet and inches</option></select></div>' +
            '<div class="sp-field"><label for="spNumbering">Number the scenes</label>' +
            '<select id="spNumbering" data-bind="prod.numbering">' +
            '<option value="continuous"' + (production().numbering === 'continuous' ? ' selected' : '') +
            '>Straight through, 1 to the end</option>' +
            '<option value="per-act"' + (production().numbering === 'per-act' ? ' selected' : '') +
            '>Restart in each act, as II.3</option></select></div>' +
            (isScene ? '<div class="sp-btn-row"><button class="sp-btn" data-act="drop-scene-stage">' +
                'Use the production stage for this scene</button></div>' : '') +
            '</div>';
    }

    /* ================================================================== *
     * Prop library tab
     * ================================================================== */

    function usageCount(propId) {
        var total = 0;
        db.productions.forEach(function (p) {
            (p.scenes || []).forEach(function (s) {
                (s.placements || []).forEach(function (pl) { if (pl.propId === propId) total += 1; });
            });
        });
        return total;
    }

    function renderLibraryTab() {
        var select = $('#spLibraryCategory');
        select.innerHTML = categoryOptions(ui.libraryCategory);
        select.value = ui.libraryCategory;
        $('#spLibrarySearch').value = ui.librarySearch;

        var list = allProps().filter(function (p) {
            return (ui.libraryCategory === 'all' || p.cat === ui.libraryCategory) &&
                matchesSearch(p, ui.librarySearch);
        });

        $('#spLibraryGrid').innerHTML = list.length ? list.map(function (prop) {
            var uses = usageCount(prop.id);
            var art = prop.image
                ? '<img src="' + esc(prop.image) + '" alt="">'
                : '<svg viewBox="0 0 100 100" class="sp-plan"><g class="sp-art" stroke-width="4">' + prop.art + '</g></svg>';
            return '<div class="sp-lib-card">' +
                (prop.builtin ? '' : '<span class="sp-lib-tools">' +
                    '<button class="sp-btn is-quiet" data-act="edit-prop" data-prop="' + esc(prop.id) + '">Edit</button>' +
                    '<button class="sp-btn is-quiet is-danger" data-act="delete-prop" data-prop="' + esc(prop.id) + '">&times;</button>' +
                    '</span>') +
                art +
                '<div>' + esc(prop.name) + '</div>' +
                '<div class="sp-lib-meta">' + toField(prop.w, 2) + ' × ' + toField(prop.h, 2) + ' ' + lengthLabel() +
                (prop.builtin ? '' : ' · <span class="sp-badge">yours</span>') + '</div>' +
                '<div class="sp-lib-meta">' + (uses ? 'used ' + uses + '×' : 'not used yet') + '</div>' +
                '</div>';
        }).join('') : '<p class="sp-empty">Nothing matches that search.</p>';

        var customCount = db.library.length;
        var bytes = storageBytes();
        $('#spLibrarySide').innerHTML =
            '<div class="sp-section"><h3>Your own props</h3>' +
            '<p class="sp-hint">' + (customCount
                ? customCount + ' drawing' + (customCount === 1 ? '' : 's') + ' added. They sit alongside the ' +
                  'built-in ones in every production in this browser.'
                : 'Nothing added yet. A PNG, JPEG or SVG works. It gets scaled down and kept in this browser.') +
            '</p><div class="sp-btn-row"><button class="sp-btn is-primary" data-act="add-custom-prop">Add a prop</button></div></div>' +

            '<div class="sp-section"><h3>Drawing your own</h3>' +
            '<p class="sp-hint">Plan views read best: draw the prop as if looking straight down at the stage, ' +
            'on a square canvas, with a transparent background. Give it the real footprint in the size fields ' +
            'and it will land on the plan at the right scale.</p></div>' +

            '<div class="sp-section"><h3>Storage</h3>' +
            '<p class="sp-hint">Everything you have made takes about ' + formatBytes(bytes) + '. ' +
            'Browsers usually stop somewhere around 5 MB, so keep custom drawings small and take a backup ' +
            'from time to time.</p>' +
            '<div class="sp-btn-row"><button class="sp-btn" data-act="export-json">Export a backup</button>' +
            '<button class="sp-btn" data-act="import-json">Restore from a backup</button></div></div>';
    }

    function storageBytes() {
        try { return (localStorage.getItem(STORE_KEY) || '').length; } catch (err) { return 0; }
    }

    function formatBytes(n) {
        if (n < 1024) return n + ' bytes';
        if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' kB';
        return (n / 1024 / 1024).toFixed(1) + ' MB';
    }

    /* Anything the user uploads is redrawn small before it is stored, so a
       photo dropped in by mistake cannot fill the whole storage quota. */
    function processImage(file, callback) {
        var reader = new FileReader();
        reader.onload = function () {
            var img = new Image();
            img.onload = function () {
                var max = 480;
                var scale = Math.min(1, max / Math.max(img.width || max, img.height || max));
                var w = Math.max(1, Math.round((img.width || max) * scale));
                var h = Math.max(1, Math.round((img.height || max) * scale));
                var canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                var webp = canvas.toDataURL('image/webp', 0.9);
                callback(webp.indexOf('data:image/webp') === 0 ? webp : canvas.toDataURL('image/png'), w, h);
            };
            img.onerror = function () { callback(null); };
            img.src = reader.result;
        };
        reader.onerror = function () { callback(null); };
        reader.readAsDataURL(file);
    }

    function customPropDialog(existing) {
        var draft = existing ? Object.assign({}, existing) : {
            id: SP.uid('prop'), name: '', cat: 'Objects', w: 1, h: 1, image: null, tags: ''
        };
        var cats = SPProps.CATEGORIES;

        var modal = openModal({
            title: existing ? 'Edit prop' : 'Add a prop of your own',
            body: '<div class="sp-field"><label for="spPropName">Name</label>' +
                '<input type="text" id="spPropName" value="' + esc(draft.name) + '" placeholder="Grandfather clock"></div>' +
                '<div class="sp-field"><label for="spPropCat">Category</label><select id="spPropCat">' +
                cats.map(function (c) {
                    return '<option value="' + esc(c) + '"' + (draft.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>';
                }).join('') + '</select></div>' +
                '<div class="sp-field-row">' +
                '<div><label for="spPropW">Across (' + lengthLabel() + ')</label>' +
                '<input type="number" id="spPropW" step="0.05" min="0.05" value="' + toField(draft.w) + '"></div>' +
                '<div><label for="spPropH">Deep (' + lengthLabel() + ')</label>' +
                '<input type="number" id="spPropH" step="0.05" min="0.05" value="' + toField(draft.h) + '"></div>' +
                '</div>' +
                '<div class="sp-field"><label for="spPropFile">Drawing (PNG, JPEG or SVG)</label>' +
                '<input type="file" id="spPropFile" accept="image/png,image/jpeg,image/svg+xml,image/webp"></div>' +
                '<div id="spPropPreview" style="text-align:center;min-height:90px;border:1px solid var(--sp-line);' +
                'border-radius:3px;padding:0.5rem;background:var(--sp-field)">' +
                (draft.image ? '<img src="' + esc(draft.image) + '" style="max-height:90px">' :
                    '<span class="sp-hint">No drawing chosen yet</span>') + '</div>' +
                '<p class="sp-hint" style="margin-top:0.6rem">Pictures are scaled down to 480 pixels and stored ' +
                'in this browser. A transparent background keeps the plan readable.</p>',
            actions: [{
                label: existing ? 'Save' : 'Add it', primary: true,
                onClick: function (body) {
                    var name = $('#spPropName', body).value.trim();
                    if (!name) { toast('Give the prop a name.'); return false; }
                    if (!draft.image) { toast('Choose a drawing first.'); return false; }
                    draft.name = name;
                    draft.cat = $('#spPropCat', body).value;
                    draft.w = Math.max(0.05, fromField($('#spPropW', body).value, 1));
                    draft.h = Math.max(0.05, fromField($('#spPropH', body).value, 1));
                    change(function () {
                        if (existing) {
                            Object.assign(existing, draft);
                        } else {
                            db.library.push(draft);
                        }
                    });
                }
            }]
        });

        $('#spPropFile', modal.body).addEventListener('change', function (e) {
            var file = e.target.files && e.target.files[0];
            if (!file) return;
            processImage(file, function (dataUrl) {
                if (!dataUrl) { toast('That file could not be read as a picture.', 'error'); return; }
                draft.image = dataUrl;
                $('#spPropPreview', modal.body).innerHTML = '<img src="' + esc(dataUrl) + '" style="max-height:90px">';
            });
        });
    }

    function deleteCustomProp(id) {
        var uses = usageCount(id);
        var message = uses
            ? 'This prop is used ' + uses + ' time' + (uses === 1 ? '' : 's') +
              '. Deleting it leaves those places empty. Carry on?'
            : 'Delete this prop?';
        if (!window.confirm(message)) return;
        change(function () {
            db.library = db.library.filter(function (p) { return p.id !== id; });
            db.productions.forEach(function (p) {
                (p.scenes || []).forEach(function (s) {
                    s.placements = s.placements.filter(function (pl) { return pl.propId !== id; });
                });
            });
        });
    }

    /* ================================================================== *
     * Print tab
     * ================================================================== */

    function printOptions() {
        var p = production();
        if (!p.print) p.print = SPSheets.options({});
        return p.print;
    }

    function updatePrint(patch) {
        Object.assign(printOptions(), patch);
        persist();
        renderPrintTab();
    }

    function renderPrintTab() {
        var o = printOptions();
        var p = production();

        $('#spPrintOptions').innerHTML =
            '<div class="sp-section" style="padding-left:0;padding-right:0">' +
            '<h2 style="margin-bottom:0.3rem">Print</h2>' +
            '<p class="sp-hint">A4 sheets, straight from the browser. Choose “Save as PDF” in the print ' +
            'dialogue if you would rather send a file than carry paper.</p></div>' +

            '<div class="sp-section" style="padding-left:0;padding-right:0"><h3>Paper</h3>' +
            '<div class="sp-field"><select data-print="orientation">' +
            '<option value="portrait"' + (o.orientation === 'portrait' ? ' selected' : '') + '>A4 upright</option>' +
            '<option value="landscape"' + (o.orientation === 'landscape' ? ' selected' : '') + '>A4 on its side</option>' +
            '</select></div>' +
            (p.acts.length ? '<div class="sp-field"><label>Which scenes</label>' +
                '<select data-print="scope"><option value="all"' + (o.scope === 'all' ? ' selected' : '') +
                '>The whole production</option>' + p.acts.map(function (a) {
                    return '<option value="' + esc(a.id) + '"' + (o.scope === a.id ? ' selected' : '') + '>' +
                        esc(a.name) + ' only</option>';
                }).join('') + '</select></div>' : '') +
            '<div class="sp-field"><label for="spPrintFooter">Footer line</label>' +
            '<input type="text" id="spPrintFooter" data-print="footer" value="' + esc(o.footer || '') +
            '" placeholder="Draft 3, please recycle"></div></div>' +

            '<div class="sp-section" style="padding-left:0;padding-right:0"><h3>Sheets to print</h3>' +
            printCheck('cover', 'Title sheet', o) +
            printCheck('actPages', 'A divider before each act', o) +
            printCheck('scenePages', 'One full sheet per scene', o) +
            printCheck('overview', 'Overview sheets', o) +
            printCheck('runSheet', 'Change-over list', o) +
            printCheck('inventory', 'Prop inventory', o) +
            '</div>' +

            '<div class="sp-section" style="padding-left:0;padding-right:0"><h3>Scene sheets</h3>' +
            '<div class="sp-field"><label for="spPrintLabels">Labels on the plan</label>' +
            '<select id="spPrintLabels" data-print="labels">' +
            [['name', 'Prop names'], ['custom', 'Written labels only'], ['both', 'Name and label'],
             ['number', 'Numbers keyed to the list'], ['none', 'No labels']].map(function (opt) {
                return '<option value="' + opt[0] + '"' + (o.labels === opt[0] ? ' selected' : '') + '>' +
                    opt[1] + '</option>';
            }).join('') + '</select></div>' +
            printCheck('showGrid', 'Show the floor grid', o) +
            printCheck('showPropList', 'List what is on stage', o) +
            printCheck('showChanges', 'List the changes from the scene before', o) +
            printCheck('showGhosts', 'Ghost in the previous positions', o) +
            printCheck('showNotes', 'Include scene notes', o) +
            '</div>' +

            '<div class="sp-section" style="padding-left:0;padding-right:0"><h3>Overview sheets</h3>' +
            '<div class="sp-field"><label for="spOverviewSize">Scenes to a sheet</label>' +
            '<select id="spOverviewSize" data-act="overview-size">' +
            [[2, 2], [3, 2], [3, 3], [4, 3], [4, 4], [5, 5], [6, 4]].map(function (g) {
                var value = g[0] + 'x' + g[1];
                return '<option value="' + value + '"' +
                    (o.overviewCols === g[0] && o.overviewRows === g[1] ? ' selected' : '') + '>' +
                    g[0] + ' by ' + g[1] + ', ' + (g[0] * g[1]) + ' scenes</option>';
            }).join('') +
            '<option value="custom"' + (isCustomGrid(o) ? ' selected' : '') + '>Something else</option>' +
            '</select></div>' +
            (isCustomGrid(o) ? '<div class="sp-field-row">' +
                '<div><label for="spOvCols">Across</label><input type="number" id="spOvCols" min="1" max="8" ' +
                'data-print-number="overviewCols" value="' + o.overviewCols + '"></div>' +
                '<div><label for="spOvRows">Down</label><input type="number" id="spOvRows" min="1" max="8" ' +
                'data-print-number="overviewRows" value="' + o.overviewRows + '"></div></div>' : '') +
            printCheck('overviewSplitActs', 'Start a fresh sheet for each act', o) +
            '<p class="sp-hint">Twenty-five scenes on a 5 by 5 sheet gives the crew the whole evening at a glance.</p>' +
            '</div>' +

            '<div class="sp-section" style="padding-left:0;padding-right:0">' +
            '<div class="sp-btn-row"><button class="sp-btn is-primary" data-act="do-print">Print or save as PDF</button></div>' +
            '<p class="sp-page-count" id="spPageCount" style="margin-top:0.5rem"></p>' +
            '<p class="sp-hint">In the print dialogue, set margins to none and turn on background graphics ' +
            'so the plans come out exactly as they look here.</p></div>';

        renderPrintPreview();
    }

    function isCustomGrid(o) {
        var known = ['2x2', '3x2', '3x3', '4x3', '4x4', '5x5', '6x4'];
        return known.indexOf(o.overviewCols + 'x' + o.overviewRows) === -1;
    }

    function printCheck(key, label, o) {
        return '<label class="sp-check"><input type="checkbox" data-print-flag="' + key + '"' +
            (o[key] ? ' checked' : '') + '> ' + esc(label) + '</label>';
    }

    function buildSheets() {
        return SPSheets.build({
            production: production(),
            resolve: resolveProp,
            units: units(),
            options: printOptions()
        });
    }

    var previewTimer = null;
    function renderPrintPreview() {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(function () {
            var host = $('#spPrintPreview');
            var o = printOptions();
            var sheets = buildSheets();
            var count = $('#spPageCount');
            if (count) {
                count.textContent = sheets.length + ' sheet' + (sheets.length === 1 ? '' : 's') +
                    ' of A4' + (sheets.length > 40 ? ', which is a thick pile' : '');
            }
            if (!sheets.length) {
                host.innerHTML = '<p class="sp-empty">Nothing selected to print.</p>';
                return;
            }
            var landscape = o.orientation === 'landscape';
            var sheetWidth = (landscape ? 297 : 210) * MM;
            var available = host.clientWidth || 700;
            var k = Math.min(1, Math.max(0.18, (available - 48) / sheetWidth));
            host.innerHTML = '<div class="sp-sheets is-preview' + (landscape ? ' is-landscape-preview' : '') +
                '" style="--k:' + k.toFixed(4) + '">' +
                sheets.map(function (html) {
                    return '<div class="sp-preview-slot">' + html + '</div>';
                }).join('') + '</div>';
        }, 120);
    }

    function doPrint() {
        var portal = $('#spPrintPortal');
        var o = printOptions();
        var style = document.getElementById('spPageStyle');
        if (!style) {
            style = document.createElement('style');
            style.id = 'spPageStyle';
            document.head.appendChild(style);
        }
        style.textContent = '@page { size: A4 ' + (o.orientation === 'landscape' ? 'landscape' : 'portrait') +
            '; margin: 0; }';

        portal.innerHTML = '<div class="sp-sheets">' + buildSheets().join('') + '</div>';
        portal.hidden = false;
        window.setTimeout(function () {
            window.print();
            window.setTimeout(function () {
                portal.hidden = true;
                portal.innerHTML = '';
            }, 800);
        }, 60);
    }

    /* ------------------------------------------- one scene, as a picture */

    var EXPORT_CSS =
        'svg{font-family:"Helvetica Neue",Arial,sans-serif;color:#16130f;background:#fff}' +
        'g,path,rect,circle,ellipse,line,polygon{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round}' +
        'text{fill:currentColor;stroke:none}' +
        '.sp-grid path{stroke:rgba(0,0,0,.16)}.sp-grid-label text{fill:rgba(0,0,0,.4)}' +
        '.sp-stage{fill:rgba(0,0,0,.02)}.sp-guide{stroke:rgba(0,0,0,.42)}.sp-guide-label{fill:rgba(0,0,0,.45)}' +
        '.sp-curtain path{stroke:#6d6459}.sp-curtain-label{fill:#6d6459}' +
        '.sp-audience{stroke:rgba(0,0,0,.42)}.sp-audience text{fill:rgba(0,0,0,.5)}' +
        '.sp-art .f{fill:rgba(0,0,0,.06)}.sp-art .d{stroke-dasharray:3.5 3}' +
        '.sp-item-label{fill:#16130f;stroke:#fff;stroke-width:.055;paint-order:stroke}' +
        '.sp-item-ghost{opacity:.4}.sp-move-arrow{stroke:#6d6459}' +
        '.sp-scale-dark{fill:#16130f;stroke:#16130f}.sp-scale-light{fill:#fff;stroke:#16130f}' +
        '.sp-scale text{fill:rgba(0,0,0,.55)}';

    function exportScenePng() {
        var sc = scene();
        if (!sc) return;
        var plan = SPPlan.build(planSettings(sc, { interactive: false, selected: [] }));
        var parts = plan.viewBox.split(' ').map(Number);
        var width = 2000;
        var height = Math.round(width * parts[3] / parts[2]);
        var markup = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + plan.viewBox +
            '" width="' + width + '" height="' + height + '"><style>' + EXPORT_CSS + '</style>' +
            '<rect x="' + parts[0] + '" y="' + parts[1] + '" width="' + parts[2] + '" height="' + parts[3] +
            '" fill="#ffffff" stroke="none"/>' + plan.inner + '</svg>';

        var img = new Image();
        img.onload = function () {
            var canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(function (blob) {
                downloadBlob(blob, fileStem() + '.png');
            }, 'image/png');
        };
        img.onerror = function () { toast('The picture could not be made.', 'error'); };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
    }

    function fileStem() {
        var sc = scene();
        var numbers = SP.sceneNumbers(production());
        var bits = [production().name, sc ? numbers[sc.id].label : '', sc ? sc.title : ''];
        return bits.filter(Boolean).join(' ').replace(/[^\w\d\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'stage-plan';
    }

    function downloadBlob(blob, name) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    /* ================================================================== *
     * Productions, backup and restore
     * ================================================================== */

    function productionDialog() {
        var p = production();
        openModal({
            title: 'Production',
            body: '<div class="sp-field"><label for="spProdName">Name</label>' +
                '<input type="text" id="spProdName" value="' + esc(p.name) + '"></div>' +
                '<div class="sp-field"><label for="spProdSub">Subtitle</label>' +
                '<input type="text" id="spProdSub" value="' + esc(p.subtitle || '') +
                '" placeholder="A play in two acts"></div>' +
                '<div class="sp-field"><label for="spProdVenue">Venue</label>' +
                '<input type="text" id="spProdVenue" value="' + esc(p.venue || '') + '"></div>' +
                '<div class="sp-field"><label for="spProdNotes">Notes for the title sheet</label>' +
                '<textarea id="spProdNotes">' + esc(p.notes || '') + '</textarea></div>' +
                '<div class="sp-btn-row" style="margin-top:1rem">' +
                '<button class="sp-btn" data-act="new-production">Start another production</button>' +
                '<button class="sp-btn" data-act="duplicate-production">Duplicate this one</button>' +
                '<button class="sp-btn" data-act="load-example">Open the example</button>' +
                '<button class="sp-btn" data-act="export-json">Export a backup</button>' +
                '<button class="sp-btn" data-act="import-json">Restore a backup</button>' +
                (db.productions.length > 1
                    ? '<button class="sp-btn is-danger" data-act="delete-production">Delete this production</button>' : '') +
                '</div>',
            actions: [{
                label: 'Save', primary: true,
                onClick: function (body) {
                    change(function () {
                        p.name = $('#spProdName', body).value.trim() || 'Untitled production';
                        p.subtitle = $('#spProdSub', body).value;
                        p.venue = $('#spProdVenue', body).value;
                        p.notes = $('#spProdNotes', body).value;
                    });
                }
            }]
        });
    }

    function addProduction(source) {
        change(function () {
            var fresh = source
                ? Object.assign(JSON.parse(JSON.stringify(source)), { id: SP.uid('prod'), name: source.name + ' (copy)' })
                : newProduction('Untitled production');
            if (source) {
                fresh.scenes.forEach(function (s) {
                    s.id = SP.uid('sc');
                    s.placements.forEach(function (pl) { pl.id = SP.uid('pl'); });
                });
            }
            db.productions.push(fresh);
            db.activeId = fresh.id;
            ui.sceneId = (fresh.scenes[0] || {}).id;
            ui.selection = [];
            ui.view = null;
        });
    }

    function deleteProduction() {
        if (db.productions.length < 2) return;
        var p = production();
        if (!window.confirm('Delete “' + p.name + '” with its ' + p.scenes.length + ' scenes?')) return;
        change(function () {
            db.productions = db.productions.filter(function (x) { return x.id !== p.id; });
            db.activeId = db.productions[0].id;
            ui.sceneId = (db.productions[0].scenes[0] || {}).id;
            ui.selection = [];
            ui.view = null;
        });
    }

    function loadExample() {
        change(function () {
            var example = buildExample();
            db.productions.push(example);
            db.activeId = example.id;
            ui.sceneId = example.scenes[0].id;
            ui.selection = [];
            ui.view = null;
        });
        toast('Example production opened. Delete it whenever you like.', 'success');
    }

    function exportJson() {
        var payload = JSON.stringify({
            kind: 'linu.li/scene-planner',
            version: 1,
            exported: new Date().toISOString(),
            data: db
        }, null, 2);
        var name = (production().name || 'scene-plan').replace(/[^\w\d\- ]+/g, '').replace(/\s+/g, '-').toLowerCase();
        downloadBlob(new Blob([payload], { type: 'application/json' }), name + '-scene-plan.json');
        toast('Backup saved to your downloads.', 'success');
    }

    function importJson() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.addEventListener('change', function () {
            var file = input.files && input.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function () {
                var parsed;
                try {
                    parsed = JSON.parse(reader.result);
                } catch (err) {
                    toast('That file is not a scene plan.', 'error');
                    return;
                }
                var incoming = parsed && parsed.data ? parsed.data : parsed;
                if (!incoming || !Array.isArray(incoming.productions)) {
                    toast('That file is not a scene plan.', 'error');
                    return;
                }
                var mode = window.confirm(
                    'Add ' + incoming.productions.length + ' production' +
                    (incoming.productions.length === 1 ? '' : 's') + ' from the backup?\n\n' +
                    'OK adds them alongside what you have. Cancel replaces everything.');
                change(function () {
                    incoming.productions.forEach(migrateProduction);
                    if (mode) {
                        incoming.productions.forEach(function (p) {
                            if (db.productions.some(function (x) { return x.id === p.id; })) p.id = SP.uid('prod');
                            db.productions.push(p);
                        });
                        (incoming.library || []).forEach(function (prop) {
                            if (!libraryById(prop.id)) db.library.push(prop);
                        });
                        db.activeId = incoming.productions[0].id;
                    } else {
                        db.productions = incoming.productions;
                        db.library = incoming.library || [];
                        db.activeId = incoming.activeId && incoming.productions.some(function (p) {
                            return p.id === incoming.activeId;
                        }) ? incoming.activeId : incoming.productions[0].id;
                    }
                    ui.sceneId = (scenes()[0] || {}).id;
                    ui.selection = [];
                    ui.view = null;
                });
                toast('Backup restored.', 'success');
            };
            reader.readAsText(file);
        });
        input.click();
    }

    /* ================================================================== *
     * The canvas: pointing, dragging, zooming
     * ================================================================== */

    var drag = null;
    var spaceHeld = false;

    function stagePoint(evt) {
        var svg = $('#spCanvas');
        var matrix = svg.getScreenCTM();
        if (!matrix) return { x: 0, y: 0 };
        var point = svg.createSVGPoint();
        point.x = evt.clientX;
        point.y = evt.clientY;
        var local = point.matrixTransform(matrix.inverse());
        return { x: local.x, y: local.y };
    }

    function pixelsToUnits(px) {
        var matrix = $('#spCanvas').getScreenCTM();
        return matrix && matrix.a ? px / matrix.a : px;
    }

    function itemNode(id) {
        return $('#spCanvas .sp-items .sp-item[data-id="' + id + '"]');
    }

    function setNodeTransform(node, p) {
        if (node) node.setAttribute('transform', 'translate(' + SP.round(p.x, 3) + ' ' + SP.round(p.y, 3) +
            ') rotate(' + SP.round(p.rot || 0, 2) + ')');
    }

    function onCanvasPointerDown(e) {
        if (e.button === 2) return;
        var svg = $('#spCanvas');
        var sc = scene();
        if (!sc) return;

        if (e.button === 1 || spaceHeld) {
            drag = { mode: 'pan', lastX: e.clientX, lastY: e.clientY };
            $('#spStageHost').classList.add('is-panning');
            svg.setPointerCapture(e.pointerId);
            e.preventDefault();
            return;
        }

        var handle = e.target.closest ? e.target.closest('[data-handle]') : null;
        var item = e.target.closest ? e.target.closest('.sp-item[data-id]') : null;
        var point = stagePoint(e);

        if (handle && ui.selection.length === 1) {
            var target = selectedPlacements()[0];
            if (!target || target.locked) return;
            drag = {
                mode: handle.dataset.handle,
                id: target.id,
                origin: Object.assign({}, target),
                start: point
            };
            svg.setPointerCapture(e.pointerId);
            e.preventDefault();
            return;
        }

        if (item) {
            var id = item.dataset.id;
            if (e.shiftKey) {
                var at = ui.selection.indexOf(id);
                if (at === -1) ui.selection = ui.selection.concat([id]);
                else ui.selection = ui.selection.filter(function (x) { return x !== id; });
                ui.inspector = 'item';
                renderCanvas(true);
                renderInspector();
                return;
            }
            if (ui.selection.indexOf(id) === -1) {
                ui.selection = [id];
                ui.inspector = 'item';
                renderCanvas(true);
                renderInspector();
            }
            var moving = selectedPlacements().filter(function (p) { return !p.locked; });
            if (!moving.length) return;
            drag = {
                mode: 'move',
                start: point,
                items: moving.map(function (p) { return { ref: p, x: p.x, y: p.y }; })
            };
            svg.setPointerCapture(e.pointerId);
            e.preventDefault();
            return;
        }

        drag = { mode: 'marquee', start: point, current: point, additive: e.shiftKey };
        if (!e.shiftKey && ui.selection.length) {
            ui.selection = [];
            renderCanvas(true);
            renderInspector();
        }
        svg.setPointerCapture(e.pointerId);
    }

    function onCanvasPointerMove(e) {
        var readout = $('#spPointerReadout');
        var sc = scene();
        if (!sc) return;

        if (!drag) {
            var here = stagePoint(e);
            var stage = stageOf(sc);
            var ref = stage.grid && stage.grid.labels
                ? SP.gridReference(stage, here.x, here.y, SP.num(stage.grid.spacing, 1)) + ' · ' : '';
            readout.textContent = ref + SP.describePosition(stage, here.x, here.y, units());
            return;
        }

        if (drag.mode === 'pan') {
            var dx = pixelsToUnits(e.clientX - drag.lastX);
            var dy = pixelsToUnits(e.clientY - drag.lastY);
            drag.lastX = e.clientX;
            drag.lastY = e.clientY;
            ui.view.x -= dx;
            ui.view.y -= dy;
            applyView();
            return;
        }

        var point = stagePoint(e);

        if (drag.mode === 'move') {
            var lead = drag.items[0];
            var rawX = lead.x + (point.x - drag.start.x);
            var rawY = lead.y + (point.y - drag.start.y);
            var snapped = e.altKey ? { x: SP.round(rawX, 3), y: SP.round(rawY, 3) } : { x: snap(rawX), y: snap(rawY) };
            var shiftX = snapped.x - lead.x;
            var shiftY = snapped.y - lead.y;
            drag.items.forEach(function (entry) {
                entry.ref.x = SP.round(entry.x + shiftX, 3);
                entry.ref.y = SP.round(entry.y + shiftY, 3);
                setNodeTransform(itemNode(entry.ref.id), entry.ref);
            });
            renderOverlay();
            $('#spPointerReadout').textContent = SP.describePosition(stageOf(sc), lead.ref.x, lead.ref.y, units());
            return;
        }

        if (drag.mode === 'rotate') {
            var target = findPlacement(drag.id);
            if (!target) return;
            var angle = Math.atan2(point.y - target.y, point.x - target.x) * 180 / Math.PI + 90;
            if (!e.altKey) angle = Math.round(angle / 15) * 15;
            target.rot = SP.normaliseAngle(angle);
            setNodeTransform(itemNode(target.id), target);
            renderOverlay();
            $('#spPointerReadout').textContent = 'Turned ' + Math.round(target.rot) + '°';
            return;
        }

        if (drag.mode === 'scale') {
            var item = findPlacement(drag.id);
            if (!item) return;
            var a = -(drag.origin.rot || 0) * Math.PI / 180;
            var dxw = point.x - item.x;
            var dyw = point.y - item.y;
            var localX = Math.abs(dxw * Math.cos(a) - dyw * Math.sin(a));
            var localY = Math.abs(dxw * Math.sin(a) + dyw * Math.cos(a));
            var w = Math.max(0.05, localX * 2);
            var h = Math.max(0.05, localY * 2);
            if (!e.altKey) {
                var factor = Math.max(w / drag.origin.w, h / drag.origin.h);
                w = drag.origin.w * factor;
                h = drag.origin.h * factor;
            }
            item.w = SP.round(w, 3);
            item.h = SP.round(h, 3);
            redrawItem(item);
            renderOverlay();
            $('#spPointerReadout').textContent = SP.formatLength(item.w, units()) + ' × ' +
                SP.formatLength(item.h, units());
            return;
        }

        if (drag.mode === 'marquee') {
            drag.current = point;
            drawMarquee();
        }
    }

    /* Re-draws one prop in place, which is cheaper than rebuilding the plan
       while a corner handle is being dragged. */
    function redrawItem(placement) {
        var node = itemNode(placement.id);
        if (!node) return;
        var prop = resolveProp(placement.propId);
        if (!prop) return;
        var plan = canvasPlan || { unit: 0.02 };
        var sx = (placement.flip ? -1 : 1) * placement.w / 100;
        var sy = placement.h / 100;
        var art = $('.sp-art', node);
        if (art) {
            art.setAttribute('transform', 'scale(' + SP.round(sx, 5) + ' ' + SP.round(sy, 5) + ') translate(-50 -50)');
            art.setAttribute('stroke-width', SP.round(plan.unit / ((placement.w + placement.h) / 200), 5));
        }
        var hit = $('.sp-hit', node);
        if (hit) {
            hit.setAttribute('x', SP.round(-placement.w / 2, 3));
            hit.setAttribute('y', SP.round(-placement.h / 2, 3));
            hit.setAttribute('width', SP.round(placement.w, 3));
            hit.setAttribute('height', SP.round(placement.h, 3));
        }
    }

    function drawMarquee() {
        var layer = $('#spOverlay');
        if (!layer || !drag) return;
        var x0 = Math.min(drag.start.x, drag.current.x);
        var y0 = Math.min(drag.start.y, drag.current.y);
        var w = Math.abs(drag.current.x - drag.start.x);
        var h = Math.abs(drag.current.y - drag.start.y);
        layer.innerHTML = '<rect class="sp-marquee" x="' + x0 + '" y="' + y0 + '" width="' + w +
            '" height="' + h + '" stroke-width="' + (ui.view.w / 480) + '"/>';
    }

    function onCanvasPointerUp(e) {
        var host = $('#spStageHost');
        host.classList.remove('is-panning');
        if (!drag) return;

        if (drag.mode === 'pan') { drag = null; return; }

        if (drag.mode === 'marquee') {
            var x0 = Math.min(drag.start.x, drag.current.x);
            var y0 = Math.min(drag.start.y, drag.current.y);
            var x1 = Math.max(drag.start.x, drag.current.x);
            var y1 = Math.max(drag.start.y, drag.current.y);
            var hits = [];
            if (Math.abs(x1 - x0) > 0.03 || Math.abs(y1 - y0) > 0.03) {
                (scene().placements || []).forEach(function (p) {
                    if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) hits.push(p.id);
                });
            }
            ui.selection = drag.additive ? ui.selection.concat(hits) : hits;
            drag = null;
            if (ui.selection.length) ui.inspector = 'item';
            renderCanvas(true);
            renderInspector();
            return;
        }

        // The model was edited live; record one history step for the gesture.
        var moved = drag.mode;
        drag = null;
        pushHistory(pendingDragState || snapshot());
        pendingDragState = null;
        persist();
        renderCanvas(true);
        renderInspector();
        renderSceneList();
        void moved;
    }

    var pendingDragState = null;

    function onCanvasWheel(e) {
        if (!ui.view) return;
        e.preventDefault();
        var factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
        var point = stagePoint(e);
        ui.view.x = point.x - (point.x - ui.view.x) * factor;
        ui.view.y = point.y - (point.y - ui.view.y) * factor;
        ui.view.w *= factor;
        ui.view.h *= factor;
        applyView();
        renderOverlay();
    }

    function zoomBy(factor) {
        if (!ui.view) return;
        var cx = ui.view.x + ui.view.w / 2;
        var cy = ui.view.y + ui.view.h / 2;
        ui.view.w *= factor;
        ui.view.h *= factor;
        ui.view.x = cx - ui.view.w / 2;
        ui.view.y = cy - ui.view.h / 2;
        applyView();
        renderOverlay();
    }

    function fitView() {
        var sc = scene();
        if (!sc) return;
        ui.view = Object.assign({}, SPPlan.build(planSettings(sc)).view);
        applyView();
        renderOverlay();
    }

    /* ================================================================== *
     * Wiring
     * ================================================================== */

    function setTab(tab) {
        ui.tab = tab;
        persistUi();
        render();
    }

    function setInspector(name) {
        ui.inspector = name;
        persistUi();
        renderInspector();
    }

    function handleAction(action, data, event) {
        switch (action) {
        case 'pick-scene':
            ui.sceneId = data.id;
            ui.selection = [];
            renderSceneList();
            renderCanvas(true);
            renderInspector();
            if (ui.tab === 'stage') renderStageTab();
            break;
        case 'add-scene': addScene(sceneIndex()); break;
        case 'add-act': addAct(); break;
        case 'edit-act': editActDialog(data.id); break;
        case 'duplicate-scene': duplicateScene(data.id); break;
        case 'delete-scene': deleteScene(data.id); break;
        case 'load-example': loadExample(); break;
        case 'add-prop':
            if (ui.view) addProp(data.prop, ui.view.x + ui.view.w / 2, ui.view.y + ui.view.h / 2);
            break;
        case 'align': alignSelection(data.axis); break;
        case 'spread': spreadSelection(data.axis); break;
        case 'mirror-selection': mirrorSelection(); break;
        case 'duplicate-selection': duplicateSelection(); break;
        case 'delete-selection': deleteSelection(); break;
        case 'reset-size':
            change(function () {
                selectedPlacements().forEach(function (p) {
                    var prop = resolveProp(p.propId);
                    if (prop) { p.w = prop.w; p.h = prop.h; }
                });
            });
            break;
        case 'flip':
            change(function () {
                selectedPlacements().forEach(function (p) { p.flip = !p.flip; });
            });
            break;
        case 'lock':
            change(function () {
                selectedPlacements().forEach(function (p) { p.locked = !p.locked; });
            });
            break;
        case 'raise': reorderSelection(1); break;
        case 'lower': reorderSelection(-1); break;
        case 'push-forward': pushForwardDialog(); break;
        case 'copy-layout': copyLayoutDialog(); break;
        case 'push-layout': pushLayoutDialog(); break;
        case 'mirror-scene': mirrorScene(); break;
        case 'save-preset': savePresetDialog(); break;
        case 'apply-preset': applyPresetDialog(); break;
        case 'export-png': exportScenePng(); break;
        case 'clear-scene':
            if (scene() && scene().placements.length &&
                window.confirm('Take everything off the stage in this scene?')) {
                change(function () { scene().placements = []; ui.selection = []; });
            }
            break;
        case 'own-scene-stage':
            change(function () { scene().stage = JSON.parse(JSON.stringify(production().stage)); });
            setTab('stage');
            break;
        case 'drop-scene-stage':
            change(function () { delete scene().stage; });
            break;
        case 'set-shape':
            change(function () { editingStage().shape = data.shape; ui.view = null; });
            break;
        case 'add-curtain':
            change(function () {
                var stage = editingStage();
                stage.curtains = stage.curtains || [];
                stage.curtains.push({
                    id: SP.uid('cur'),
                    name: stage.curtains.length ? 'Traveller ' + stage.curtains.length : 'House curtain',
                    offset: stage.curtains.length ? 3 : 0.4,
                    state: 'closed'
                });
            });
            break;
        case 'remove-curtain':
            change(function () {
                var stage = editingStage();
                stage.curtains = stage.curtains.filter(function (c) { return c.id !== data.id; });
                production().scenes.forEach(function (s) { delete s.curtains[data.id]; });
            });
            break;
        case 'add-custom-prop': customPropDialog(null); break;
        case 'edit-prop': customPropDialog(libraryById(data.prop)); break;
        case 'delete-prop': deleteCustomProp(data.prop); break;
        case 'new-production': addProduction(null); break;
        case 'duplicate-production': addProduction(production()); break;
        case 'delete-production': deleteProduction(); break;
        case 'export-json': exportJson(); break;
        case 'import-json': importJson(); break;
        case 'do-print': doPrint(); break;
        case 'overview-size': break;
        default: break;
        }
        void event;
    }

    function setBound(path, value) {
        var sc = scene();
        var sel = selectedPlacements();
        var out = SP.stageOutline(stageOf(sc));
        switch (path) {
        case 'scene.title': sc.title = value; break;
        case 'scene.subtitle': sc.subtitle = value; break;
        case 'scene.notes': sc.notes = value; break;
        case 'scene.label': sc.label = value.trim(); break;
        case 'scene.actId': sc.actId = value || null; break;
        case 'prod.units': production().units = value; break;
        case 'prod.numbering': production().numbering = value; break;
        case 'item.label': sel.forEach(function (p) { p.label = value; }); break;
        case 'item.note': sel.forEach(function (p) { p.note = value; }); break;
        case 'item.x': sel.forEach(function (p) { p.x = SP.round(fromField(value, p.x), 3); }); break;
        case 'item.upstage': sel.forEach(function (p) { p.y = SP.round(out.frontY - fromField(value, out.frontY - p.y), 3); }); break;
        case 'item.rot': sel.forEach(function (p) { p.rot = SP.normaliseAngle(parseFloat(value) || 0); }); break;
        case 'item.w': sel.forEach(function (p) { p.w = Math.max(0.05, fromField(value, p.w)); }); break;
        case 'item.h': sel.forEach(function (p) { p.h = Math.max(0.05, fromField(value, p.h)); }); break;
        default: break;
        }
    }

    function wire() {
        var app = $('#spApp');

        app.addEventListener('click', function (e) {
            var tab = e.target.closest('.sp-tab-btn');
            if (tab) { setTab(tab.dataset.tab); return; }
            var inspector = e.target.closest('[data-inspector]');
            if (inspector) { setInspector(inspector.dataset.inspector); return; }
            var actor = e.target.closest('[data-act]');
            if (actor && app.contains(actor)) {
                e.preventDefault();
                handleAction(actor.dataset.act, actor.dataset, e);
            }
        });

        document.addEventListener('click', function (e) {
            var actor = e.target.closest('.sp-modal [data-act]');
            if (!actor) return;
            e.preventDefault();
            var backdrop = e.target.closest('.sp-modal-backdrop');
            if (backdrop && backdrop.isConnected) backdrop.remove();
            handleAction(actor.dataset.act, actor.dataset, e);
        });

        /* text fields: one undo step per visit, saved as you type */
        app.addEventListener('focusin', function (e) {
            var el = e.target;
            if (el.matches('[data-bind]') && (el.tagName === 'TEXTAREA' || el.type === 'text')) {
                el.dataset.previous = el.value;
                beginHistory();
            }
        });
        app.addEventListener('focusout', function (e) {
            var el = e.target;
            if (el.matches('[data-bind]') && (el.tagName === 'TEXTAREA' || el.type === 'text')) {
                if (el.dataset.previous !== el.value) commitHistory();
                else cancelHistory();
            }
        });

        app.addEventListener('input', function (e) {
            var el = e.target;
            if (el.id === 'spSceneTitle') {
                if (!scene()) return;
                scene().title = el.value;
                persist();
                renderSceneList();
                return;
            }
            if (el.matches('[data-bind]') && (el.tagName === 'TEXTAREA' || el.type === 'text')) {
                setBound(el.dataset.bind, el.value);
                persist();
                if (el.dataset.bind.indexOf('scene.') === 0) renderSceneList();
                if (el.dataset.bind === 'item.label') renderCanvas(true);
                return;
            }
            if (el.id === 'spPropSearch') { ui.propSearch = el.value; renderPalette(); return; }
            if (el.id === 'spLibrarySearch') { ui.librarySearch = el.value; renderLibraryTab(); return; }
            if (el.id === 'spPrintFooter') { updatePrint({ footer: el.value }); return; }
        });

        app.addEventListener('change', function (e) {
            var el = e.target;

            if (el.id === 'spProductionSelect') {
                db.activeId = el.value;
                ui.sceneId = (scenes()[0] || {}).id;
                ui.selection = [];
                ui.view = null;
                persist();
                render();
                return;
            }
            if (el.id === 'spPropCategory') { ui.propCategory = el.value; persistUi(); renderPalette(); return; }
            if (el.id === 'spLibraryCategory') { ui.libraryCategory = el.value; persistUi(); renderLibraryTab(); return; }
            if (el.id === 'spLabelMode') { ui.labels = el.value; persistUi(); renderCanvas(true); return; }

            if (el.dataset.act === 'overview-size') {
                if (el.value === 'custom') updatePrint({ overviewCols: 4, overviewRows: 2 });
                else {
                    var bits = el.value.split('x');
                    updatePrint({ overviewCols: Number(bits[0]), overviewRows: Number(bits[1]) });
                }
                return;
            }
            if (el.dataset.printFlag) {
                var flagPatch = {};
                flagPatch[el.dataset.printFlag] = el.checked;
                updatePrint(flagPatch);
                return;
            }
            if (el.dataset.printNumber) {
                var numberPatch = {};
                numberPatch[el.dataset.printNumber] = Math.max(1, Math.min(8, Number(el.value) || 1));
                updatePrint(numberPatch);
                return;
            }
            if (el.dataset.print) {
                var patch = {};
                patch[el.dataset.print] = el.value;
                updatePrint(patch);
                return;
            }

            if (el.dataset.stageField) {
                change(function () {
                    var stage = editingStage();
                    var field = el.dataset.stageField;
                    if (field === 'grid.spacing') stage.grid.spacing = Math.max(0.1, fromField(el.value, 1));
                    else if (field === 'sides') stage.sides = SP.clamp(Math.round(Number(el.value) || 6), 3, 24);
                    else stage[field] = Math.max(0.2, fromField(el.value, SP.num(stage[field], 1)));
                    ui.view = null;
                });
                return;
            }
            if (el.dataset.stageFlag) {
                change(function () {
                    var stage = editingStage();
                    var flag = el.dataset.stageFlag;
                    if (flag.indexOf('grid.') === 0) stage.grid[flag.slice(5)] = el.checked;
                    else stage[flag] = el.checked;
                });
                return;
            }
            if (el.dataset.curtain) {
                change(function () {
                    var stage = editingStage();
                    var curtain = (stage.curtains || []).filter(function (c) { return c.id === el.dataset.curtain; })[0];
                    if (!curtain) return;
                    var field = el.dataset.curtainField;
                    if (field === 'offset') curtain.offset = Math.max(0, fromField(el.value, 0));
                    else curtain[field] = el.value;
                });
                return;
            }
            if (el.dataset.act === 'set-curtain') {
                change(function () { scene().curtains[el.dataset.id] = el.value; });
                return;
            }
            if (el.matches('[data-bind]')) {
                change(function () { setBound(el.dataset.bind, el.value); });
                return;
            }
        });

        /* ------------------------------------------------ scene reorder */

        var dragSceneId = null;
        app.addEventListener('dragstart', function (e) {
            var tile = e.target.closest('.sp-tile');
            if (tile) {
                e.dataTransfer.setData('text/plain', 'prop:' + tile.dataset.prop);
                e.dataTransfer.effectAllowed = 'copy';
                return;
            }
            var row = e.target.closest('.sp-scene-row');
            if (row) {
                dragSceneId = row.dataset.id;
                e.dataTransfer.setData('text/plain', 'scene:' + dragSceneId);
                e.dataTransfer.effectAllowed = 'move';
            }
        });
        app.addEventListener('dragover', function (e) {
            var row = e.target.closest('.sp-scene-row');
            if (!row || !dragSceneId) return;
            e.preventDefault();
            var box = row.getBoundingClientRect();
            var after = e.clientY > box.top + box.height / 2;
            $$('.sp-scene-row').forEach(function (r) {
                r.classList.remove('is-drop-before', 'is-drop-after');
            });
            row.classList.add(after ? 'is-drop-after' : 'is-drop-before');
        });
        app.addEventListener('drop', function (e) {
            var row = e.target.closest('.sp-scene-row');
            $$('.sp-scene-row').forEach(function (r) {
                r.classList.remove('is-drop-before', 'is-drop-after');
            });
            if (!row || !dragSceneId) return;
            e.preventDefault();
            var box = row.getBoundingClientRect();
            var after = e.clientY > box.top + box.height / 2;
            var target = scenes().map(function (s) { return s.id; }).indexOf(row.dataset.id);
            moveScene(dragSceneId, after ? target + 1 : target);
            dragSceneId = null;
        });
        app.addEventListener('dragend', function () {
            dragSceneId = null;
            $$('.sp-scene-row').forEach(function (r) {
                r.classList.remove('is-drop-before', 'is-drop-after');
            });
        });

        /* --------------------------------------------- props onto stage */

        var host = $('#spStageHost');
        host.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            host.classList.add('is-dropping');
        });
        host.addEventListener('dragleave', function (e) {
            if (e.target === host) host.classList.remove('is-dropping');
        });
        host.addEventListener('drop', function (e) {
            e.preventDefault();
            host.classList.remove('is-dropping');
            var payload = e.dataTransfer.getData('text/plain') || '';
            if (payload.indexOf('prop:') !== 0) return;
            var point = stagePoint(e);
            addProp(payload.slice(5), point.x, point.y);
        });

        /* ------------------------------------------------------- canvas */

        var svg = $('#spCanvas');
        svg.addEventListener('pointerdown', function (e) {
            pendingDragState = snapshot();
            onCanvasPointerDown(e);
            if (!drag) pendingDragState = null;
        });
        svg.addEventListener('pointermove', onCanvasPointerMove);
        svg.addEventListener('pointerup', onCanvasPointerUp);
        svg.addEventListener('pointercancel', onCanvasPointerUp);
        svg.addEventListener('wheel', onCanvasWheel, { passive: false });
        svg.addEventListener('dblclick', function (e) {
            var item = e.target.closest ? e.target.closest('.sp-item[data-id]') : null;
            if (!item) return;
            ui.selection = [item.dataset.id];
            ui.inspector = 'item';
            renderInspector();
            var field = $('#spItemLabel');
            if (field) field.focus();
        });

        $('#spZoomIn').addEventListener('click', function () { zoomBy(1 / 1.25); });
        $('#spZoomOut').addEventListener('click', function () { zoomBy(1.25); });
        $('#spZoomFit').addEventListener('click', fitView);
        $('#spSnapToggle').addEventListener('click', function () {
            ui.snap = !ui.snap;
            persistUi();
            $('#spSnapToggle').classList.toggle('is-on', ui.snap);
        });
        $('#spGhostToggle').addEventListener('click', function () {
            ui.ghosts = !ui.ghosts;
            persistUi();
            renderCanvas(true);
        });
        $('#spAddScene').addEventListener('click', function () { addScene(sceneIndex()); });
        $('#spAddAct').addEventListener('click', addAct);
        $('#spCopyLayout').addEventListener('click', copyLayoutDialog);
        $('#spMirror').addEventListener('click', mirrorScene);
        $('#spPresetSave').addEventListener('click', savePresetDialog);
        $('#spPresetApply').addEventListener('click', applyPresetDialog);
        $('#spProductionMenu').addEventListener('click', productionDialog);
        $('#spBackup').addEventListener('click', exportJson);
        $('#spUndo').addEventListener('click', undo);
        $('#spRedo').addEventListener('click', redo);

        /* ----------------------------------------------------- keyboard */

        document.addEventListener('keydown', function (e) {
            if (e.key === ' ' && !isTyping(e.target)) { spaceHeld = true; }
            if (isTyping(e.target)) return;
            if ($('.sp-modal-backdrop')) return;

            var meta = e.ctrlKey || e.metaKey;
            if (meta && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                if (e.shiftKey) redo(); else undo();
                return;
            }
            if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
            if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
            if (meta && e.key.toLowerCase() === 'a' && ui.tab === 'scenes') {
                e.preventDefault();
                ui.selection = (scene() ? scene().placements : []).map(function (p) { return p.id; });
                ui.inspector = 'item';
                renderCanvas(true);
                renderInspector();
                return;
            }
            if (meta && e.key.toLowerCase() === 'c') {
                clipboard = JSON.parse(JSON.stringify(selectedPlacements()));
                if (clipboard.length) toast(clipboard.length + ' prop' + (clipboard.length === 1 ? '' : 's') + ' copied.');
                return;
            }
            if (meta && e.key.toLowerCase() === 'v') {
                if (!clipboard.length || !scene()) return;
                change(function () {
                    var ids = clipboard.map(function (p) {
                        var copy = Object.assign({}, p);
                        copy.id = SP.uid('pl');
                        copy.trackId = SP.uid('trk');
                        scene().placements.push(copy);
                        return copy.id;
                    });
                    ui.selection = ids;
                    ui.inspector = 'item';
                });
                return;
            }
            if (meta && e.key.toLowerCase() === 'p') { e.preventDefault(); setTab('print'); return; }
            if (meta) return;

            if (ui.tab !== 'scenes') return;
            var step = ui.snap ? SP.num((stageOf(scene()).grid || {}).spacing, 1) / 2 : 0.05;
            if (e.shiftKey) step *= 2;

            switch (e.key) {
            case 'Delete':
            case 'Backspace': e.preventDefault(); deleteSelection(); break;
            case 'Escape': ui.selection = []; renderCanvas(true); renderInspector(); break;
            case 'ArrowLeft': e.preventDefault(); nudge(-step, 0); break;
            case 'ArrowRight': e.preventDefault(); nudge(step, 0); break;
            case 'ArrowUp': e.preventDefault(); nudge(0, -step); break;
            case 'ArrowDown': e.preventDefault(); nudge(0, step); break;
            case 'r': case 'R': rotateSelection(e.shiftKey ? -15 : 15); break;
            case 'f': case 'F': fitView(); break;
            case 'm': case 'M': mirrorSelection(); break;
            default: break;
            }
        });

        document.addEventListener('keyup', function (e) {
            if (e.key === ' ') spaceHeld = false;
        });

        window.addEventListener('beforeunload', function () {
            if (saveTimer) saveNow();
        });

        var resizeTimer = null;
        window.addEventListener('resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(function () {
                if (ui.tab === 'print') renderPrintPreview();
            }, 200);
        });
    }

    function isTyping(target) {
        if (!target) return false;
        var tag = target.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    }

    /* ================================================================== *
     * Start
     * ================================================================== */

    function init() {
        if (!$('#spApp')) return;
        db = load();
        loadUi();
        if (!ui.sceneId || !scene()) ui.sceneId = (scenes()[0] || {}).id;
        if (!ui.print) ui.print = null;
        wire();
        render();
        setSaveState('Saved locally');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
