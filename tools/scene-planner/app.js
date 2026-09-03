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
    var t = SPI18n.t;

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
        printDoc: 'plans',
        introSeen: {},
        print: null
    };
    var undoStack = [];
    var redoStack = [];
    var clipboard = [];
    var saveTimer = null;

    function defaultStage() {
        var stage = JSON.parse(JSON.stringify(SP.DEFAULT_STAGE));
        stage.curtains = [{ id: SP.uid('cur'), name: t('House curtain'), offset: 0.4, state: 'closed' }];
        return stage;
    }

    function newScene(title) {
        return {
            id: SP.uid('sc'), actId: null, placeId: null, title: title || '', subtitle: '',
            notes: '', label: '', placements: [], curtains: {}
        };
    }

    function newProduction(name) {
        return {
            id: SP.uid('prod'),
            name: name || t('Untitled production'),
            subtitle: '', venue: '', notes: '',
            units: 'm',
            numbering: 'continuous',
            directions: 'audience',
            stage: defaultStage(),
            acts: [],
            places: [],
            transitions: {},
            scenes: [newScene('')],
            presets: [],
            print: null,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
    }

    function blankDb() {
        var production = newProduction(t('Untitled production'));
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
            console.warn(t('Saved plan could not be read, starting fresh.'), err);
            return blankDb();
        }
    }

    /* Fills in anything a plan saved by an earlier version is missing, so an
       old file never lands the editor in a half-built state. */
    function migrateProduction(p) {
        p.units = p.units || 'm';
        p.numbering = p.numbering || 'continuous';
        p.directions = p.directions === 'cast' ? 'cast' : 'audience';
        p.acts = p.acts || [];
        p.places = p.places || [];
        p.places.forEach(function (place) { place.placements = place.placements || []; });
        p.transitions = p.transitions || {};
        SP.foldPresetsIntoPlaces(p);
        p.presets = p.presets || [];
        p.scenes = p.scenes || [];
        p.stage = Object.assign({}, SP.DEFAULT_STAGE, p.stage || {});
        p.stage.grid = Object.assign({ show: true, spacing: 1, labels: false }, p.stage.grid || {});
        p.stage.wings = Object.assign({ show: false, inset: 1.2, depth: 3.6 }, p.stage.wings || {});
        p.stage.curtains = p.stage.curtains || [];
        p.stage.markers = p.stage.markers || [];
        p.scenes.forEach(function (s) {
            s.placements = s.placements || [];
            s.curtains = s.curtains || {};
            if (s.placeId === undefined) s.placeId = null;
            s.wingNotes = s.wingNotes || [];
            s.placements.forEach(function (pl) {
                if (!pl.trackId) pl.trackId = SP.uid('trk');
                if (typeof pl.rot !== 'number') pl.rot = 0;
            });
            if (s.stage) {
                s.stage = Object.assign({}, SP.DEFAULT_STAGE, s.stage);
                s.stage.wings = Object.assign({ show: false, inset: 1.2, depth: 3.6 }, s.stage.wings || {});
            }
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
        sanitiseUi();
    }

    /*
     * Gespeicherte Oberflächenwerte gegen das prüfen, was es wirklich gibt.
     * Steht in ui.tab ein Reiter, den es nicht mehr gibt, bekommt kein Feld
     * die Klasse is-active und der Planer sieht aus, als wäre er kaputt.
     */
    function sanitiseUi() {
        var tabs = $$('.sp-tab-btn').map(function (b) { return b.dataset.tab; });
        if (tabs.indexOf(ui.tab) === -1) ui.tab = tabs[0] || 'scenes';
        if (['props', 'item', 'scene'].indexOf(ui.inspector) === -1) ui.inspector = 'props';
        if (['plans', 'changeover'].indexOf(ui.printDoc) === -1) ui.printDoc = 'plans';
        if (['name', 'custom', 'both', 'number', 'none'].indexOf(ui.labels) === -1) ui.labels = 'name';
        if (!ui.introSeen || typeof ui.introSeen !== 'object') ui.introSeen = {};
        if (ui.print && typeof ui.print === 'object') {
            ['overviewCols', 'overviewRows'].forEach(function (key) {
                var n = Math.round(SP.num(ui.print[key], 3));
                ui.print[key] = Math.max(1, Math.min(8, n));
            });
        } else {
            ui.print = null;
        }
    }

    function persistUi() {
        try {
            localStorage.setItem(UI_KEY, JSON.stringify({
                tab: ui.tab, inspector: ui.inspector, snap: ui.snap, ghosts: ui.ghosts,
                labels: ui.labels, propCategory: ui.propCategory, libraryCategory: ui.libraryCategory,
                printDoc: ui.printDoc, introSeen: ui.introSeen, print: ui.print
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
        setSaveState(t('Saving…'));
        saveTimer = setTimeout(saveNow, 350);
    }

    function saveNow() {
        clearTimeout(saveTimer);
        try {
            production().updatedAt = Date.now();
            localStorage.setItem(STORE_KEY, JSON.stringify(db));
            setSaveState(t('Saved locally'));
        } catch (err) {
            setSaveState(t('Could not save: storage is full'), 'bad');
            toast(t('This browser will not store any more. Export a backup, then delete an old production or a heavy custom prop.'), 'error');
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

    /*
     * Alle Requisiten, nach Kategorie geordnet wie im Reiter. Ohne das steht
     * jede Kategorie mehrfach in der Liste, weil die Reihenfolge in der Datei
     * längst nicht mehr der Einteilung folgt.
     */
    function allProps() {
        var order = {};
        SPProps.CATEGORIES.forEach(function (cat, i) { order[cat] = i; });
        var rank = function (p) {
            return order[p.cat] === undefined ? SPProps.CATEGORIES.length : order[p.cat];
        };
        return SPProps.LIBRARY.concat(db.library).slice().sort(function (a, b) {
            return rank(a) - rank(b) || t(a.name).localeCompare(t(b.name), 'de');
        });
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

    /* Vorhangzustände sind gespeicherte Werte ('open'/'half'/'closed');
       übersetzt wird nur, was davon auf dem Schirm steht. */
    function curtainStateLabel(state) {
        if (state === 'half') return t('Half open');
        if (state === 'open') return t('Open');
        return t('Closed');
    }

    function lengthLabel() { return units() === 'ft' ? 'ft' : 'm'; }

    /* ================================================================== *
     * A worked example, for anyone who would rather see it than read it
     * ================================================================== */

    function buildExample() {
        var p = newProduction(t('The Winter Guest'));
        p.subtitle = t('A play in two acts, for trying things out');
        p.venue = t('School hall');
        p.numbering = 'per-act';
        p.stage.shape = 'rect';
        p.stage.width = 9;
        p.stage.depth = 6.5;
        p.stage.grid.show = false;
        p.stage.wings = { show: true, inset: 1.2, depth: 5 };
        p.stage.curtains = [
            { id: SP.uid('cur'), name: t('House curtain'), offset: 0.3, state: 'closed' }
        ];

        var act1 = { id: SP.uid('act'), name: t('Before the interval'), notes: '' };
        var act2 = { id: SP.uid('act'), name: t('After the interval'), notes: '' };
        p.acts = [act1, act2];

        /* Die Orte, an denen das Stück spielt, mit ihrer festen Ausstattung. */
        function place(name, props) {
            var pl = SP.newPlace(name);
            pl.props = props.split(', ');
            p.places.push(pl);
            return pl;
        }
        var school = place(t('School'), t('4 chairs, board, desk, sponge, chalk'));
        var market = place(t('Market'), t('Market stall, crate'));
        var living = place(t('Living room'), t('Table, cloth, 2 chairs, coat stand, side table with picture'));
        var park = place(t('Park'), t('Bench, bin'));
        var cafe = place(t('Café'), t('Table, 3 chairs, mugs, pot, menu'));

        function put(propId, x, y, rot, label) {
            var prop = SPProps.get(propId);
            if (!prop) return null;
            var pl = SP.makePlacement(prop, x, y);
            pl.rot = rot || 0;
            if (label) pl.label = label;
            return pl;
        }
        function scene(title, placeId, actId, items) {
            var sc = newScene(title);
            sc.actId = actId;
            sc.placeId = placeId;
            sc.placements = items.filter(Boolean);
            return sc;
        }

        var s1 = scene(t('The school'), school.id, act1.id, [
            put('ill-blackboard', -1.6, 1.1),
            put('ill-table', 0.4, 2.5),
            put('ill-sponge', 0.15, 2.35),
            put('ill-chalk', 0.62, 2.62),
            put('ill-chair', -1.9, 4.4), put('ill-chair', -0.7, 4.4),
            put('ill-chair', 0.8, 4.4), put('ill-chair', 2.0, 4.4)
        ]);

        var s2 = scene(t('The market'), market.id, act1.id, [
            put('ill-stall', -0.4, 2.3, 8),
            put('ill-crate', -2.5, 3.7, -12)
        ]);

        var s3 = scene(t('The living room'), living.id, act1.id, [
            put('ill-tablecloth', 0, 3.2, -12),
            put('ill-chair', -1.6, 3.0, 90, t('Anna’s chair')),
            put('ill-chair', 0.2, 1.9, 180),
            put('ill-coatstand', 3.1, 1.3),
            put('ill-sidetable', -2.9, 4.6),
            put('ill-typewriter', 0.5, 3.1),
            put('ill-bottle', -0.7, 3.5)
        ]);

        var s4 = scene(t('The park'), park.id, act2.id, [
            put('ill-bench', -0.4, 4.2),
            put('ill-bin', 2.7, 4.6)
        ]);

        var s5 = scene(t('The café'), cafe.id, act2.id, [
            put('ill-table', 0, 3.4),
            put('ill-pot', -0.22, 3.28),
            put('ill-mug', 0.2, 3.22),
            put('ill-menu', 0.26, 3.6),
            put('ill-cafechair', -1.6, 3.3, 0),
            put('ill-cafechair', 1.6, 3.3, 180),
            put('ill-cafechair', 0, 2.0, 90),
            put('ill-mug', 0.3, 3.2)
        ]);

        p.scenes = [s1, s2, s3, s4, s5];
        p.scenes.forEach(function (sc) {
            p.stage.curtains.forEach(function (c) { sc.curtains[c.id] = 'open'; });
        });
        s1.curtains[p.stage.curtains[0].id] = 'closed';

        /* Was der Planer nicht ausrechnen kann, steht hier von Hand. */
        SP.ensureTransition(p, null, s1).note = t('The board is set before the house opens.');
        SP.ensureTransition(p, s1, s2).note = t('Crate stays in the right wing for later.');
        var interval = SP.ensureTransition(p, s3, s4);
        interval.critical = true;
        interval.note = t('Strike the whole room during the interval.');
        interval.banners.push({ text: t('INTERVAL'), sub: '', where: 'before' });

        /* Ein Gassenzettel: was bereitliegt, ohne auf der Bühne zu stehen. */
        s5.wingNotes = [{
            id: SP.uid('wn'), side: 'right', propId: 'ill-mug',
            text: t('A mug with a mouthful of water in it')
        }];

        /* Jeder Ort bekommt sein Bühnenbild aus der Szene, die dort spielt. */
        [[school, s1], [market, s2], [living, s3], [park, s4], [cafe, s5]].forEach(function (pair) {
            pair[0].placements = SP.copyPlacements(pair[1].placements, false);
            pair[0].props = [];
        });
        return p;
    }

    /* ================================================================== *
     * Drawing the interface
     * ================================================================== */

    /*
     * Übersetzt das statische Markup. Der englische Text im HTML ist zugleich
     * der Wörterbuchschlüssel, darum steht hier kein zweiter Satz Namen herum
     * und eine englische Fassung wäre nur ein Sprachwechsel.
     */
    function translateMarkup(root) {
        $$('[data-i18n]', root || document).forEach(function (el) {
            var key = el.getAttribute('data-i18n-key');
            if (key === null) {
                key = el.textContent.replace(/\s+/g, ' ').trim();
                el.setAttribute('data-i18n-key', key);
            }
            el.textContent = t(key);
        });
        $$('[data-i18n-attr]', root || document).forEach(function (el) {
            el.getAttribute('data-i18n-attr').split(',').forEach(function (attr) {
                attr = attr.trim();
                var store = 'data-i18n-' + attr;
                var key = el.getAttribute(store);
                if (key === null) {
                    key = el.getAttribute(attr) || '';
                    el.setAttribute(store, key);
                }
                if (key) el.setAttribute(attr, t(key));
            });
        });
    }

    /*
     * Beim ersten Betreten eines Bereichs eine kurze Einführung: wofür er da
     * ist und was man als Nächstes tut. Sie schwebt unter dem Reiter, statt
     * sich in die Seite zu drängen — der Platz ist ohnehin knapp.
     */
    function closeIntro() {
        var open = $('.sp-intro');
        if (open) open.remove();
    }

    function placeIntro(box, tab) {
        var button = $('.sp-tab-btn[data-tab="' + tab + '"]');
        if (!button) return;
        var r = button.getBoundingClientRect();
        var w = box.offsetWidth;
        var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
        box.style.left = Math.round(left) + 'px';
        box.style.top = Math.round(r.bottom + 6) + 'px';
    }

    function overlayOpen() {
        return !!$('.sp-modal-backdrop');
    }

    function renderIntro(tab) {
        closeIntro();
        var info = SPI18n.intro(tab);
        if (!info || (ui.introSeen || {})[tab]) return;
        // Erst wenn „Was hast du vor?“ und die Einrichtung weg sind.
        if (overlayOpen()) return;

        var box = document.createElement('div');
        box.className = 'sp-intro';
        box.setAttribute('role', 'dialog');
        box.dataset.tab = tab;
        box.innerHTML =
            '<h4>' + esc(info.title) + '</h4>' +
            '<p>' + esc(info.body) + '</p>' +
            '<ol>' + info.steps.map(function (step) {
                return '<li>' + esc(step) + '</li>';
            }).join('') + '</ol>' +
            '<div class="sp-intro-actions">' +
            '<button class="sp-btn is-primary" data-act="intro-done" data-tab="' + esc(tab) + '">' +
            esc(t('Got it')) + '</button>' +
            '<button class="sp-btn is-quiet" data-act="intro-off">' +
            esc(t('Turn these introductions off')) + '</button></div>';
        document.body.appendChild(box);
        placeIntro(box, tab);
    }

    function dismissIntro(tab) {
        ui.introSeen = ui.introSeen || {};
        ui.introSeen[tab] = true;
        persistUi();
        closeIntro();
    }

    function introsOff() {
        ui.introSeen = {};
        Object.keys(SPI18n.INTRO.de).forEach(function (tab) { ui.introSeen[tab] = true; });
        persistUi();
        closeIntro();
    }

    function introsOn() {
        ui.introSeen = {};
        persistUi();
        renderIntro(ui.tab);
    }

    function render() {
        SP.setDirections(production().directions);
        renderTopBar();
        if (ui.tab === 'scenes') { renderSceneList(); renderCanvas(true); renderInspector(); }
        if (ui.tab === 'stage') renderStageTab();
        if (ui.tab === 'places') renderPlacesTab();
        if (ui.tab === 'props') renderLibraryTab();
        if (ui.tab === 'print') renderPrintTab();
        renderIntro(ui.tab);
    }

    function renderTopBar() {
        var select = $('#spProductionSelect');
        select.innerHTML = db.productions.map(function (p) {
            return '<option value="' + esc(p.id) + '"' + (p.id === db.activeId ? ' selected' : '') + '>' +
                esc(p.name || t('Untitled production')) + '</option>';
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
            host.innerHTML = '<div class="sp-empty">' + esc(t('No scenes yet.')) + '<br>' +
                '<button class="sp-btn" data-act="add-scene" style="margin-top:0.7rem">' + esc(t('Add the first scene')) + '</button>' +
                '<button class="sp-btn is-quiet" data-act="load-example" style="margin-top:0.7rem">' + esc(t('Open an example')) + '</button></div>';
            return;
        }

        var html = groups.map(function (group) {
            var head = '';
            if (group.act) {
                head = '<div class="sp-act-head"><strong>' + esc(actName(group.act)) + '</strong>' +
                    '<button class="sp-btn is-quiet" data-act="edit-act" data-id="' + esc(group.act.id) + '" title="' + esc(t('Rename this act')) + '">' + esc(t('Edit')) + '</button></div>';
            } else if (groups.length > 1 || p.acts.length) {
                head = '<div class="sp-act-head"><strong>' + esc(t('Not in an act')) + '</strong></div>';
            }

            return head + group.scenes.map(function (s) {
                var index = p.scenes.indexOf(s);
                var diff = index > 0 ? SP.diffScenes(p.scenes[index - 1], s) : null;
                var changes = diff ? SP.changeCount(diff) : 0;
                var sub = SPI18n.plural(s.placements.length, '1 prop', '{n} props');
                if (diff) {
                    sub += changes
                        ? ' · <em>' + esc(SPI18n.plural(changes, '1 change', '{n} changes')) + '</em>'
                        : ' · ' + esc(t('no change'));
                } else sub += ' · ' + esc(t('preset'));

                return '<div class="sp-scene-row' + (s.id === (scene() || {}).id ? ' is-active' : '') +
                    '" data-act="pick-scene" data-id="' + esc(s.id) + '" draggable="true">' +
                    '<span class="sp-scene-no">' + esc(numbers[s.id].label) + '</span>' +
                    '<span class="sp-scene-main"><span class="sp-scene-title">' +
                    esc(s.title || t('Untitled scene')) + '</span>' +
                    '<span class="sp-scene-sub">' + sub + '</span></span>' +
                    '<span class="sp-scene-tools">' +
                    '<button class="sp-btn is-quiet" data-act="duplicate-scene" data-id="' + esc(s.id) + '" title="' + esc(t('Duplicate this scene')) + '">' + esc(t('Copy')) + '</button>' +
                    '<button class="sp-btn is-quiet is-danger" data-act="delete-scene" data-id="' + esc(s.id) + '" title="' + esc(t('Delete this scene')) + '">&times;</button>' +
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
            wingNotes: sc.wingNotes || null,
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
            note.textContent = t('No scene selected. Add one on the left to start placing props.');
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
                ? esc(t('Bare stage. Drag a prop in from the right to start.')) + '<br>' +
                  '<button class="sp-btn" data-act="load-example" style="margin-top:0.6rem">' +
                  esc(t('Or open a worked example')) + '</button>'
                : esc(t('Bare stage. Drag a prop in from the right, or copy the layout from another scene.'));
        }

        var offstage = sc.placements.filter(function (pl) {
            return !SP.containsPoint(stageOf(sc), pl.x, pl.y);
        });
        $('#spOffstageWarning').textContent = offstage.length
            ? SPI18n.plural(offstage.length, '1 prop sits outside the stage outline',
                '{n} props sit outside the stage outline')
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
            ? t((resolveProp(sel[0].propId) || { name: t('Unknown prop') }).name) + ', ' +
              SP.describePosition(stageOf(scene()), sel[0].x, sel[0].y, units())
            : (sel.length ? SPI18n.plural(sel.length, '1 prop selected', '{n} props selected') : '');
    }

    function propTile(prop) {
        var art = prop.image
            ? '<img src="' + esc(prop.image) + '" alt="" style="width:100%;height:40px;object-fit:contain">'
            : '<svg viewBox="0 0 100 100" class="sp-plan"><g class="sp-art" stroke-width="' + (4 * (prop.sw || 1)) + '">' + prop.art + '</g></svg>';
        return '<div class="sp-tile" draggable="true" data-act="add-prop" data-prop="' + esc(prop.id) + '" title="' +
            esc(t(prop.name)) + '">' + art +
            '<span class="sp-tile-name">' + esc(t(prop.name)) + '</span>' +
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
        return '<option value="all"' + (selected === 'all' ? ' selected' : '') + '>' + esc(t('Every category')) + '</option>' +
            cats.map(function (c) {
                return '<option value="' + esc(c) + '"' + (selected === c ? ' selected' : '') + '>' + esc(t(c)) + '</option>';
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
            $('#spPalette').innerHTML = '<p class="sp-empty" style="grid-column:1/-1">' + esc(t('Nothing matches that.')) + '</p>';
            return;
        }

        var html = '';
        var lastCat = null;
        list.forEach(function (prop) {
            if (prop.cat !== lastCat && ui.propCategory === 'all') {
                html += '<div class="sp-cat-head">' + esc(t(prop.cat)) + '</div>';
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
            host.innerHTML = '<div class="sp-empty">' + esc(t('Nothing selected.')) + '<br>' + esc(t('Click a prop on the stage, or drag a box around several.')) + '</div>';
            return;
        }

        if (sel.length > 1) {
            host.innerHTML =
                '<div class="sp-section"><h3>' + esc(SPI18n.plural(sel.length, '1 prop selected', '{n} props selected')) + '</h3>' +
                '<div class="sp-btn-row">' +
                '<button class="sp-btn" data-act="align" data-axis="x">' + esc(t('Line up across')) + '</button>' +
                '<button class="sp-btn" data-act="align" data-axis="y">' + esc(t('Line up upstage')) + '</button>' +
                '<button class="sp-btn" data-act="spread" data-axis="x">' + esc(t('Space evenly')) + '</button>' +
                '<button class="sp-btn" data-act="mirror-selection">' + esc(t('Mirror')) + '</button>' +
                '<button class="sp-btn" data-act="duplicate-selection">' + esc(t('Duplicate')) + '</button>' +
                '<button class="sp-btn is-danger" data-act="delete-selection">' + esc(t('Delete')) + '</button>' +
                '</div></div>' +
                '<div class="sp-section"><h3>' + esc(t('In this selection')) + '</h3><ul style="list-style:none;padding:0;margin:0">' +
                SP.groupByProp(sel, function (id) { return (resolveProp(id) || {}).name || id; }).map(function (g) {
                    return '<li style="font-size:0.82rem;padding:0.15rem 0">' +
                        (g.count > 1 ? g.count + ' × ' : '') + esc(g.name) + '</li>';
                }).join('') + '</ul></div>';
            return;
        }

        var p = sel[0];
        var prop = resolveProp(p.propId) || { name: t('Unknown prop'), cat: '' };
        var stage = stageOf(sc);
        var out = SP.stageOutline(stage);
        var gridRef = stage.grid && stage.grid.labels
            ? SP.gridReference(stage, p.x, p.y, SP.num(stage.grid.spacing, 1)) : null;

        host.innerHTML =
            '<div class="sp-section">' +
            '<h3>' + esc(t(prop.name)) + '</h3>' +
            '<div class="sp-field"><label for="spItemLabel">' + esc(t('Written on the plan')) + '</label>' +
            '<input type="text" id="spItemLabel" data-bind="item.label" value="' + esc(p.label || '') +
            '" placeholder="' + esc(t('e.g. Anna’s chair')) + '"></div>' +
            '<div class="sp-field"><label for="spItemNote">' + esc(t('Note for the crew')) + '</label>' +
            '<textarea id="spItemNote" data-bind="item.note" placeholder="' + esc(t('Comes on from stage right')) + '">' +
            esc(p.note || '') + '</textarea></div>' +
            '</div>' +

            '<div class="sp-section"><h3>' + esc(t('Position')) + '</h3>' +
            '<div class="sp-field-row">' +
            '<div><label for="spItemX">' + esc(t('Across from centre ({unit})', { unit: lengthLabel() })) + '</label>' +
            '<input type="number" step="0.05" id="spItemX" data-bind="item.x" value="' + toField(p.x) + '"></div>' +
            '<div><label for="spItemY">' + esc(t('Upstage of setting line ({unit})', { unit: lengthLabel() })) + '</label>' +
            '<input type="number" step="0.05" id="spItemY" data-bind="item.upstage" value="' +
            toField(out.frontY - p.y) + '"></div>' +
            '</div>' +
            '<div class="sp-field-row">' +
            '<div><label for="spItemRot">' + esc(t('Turned (degrees)')) + '</label>' +
            '<input type="number" step="5" id="spItemRot" data-bind="item.rot" value="' + SP.round(p.rot || 0, 1) + '"></div>' +
            '<div><label>' + esc(t('Reads as')) + '</label><p class="sp-hint" style="margin-top:0.3rem">' +
            esc(SP.zoneName(stage, p.x, p.y)) +
            (gridRef ? ', ' + esc(t('square {ref}', { ref: gridRef })) : '') + '</p></div>' +
            '</div>' +
            '<p class="sp-hint">' + esc(SP.describePosition(stage, p.x, p.y, units())) + '</p>' +
            '</div>' +

            '<div class="sp-section"><h3>' + esc(t('Size')) + why('item.size') + '</h3>' +
            (SPPlan.keepsAspect(prop)
                ? '<p class="sp-hint" style="margin-bottom:0.4rem">' +
                  esc(t('This drawing keeps its proportions — the other side follows.')) + '</p>' : '') +
            '<div class="sp-field-row">' +
            '<div><label for="spItemW">' + esc(t('Across ({unit})', { unit: lengthLabel() })) + '</label>' +
            '<input type="number" step="0.05" min="0.05" id="spItemW" data-bind="item.w" value="' + toField(p.w) + '"></div>' +
            '<div><label for="spItemH">' + esc(t('Deep ({unit})', { unit: lengthLabel() })) + '</label>' +
            '<input type="number" step="0.05" min="0.05" id="spItemH" data-bind="item.h" value="' + toField(p.h) + '"></div>' +
            '</div>' +
            '<div class="sp-btn-row">' +
            '<button class="sp-btn" data-act="reset-size">' + esc(t('Back to catalogue size')) + '</button>' +
            '<button class="sp-btn' + (p.flip ? ' is-on' : '') + '" data-act="flip">' + esc(t('Flip')) + '</button>' +
            '<button class="sp-btn' + (p.locked ? ' is-on' : '') + '" data-act="lock">' +
            (p.locked ? t('Locked') : t('Lock')) + '</button>' +
            '</div></div>' +

            '<div class="sp-section"><h3>' + esc(t('Order and copies')) + '</h3><div class="sp-btn-row">' +
            '<button class="sp-btn" data-act="raise">' + esc(t('Bring forward')) + '</button>' +
            '<button class="sp-btn" data-act="lower">' + esc(t('Send back')) + '</button>' +
            '<button class="sp-btn" data-act="duplicate-selection">' + esc(t('Duplicate')) + '</button>' +
            '<button class="sp-btn" data-act="push-forward">' + esc(t('Carry into later scenes…')) + '</button>' +
            '<button class="sp-btn is-danger" data-act="delete-selection">' + esc(t('Delete')) + '</button>' +
            '</div></div>';
    }

    function renderSceneInspector() {
        var host = $('#spInspectorScene');
        var sc = scene();
        var p = production();
        if (!sc) { host.innerHTML = '<div class="sp-empty">' + esc(t('No scene selected.')) + '</div>'; return; }

        var numbers = SP.sceneNumbers(p);
        var prev = previousScene();
        var diff = prev ? SP.diffScenes(prev, sc) : null;
        var stage = stageOf(sc);

        var changeHtml;
        if (!diff) {
            changeHtml = '<p class="sp-hint">' + esc(t('This is the first scene, so everything here is a preset before the house opens.')) + '</p>';
        } else if (!SP.changeCount(diff)) {
            changeHtml = '<p class="sp-hint">' + esc(t('Nothing changes from the scene before.')) + '</p>';
        } else {
            var lines = changeLines(diff, stage);
            changeHtml = '<div class="sp-changes">' +
                changeGroup(t('Bring on'), 'on', lines.on) +
                changeGroup(t('Strike'), 'off', lines.off) +
                changeGroup(t('Move'), 'move', lines.move) + '</div>';
        }

        var curtainRows = (stage.curtains || []).map(function (c) {
            var state = sc.curtains[c.id] || c.state || 'closed';
            return '<div class="sp-field"><label>' + esc(c.name) + '</label>' +
                '<select data-act="set-curtain" data-id="' + esc(c.id) + '">' +
                ['closed', 'half', 'open'].map(function (opt) {
                    return '<option value="' + opt + '"' + (state === opt ? ' selected' : '') + '>' +
                        esc(curtainStateLabel(opt)) + '</option>';
                }).join('') + '</select></div>';
        }).join('');

        host.innerHTML =
            '<div class="sp-section">' +
            '<h3>' + esc(t('Scene {label}', { label: numbers[sc.id].label })) + '</h3>' +
            '<div class="sp-field"><label for="spSceneSub">' + esc(t('Subtitle, time of day')) + '</label>' +
            '<input type="text" id="spSceneSub" data-bind="scene.subtitle" value="' + esc(sc.subtitle || '') +
            '" placeholder="' + esc(t('Evening, the first frost')) + '"></div>' +
            '<div class="sp-field"><label for="spSceneAct">' + esc(t('Act')) + why('scene.act') + '</label>' +
            '<select id="spSceneAct" data-bind="scene.actId">' +
            '<option value="">' + esc(t('Not in an act')) + '</option>' +
            p.acts.map(function (a) {
                return '<option value="' + esc(a.id) + '"' + (sc.actId === a.id ? ' selected' : '') + '>' +
                    esc(actName(a)) + '</option>';
            }).join('') + '</select></div>' +
            '<div class="sp-field"><label for="spScenePlace">' + esc(t('Plays in')) + why('scene.place') + '</label>' +
            '<select id="spScenePlace" data-bind="scene.placeId">' +
            '<option value="">' + esc(t('No place')) + '</option>' +
            p.places.map(function (pl) {
                return '<option value="' + esc(pl.id) + '"' + (sc.placeId === pl.id ? ' selected' : '') + '>' +
                    esc(pl.name || t('Place')) + '</option>';
            }).join('') + '</select></div>' +
            '<div class="sp-field"><label for="spSceneLabel">' + esc(t('Number shown on the sheet')) + why('scene.label') + '</label>' +
            '<input type="text" id="spSceneLabel" data-bind="scene.label" value="' + esc(sc.label || '') +
            '" placeholder="' + esc(t('{label} (worked out automatically)', { label: numbers[sc.id].label })) + '"></div>' +
            '<div class="sp-field"><label for="spSceneNotes">' + esc(t('Notes')) + why('scene.notes') + '</label>' +
            '<textarea id="spSceneNotes" data-bind="scene.notes" placeholder="' + esc(t('Tea things preset. Fire lit.')) + '">' +
            esc(sc.notes || '') + '</textarea></div>' +
            '</div>' +

            '<div class="sp-section"><h3>' + esc(t('Changes from the scene before')) + '</h3>' + changeHtml + '</div>' +

            driftPanel(sc) +

            transitionPanel(sc) +

            wingNotePanel(sc) +

            (curtainRows ? '<div class="sp-section"><h3>' + esc(t('Curtains in this scene')) + '</h3>' + curtainRows + '</div>' : '') +

            '<div class="sp-section"><h3>' + esc(t('Layout')) + why('scene.copyLayout') + '</h3><div class="sp-btn-row">' +
            '<button class="sp-btn" data-act="copy-layout">' + esc(t('Copy from another scene…')) + '</button>' +
            '<button class="sp-btn" data-act="mirror-scene">' + esc(t('Mirror across the centre')) + '</button>' +
            '<button class="sp-btn" data-act="update-place-set">' + esc(t('Update the place from this scene')) + '</button>' +
            '<button class="sp-btn" data-act="insert-place-set">' + esc(t('Insert this place’s set')) + '</button>' +
            '<button class="sp-btn" data-act="push-layout">' + esc(t('Copy this layout to other scenes…')) + '</button>' +
            '<button class="sp-btn" data-act="export-png">' + esc(t('Save this plan as a picture')) + '</button>' +
            '<button class="sp-btn is-danger" data-act="clear-scene">' + esc(t('Clear the stage')) + '</button>' +
            '</div></div>' +

            '<div class="sp-section"><h3>' + esc(t('Stage for this scene')) + why('stage.perScene') + '</h3>' +
            (sc.stage
                ? '<p class="sp-hint">' + esc(t('This scene uses its own stage, set on the Stage tab while the scene is selected.')) + '</p>' +
                  '<div class="sp-btn-row"><button class="sp-btn" data-act="drop-scene-stage">' + esc(t('Go back to the production stage')) + '</button></div>'
                : '<p class="sp-hint">' + esc(t('Using the production stage: {shape}.', { shape: t(SP.shapeById(stage.shape).name) })) + '</p>' +
                  '<div class="sp-btn-row"><button class="sp-btn" data-act="own-scene-stage">' + esc(t('Give this scene its own stage')) + '</button></div>') +
            '</div>';
    }

    /* Dieselben Zeilen, die auch im Umbauplan stehen — einmal formuliert,
       damit Bildschirm und Papier nicht auseinanderlaufen. */
    function changeLines(diff, stage) {
        var nameOf = function (id) { return t((resolveProp(id) || { name: t('Unknown prop') }).name); };
        return {
            on: SP.groupByProp(diff.added, nameOf).map(SP.describeGroup),
            off: SP.groupByProp(diff.removed, nameOf).map(SP.describeGroup),
            move: diff.moved.map(function (m) {
                var label = nameOf(m.to.propId) + (m.to.label ? ' (' + m.to.label + ')' : '');
                if (m.distance <= 0.12 && m.turned > 4) {
                    return label + ' → ' + Math.round(m.to.rot) + '°';
                }
                return label + ' → ' + SP.describePosition(stage, m.to.x, m.to.y, units());
            })
        };
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
            '<div class="sp-modal' + (config.modalClass ? ' ' + config.modalClass : '') +
            '" role="dialog" aria-modal="true">' +
            '<header><h2>' + esc(config.title) + '</h2></header>' +
            '<div class="sp-modal-body"></div>' +
            '<footer><button class="sp-btn" data-close="1">' + esc(config.cancelLabel || t('Cancel')) + '</button>' +
            actions + '</footer></div>';

        var body = $('.sp-modal-body', backdrop);
        if (typeof config.body === 'string') body.innerHTML = config.body;
        else if (config.body) body.appendChild(config.body);

        function close() {
            document.removeEventListener('keydown', onKey, true);
            backdrop.remove();
            if (config.onClose) config.onClose();
            renderIntro(ui.tab);
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
        closeIntro();
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
                esc(s.title || t('Untitled scene')) + '</label>';
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
            copy.title = source.title ? t('{title} (copy)', { title: source.title }) : '';
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
            window.confirm(t('Delete “{title}” and its {n} props?',
                { title: target.title || t('this scene'), n: target.placements.length }));
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
        if (!others.length) { toast(t('There is only one scene so far.')); return; }

        openModal({
            title: t('Copy a layout into this scene'),
            body: '<div class="sp-field"><label for="spCopySource">' + esc(t('Take the layout from')) + '</label>' +
                '<select id="spCopySource">' + others.map(function (s) {
                    return '<option value="' + esc(s.id) + '">' + esc(numbers[s.id].label) + ' · ' +
                        esc(t('{title} ({n} props)', { title: s.title || t('Untitled scene'), n: s.placements.length })) + '</option>';
                }).join('') + '</select></div>' +
                '<div class="sp-field"><label for="spCopyMode">' + esc(t('And')) + '</label>' +
                '<select id="spCopyMode">' +
                '<option value="replace">' + esc(t('replace what is here')) + '</option>' +
                '<option value="merge">' + esc(t('add to what is here')) + '</option></select></div>' +
                '<label class="sp-check"><input type="checkbox" id="spCopyMirror"> Mirror it across the centre line</label>' +
                '<p class="sp-hint">' + esc(t('Props keep their identity, so the change list will say “moved” rather than “struck and brought back on”.')) + '</p>',
            actions: [{
                label: t('Copy the layout'), primary: true,
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
        if (scenes().length < 2) { toast(t('Add another scene first.')); return; }
        openModal({
            title: t('Copy this layout to other scenes'),
            body: '<p class="sp-hint" style="margin-bottom:0.7rem">' + esc(t('Useful for a set that comes back later in the evening. Tick the scenes that should look like this one.')) + '</p>' +
                sceneChecklist(sc.id, false) +
                '<div class="sp-field" style="margin-top:0.7rem"><label for="spPushMode">' + esc(t('In those scenes')) + '</label>' +
                '<select id="spPushMode"><option value="replace">' + esc(t('replace the layout')) + '</option>' +
                '<option value="merge">' + esc(t('add these props to it')) + '</option></select></div>',
            actions: [{
                label: t('Copy it over'), primary: true,
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
                    toast(SPI18n.plural(ids.length, 'Layout copied into 1 scene.', 'Layout copied into {n} scenes.'), 'success');
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
        if (!later.length) { toast(t('This is the last scene.')); return; }
        var numbers = SP.sceneNumbers(production());

        openModal({
            title: t(sel.length === 1 ? 'Carry this prop into later scenes' : 'Carry these props into later scenes'),
            body: '<p class="sp-hint" style="margin-bottom:0.7rem">' + esc(t('The same prop, in the same spot. It keeps its identity, so it will not show up as struck and brought back.')) + '</p>' +
                '<div class="sp-pick-list">' + later.map(function (s) {
                    return '<label><input type="checkbox" value="' + esc(s.id) + '" checked> ' +
                        '<span class="sp-scene-no">' + esc(numbers[s.id].label) + '</span> ' +
                        esc(s.title || t('Untitled scene')) + '</label>';
                }).join('') + '</div>',
            actions: [{
                label: t('Carry it over'), primary: true,
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

    /*
     * Das Bühnenbild eines Orts, in beide Richtungen. Nichts davon geschieht
     * von selbst: die Szene gewinnt immer, hier wird nur auf Knopfdruck
     * übertragen.
     */
    function updatePlaceFromScene() {
        var sc = scene();
        var place = SP.placeForScene(production(), sc);
        if (!place) { toast(t('This scene has no place yet.')); return; }
        change(function () {
            place.placements = SP.copyPlacements(sc.placements, false);
        });
        toast(t('Set taken from this scene.'), 'success');
    }

    function insertPlaceSet() {
        var sc = scene();
        var p = production();
        var place = SP.placeForScene(p, sc);
        if (!place) { toast(t('This scene has no place yet.')); return; }
        if (!(place.placements || []).length) {
            toast(t('Arrange a scene, then update the place from it.'));
            return;
        }
        openModal({
            title: t('Insert this place’s set'),
            body: '<p class="sp-hint" style="margin-bottom:0.7rem">' +
                esc(SPI18n.explain('place.set').body) + '</p>' +
                '<div class="sp-field"><label for="spSetMode">' + esc(t('And')) + '</label>' +
                '<select id="spSetMode">' +
                '<option value="replace">' + esc(t('replace what is here')) + '</option>' +
                '<option value="merge">' + esc(t('add to what is here')) + '</option></select></div>' +
                '<label class="sp-check"><input type="checkbox" id="spSetMirror"> ' +
                esc(t('Mirror it')) + '</label>',
            actions: [{
                label: t('Insert this place’s set'), primary: true,
                onClick: function (body) {
                    var mode = $('#spSetMode', body).value;
                    var mirror = $('#spSetMirror', body).checked;
                    change(function () {
                        var copied = SP.copyPlacements(place.placements, true);
                        if (mirror) {
                            SP.mirrorPlacements(copied, 'horizontal', stageOf(sc))
                                .forEach(function (m, i) { Object.assign(copied[i], m); });
                        }
                        sc.placements = mode === 'replace' ? copied : sc.placements.concat(copied);
                        ui.selection = [];
                    });
                    toast(t('Set inserted.'), 'success');
                }
            }]
        });
    }

    function editActDialog(id) {
        var act = production().acts.filter(function (a) { return a.id === id; })[0];
        if (!act) return;
        openModal({
            title: t('Act'),
            body: '<div class="sp-field"><label for="spActName">' + esc(t('Name')) + '</label>' +
                '<input type="text" id="spActName" value="' + esc(act.name) + '" placeholder="' +
                esc(actName(act)) + '"></div>' +
                '<div class="sp-field"><label for="spActNotes">' + esc(t('Notes for the divider page')) + '</label>' +
                '<textarea id="spActNotes">' + esc(act.notes || '') + '</textarea></div>',
            actions: [
                {
                    label: t('Delete the act'), danger: true,
                    onClick: function () {
                        change(function () {
                            var p = production();
                            p.acts = p.acts.filter(function (a) { return a.id !== id; });
                            p.scenes.forEach(function (s) { if (s.actId === id) s.actId = null; });
                        });
                    }
                },
                {
                    label: t('Save'), primary: true,
                    onClick: function (body) {
                        change(function () {
                            act.name = $('#spActName', body).value.trim();
                            act.notes = $('#spActNotes', body).value;
                        });
                    }
                }
            ]
        });
    }

    /* Der angezeigte Name eines Akts: der eigene, sonst seine Stelle im
       Ablauf. Positionell, damit sich beim Anlegen und Löschen nichts
       Falsches festsetzt. */
    function actName(act) {
        if (!act) return '';
        if (act.name) return act.name;
        var index = production().acts.indexOf(act) + 1;
        return t('Act {n}', { n: SP.roman(index || 1) });
    }

    /*
     * Legt einen Akt an, der bei der aktuellen Szene beginnt. Akte, die
     * dabei leer zurückbleiben, verschwinden — sonst sammeln sich unsichtbare
     * Akte an und die sichtbaren scheinen sich umzubenennen.
     */
    function addAct() {
        var moved = 0;
        change(function () {
            var p = production();
            var act = { id: SP.uid('act'), name: '', notes: '' };
            p.acts.push(act);
            var current = scene();
            if (current) {
                var from = p.scenes.indexOf(current);
                for (var i = from; i < p.scenes.length; i++) {
                    p.scenes[i].actId = act.id;
                    moved += 1;
                }
            }
            var alive = {};
            p.scenes.forEach(function (sc) { if (sc.actId) alive[sc.actId] = true; });
            p.acts = p.acts.filter(function (a) { return alive[a.id] || a === act; });
        });
        toast(moved
            ? SPI18n.plural(moved, 'Act added, with 1 scene in it.', 'Act added, with {n} scenes in it.')
            : t('Act added. It is empty for now.'), 'success');
    }

    /* ================================================================== *
     * Stage tab
     * ================================================================== */

    var FIELD_LABELS = {
        width: t('Width, wall to wall'),
        depth: t('Depth, back wall to setting line'),
        backWidth: t('Width at the back'),
        diameter: t('Diameter'),
        sides: t('Number of sides'),
        apronWidth: t('Apron width'),
        apronDepth: t('Apron depth')
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
            ? t('Stage for scene {label}', { label: numbers[sc.id].label })
            : t('The stage');
        $('#spStageIntro').textContent = isScene
            ? t('This scene has been given a stage of its own. Every other scene keeps the production stage.')
            : t('Set the playing area once and every scene inherits it. A single scene can be given a stage of its own on the Scene panel if the set changes shape at the interval.');

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
                '<strong style="font-weight:500">' + esc(t(shape.name)) + '</strong><br>' +
                '<span style="color:var(--sp-muted); font-size:0.7rem">' + esc(t(shape.blurb)) + '</span></button>';
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
                '<input type="text" value="' + esc(c.name) + '" data-curtain="' + esc(c.id) + '" data-curtain-field="name" aria-label="' + esc(t('Curtain name')) + '">' +
                '<input type="number" step="0.1" min="0" value="' + toField(SP.num(c.offset, 0)) +
                '" data-curtain="' + esc(c.id) + '" data-curtain-field="offset" aria-label="' + esc(t('Distance upstage')) + '">' +
                '<select data-curtain="' + esc(c.id) + '" data-curtain-field="state" aria-label="' + esc(t('Normally')) + '">' +
                ['closed', 'half', 'open'].map(function (opt) {
                    return '<option value="' + opt + '"' + ((c.state || 'closed') === opt ? ' selected' : '') + '>' +
                        esc(curtainStateLabel(opt)) + '</option>';
                }).join('') + '</select>' +
                '<button class="sp-btn is-quiet is-danger" data-act="remove-curtain" data-id="' + esc(c.id) + '">&times;</button>' +
                '</div>';
        }).join('');

        $('#spStageSide').innerHTML =
            '<div class="sp-section"><h3>' + esc(t('Measurements')) + why('stage.width') + '</h3>' +
            '<div class="' + (shape.fields.length > 2 ? 'sp-field-row' : 'sp-field-row') + '">' + dimensionFields + '</div>' +
            '<p class="sp-hint" style="margin-top:0.5rem">' +
            esc(t('The playing area comes out {w} across by {h} deep.', {
                w: SP.formatLength(SP.stageOutline(stage).bounds.w, units()),
                h: SP.formatLength(SP.stageOutline(stage).bounds.h, units())
            })) + '</p></div>' +

            '<div class="sp-section"><h3>' + esc(t('Grid')) + '</h3>' +
            '<div class="sp-check-row"><label class="sp-check"><input type="checkbox" data-stage-flag="grid.show"' +
            (stage.grid.show ? ' checked' : '') + '> ' + esc(t('Draw a grid on the floor')) + '</label>' + why('stage.grid.show') + '</div>' +
            '<div class="sp-check-row"><label class="sp-check"><input type="checkbox" data-stage-flag="grid.labels"' +
            (stage.grid.labels ? ' checked' : '') + '> ' + esc(t('Letter and number the squares')) + '</label>' + why('stage.grid.labels') + '</div>' +
            '<div class="sp-field" style="margin-top:0.5rem"><label for="spGridSpacing">' +
            esc(t('Squares are ({unit})', { unit: lengthLabel() })) + why('stage.grid.spacing') +
            '</label><input type="number" id="spGridSpacing" step="0.25" min="0.25" ' +
            'data-stage-field="grid.spacing" value="' + toField(SP.num(stage.grid.spacing, 1)) + '"></div>' +
            '<p class="sp-hint">' + esc(t('Lettered squares give the crew something to call out: “the trunk goes in C4”.')) + '</p>' + '</div>' +

            '<div class="sp-section"><h3>' + esc(t('Guides')) + '</h3>' +
            '<div class="sp-check-row"><label class="sp-check"><input type="checkbox" data-stage-flag="centreLine"' +
            (stage.centreLine ? ' checked' : '') + '> ' + esc(t('Centre line')) + '</label>' + why('stage.centreLine') + '</div>' +
            '<div class="sp-check-row"><label class="sp-check"><input type="checkbox" data-stage-flag="settingLine"' +
            (stage.settingLine ? ' checked' : '') + '> ' + esc(t('Setting line')) + '</label>' + why('stage.settingLine') + '</div>' +
            '<label class="sp-check"><input type="checkbox" data-stage-flag="scaleBar"' +
            (stage.scaleBar ? ' checked' : '') + '> ' + esc(t('Scale bar')) + '</label></div>' +

            '<div class="sp-section"><h3>' + esc(t('Wings')) + why('stage.wings') + '</h3>' +
            '<div class="sp-check-row"><label class="sp-check"><input type="checkbox" data-stage-flag="wings.show"' +
            (stage.wings.show ? ' checked' : '') + '> ' + esc(t('Mark the wings')) + '</label></div>' +
            (stage.wings.show ? '<div class="sp-field-row" style="margin-top:0.5rem">' +
                '<div><label for="spWingInset">' + esc(t('Inset from the side')) +
                ' (' + esc(lengthLabel()) + ')</label>' +
                '<input type="number" id="spWingInset" step="0.1" min="0.05" data-stage-number="wings.inset" value="' +
                toField(stage.wings.inset, 2) + '"></div>' +
                '<div><label for="spWingDepth">' + esc(t('How far forward')) +
                ' (' + esc(lengthLabel()) + ')</label>' +
                '<input type="number" id="spWingDepth" step="0.1" min="0.05" data-stage-number="wings.depth" value="' +
                toField(stage.wings.depth, 2) + '"></div></div>' : '') +
            '</div>' +

            '<div class="sp-section"><h3>' + esc(t('Curtains')) + why('stage.curtains') + '</h3>' +
            (curtains ? '<div style="margin-bottom:0.5rem"><div class="sp-curtain-row" style="font-size:0.7rem;color:var(--sp-muted)">' +
                '<span>' + esc(t('Name')) + '</span><span>' + esc(t('Upstage ({unit})', { unit: lengthLabel() })) + '</span><span>' + esc(t('Normally')) + '</span><span></span></div>' +
                curtains + '</div>' : '<p class="sp-hint">' + esc(t('No curtain marked.')) + '</p>') +
            '<div class="sp-btn-row"><button class="sp-btn" data-act="add-curtain">' + esc(t('Add a curtain')) + '</button></div>' +
            '<p class="sp-hint" style="margin-top:0.5rem">Measured upstage from the setting line. Each scene can ' +
            'open or close them on its own.</p></div>' +

            '<div class="sp-section"><h3>' + esc(t('This production')) + '</h3>' +
            '<div class="sp-field"><label for="spUnits">' + esc(t('Measure in')) + '</label>' +
            '<select id="spUnits" data-bind="prod.units">' +
            '<option value="m"' + (units() === 'm' ? ' selected' : '') + '>' + esc(t('Metres')) + '</option>' +
            '<option value="ft"' + (units() === 'ft' ? ' selected' : '') + '>' + esc(t('Feet and inches')) + '</option></select></div>' +
            (isScene ? '<div class="sp-btn-row"><button class="sp-btn" data-act="drop-scene-stage">' +
                esc(t('Use the production stage for this scene')) + '</button></div>' : '') +
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
                : '<svg viewBox="0 0 100 100" class="sp-plan"><g class="sp-art" stroke-width="' + (4 * (prop.sw || 1)) + '">' + prop.art + '</g></svg>';
            return '<div class="sp-lib-card">' +
                (prop.builtin ? '' : '<span class="sp-lib-tools">' +
                    '<button class="sp-btn is-quiet" data-act="edit-prop" data-prop="' + esc(prop.id) + '">' + esc(t('Edit')) + '</button>' +
                    '<button class="sp-btn is-quiet is-danger" data-act="delete-prop" data-prop="' + esc(prop.id) + '">&times;</button>' +
                    '</span>') +
                art +
                '<div>' + esc(t(prop.name)) + '</div>' +
                '<div class="sp-lib-meta">' + toField(prop.w, 2) + ' × ' + toField(prop.h, 2) + ' ' + lengthLabel() +
                (prop.builtin ? '' : ' · <span class="sp-badge">' + esc(t('yours')) + '</span>') + '</div>' +
                '<div class="sp-lib-meta">' + (uses ? t('used {n}×', { n: uses }) : t('not used yet')) + '</div>' +
                '</div>';
        }).join('') : '<p class="sp-empty">' + esc(t('Nothing matches that search.')) + '</p>';

        var customCount = db.library.length;
        var bytes = storageBytes();
        $('#spLibrarySide').innerHTML =
            '<div class="sp-section"><h3>' + esc(t('Your own props')) + '</h3>' +
            '<p class="sp-hint">' + esc(customCount
                ? SPI18n.plural(customCount,
                    '1 drawing added. It sits alongside the built-in ones in every production in this browser.',
                    '{n} drawings added. They sit alongside the built-in ones in every production in this browser.')
                : t('Nothing added yet. A PNG, JPEG or SVG works. It gets scaled down and kept in this browser.')) +
            '</p><div class="sp-btn-row"><button class="sp-btn is-primary" data-act="draw-custom-prop">' +
            esc(t('Draw one yourself')) + '</button>' + why('draw.open') +
            '<button class="sp-btn" data-act="add-custom-prop">' + esc(t('Add a prop')) + '</button></div></div>' +

            '<div class="sp-section"><h3>' + esc(t('Drawing your own')) + '</h3>' +
            '<p class="sp-hint">' + esc(t('Plan views read best: draw the prop as if looking straight down at the stage, on a square canvas, with a transparent background. Give it the real footprint in the size fields and it will land on the plan at the right scale.')) + '</p>' + '</div>' +

            '<div class="sp-section"><h3>' + esc(t('Browser storage')) + '</h3>' +
            '<p class="sp-hint">' + esc(t('Everything you have made takes about {size}. Browsers usually stop somewhere around 5 MB, so keep custom drawings small and take a backup from time to time.', { size: formatBytes(bytes) })) + '</p>' +
            '<div class="sp-btn-row"><button class="sp-btn" data-act="export-json">' + esc(t('Export a backup')) + '</button>' +
            '<button class="sp-btn" data-act="import-json">' + esc(t('Restore from a backup')) + '</button></div></div>';
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
            id: SP.uid('prop'), name: '', cat: 'Small props', w: 1, h: 1, image: null, tags: ''
        };
        var cats = SPProps.CATEGORIES;

        var modal = openModal({
            title: existing ? t('Edit prop') : t('Add a prop of your own'),
            body: '<div class="sp-field"><label for="spPropName">' + esc(t('Name')) + '</label>' +
                '<input type="text" id="spPropName" value="' + esc(draft.name) + '" placeholder="' + esc(t('Grandfather clock')) + '"></div>' +
                '<div class="sp-field"><label for="spPropCat">' + esc(t('Category')) + '</label><select id="spPropCat">' +
                cats.map(function (c) {
                    return '<option value="' + esc(c) + '"' + (draft.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>';
                }).join('') + '</select></div>' +
                '<div class="sp-field-row">' +
                '<div><label for="spPropW">' + esc(t('Across ({unit})', { unit: lengthLabel() })) + '</label>' +
                '<input type="number" id="spPropW" step="0.05" min="0.05" value="' + toField(draft.w) + '"></div>' +
                '<div><label for="spPropH">' + esc(t('Deep ({unit})', { unit: lengthLabel() })) + '</label>' +
                '<input type="number" id="spPropH" step="0.05" min="0.05" value="' + toField(draft.h) + '"></div>' +
                '</div>' +
                '<div class="sp-field"><label for="spPropFile">' + esc(t('Drawing (PNG, JPEG or SVG)')) + '</label>' +
                '<input type="file" id="spPropFile" accept="image/png,image/jpeg,image/svg+xml,image/webp"></div>' +
                '<div id="spPropPreview" style="text-align:center;min-height:90px;border:1px solid var(--sp-line);' +
                'border-radius:3px;padding:0.5rem;background:var(--sp-field)">' +
                (draft.image ? '<img src="' + esc(draft.image) + '" style="max-height:90px">' :
                    '<span class="sp-hint">' + esc(t('No drawing chosen yet')) + '</span>') + '</div>' +
                '<p class="sp-hint" style="margin-top:0.6rem">' + esc(t('Pictures are scaled down to 480 pixels and stored in this browser. A transparent background keeps the plan readable.')) + '</p>',
            actions: [{
                label: existing ? t('Save') : t('Add it'), primary: true,
                onClick: function (body) {
                    var name = $('#spPropName', body).value.trim();
                    if (!name) { toast(t('Give the prop a name.')); return false; }
                    if (!draft.image) { toast(t('Choose a drawing first.')); return false; }
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
                if (!dataUrl) { toast(t('That file could not be read as a picture.'), 'error'); return; }
                draft.image = dataUrl;
                $('#spPropPreview', modal.body).innerHTML = '<img src="' + esc(dataUrl) + '" style="max-height:90px">';
            });
        });
    }

    function deleteCustomProp(id) {
        var uses = usageCount(id);
        var message = uses
            ? t('This prop is used {n} times in this production. Deleting it leaves those places empty. Carry on?', { n: uses })
            : t('Delete this prop?');
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
     * Requisiten-Zeichner
     *
     * Ein hochgeladenes Bild bleibt ein Bild: es franst aus, wenn der Plan
     * groß gedruckt wird, und es kennt weder die getönte Fläche noch die
     * Strichelung, mit der die eingebauten Symbole erzählen, was fest steht
     * und was nur schwingt. Wer sein Requisit hier zusammensetzt, bekommt
     * dasselbe Markup wie die eingebauten Zeichnungen — und damit denselben
     * Strich auf dem Papier.
     *
     * Der Zustand hängt bewusst nicht am db: eine abgebrochene Zeichnung soll
     * nichts hinterlassen und in keinem Rückgängig-Schritt auftauchen.
     * ================================================================== */

    var DRAW_STEP = 5;                /* Rasterweite im 100er-Quadrat */
    var DRAW_HANDLE = 3;              /* Kantenlänge eines Griffs, dieselben Einheiten */
    var DRAW_CLOSE = 5;               /* wie nah an den Anfangspunkt zum Schließen */
    var DRAW_HANDLES = [
        { id: 'nw', fx: 0, fy: 0 }, { id: 'n', fx: 0.5, fy: 0 }, { id: 'ne', fx: 1, fy: 0 },
        { id: 'e', fx: 1, fy: 0.5 }, { id: 'se', fx: 1, fy: 1 }, { id: 's', fx: 0.5, fy: 1 },
        { id: 'sw', fx: 0, fy: 1 }, { id: 'w', fx: 0, fy: 0.5 }
    ];

    var draw = null;

    function drawSnap(value) {
        var v = SPDraw.clamp(value);
        return draw.snap ? Math.round(v / DRAW_STEP) * DRAW_STEP : SPDraw.round(v);
    }

    /* Zeigerposition im 100er-Quadrat. preserveAspectRatio="none" auf der
       Fläche macht die Umrechnung linear, auch wenn sie einmal nicht ganz
       quadratisch ausfällt. */
    function drawPoint(e) {
        var box = $('#spDrawBoard', draw.body).getBoundingClientRect();
        return [
            drawSnap((e.clientX - box.left) / box.width * 100),
            drawSnap((e.clientY - box.top) / box.height * 100)
        ];
    }

    function drawRemember() {
        draw.undo.push(JSON.stringify(draw.shapes));
        if (draw.undo.length > 60) draw.undo.shift();
        draw.redo.length = 0;
    }

    function drawStepBack(from, to) {
        if (!from.length) return;
        to.push(JSON.stringify(draw.shapes));
        draw.shapes = JSON.parse(from.pop());
        draw.run = null;
        draw.cursor = null;
        if (draw.sel >= draw.shapes.length) draw.sel = draw.shapes.length - 1;
        drawRender();
    }

    function drawSelected() {
        return draw.sel >= 0 ? draw.shapes[draw.sel] || null : null;
    }

    /* Ein Zug mit dem Zeiger, von einer Ecke zur anderen. */
    function drawFromDrag(a, b, kind) {
        if (kind === 'ellipse') {
            return SPDraw.normalise({
                k: 'ellipse', m: draw.mode,
                cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2,
                rx: Math.abs(b[0] - a[0]) / 2, ry: Math.abs(b[1] - a[1]) / 2
            });
        }
        if (kind === 'line') {
            return SPDraw.normalise({ k: 'line', m: draw.mode, x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
        }
        return SPDraw.normalise({
            k: 'rect', m: draw.mode,
            x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]),
            w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]), r: 0
        });
    }

    /* Welche Kanten ein Griff verschiebt. Die Buchstaben stehen für die
       Himmelsrichtungen des Rahmens, 'nw' fasst also zwei Kanten an. */
    function drawResizeBox(box, handle, dx, dy) {
        var x = box.x, y = box.y, w = box.w, h = box.h;
        if (handle.indexOf('w') !== -1) { x = box.x + dx; w = box.w - dx; }
        if (handle.indexOf('e') !== -1) { w = box.w + dx; }
        if (handle.indexOf('n') !== -1) { y = box.y + dy; h = box.h - dy; }
        if (handle.indexOf('s') !== -1) { h = box.h + dy; }
        return { x: x, y: y, w: Math.max(1, w), h: Math.max(1, h) };
    }

    /* -------------------------------------------------------- die Fläche */

    function drawBoardMarkup() {
        var minor = [];
        var major = [];
        for (var v = DRAW_STEP; v < 100; v += DRAW_STEP) {
            var into = (v % 25 === 0) ? major : minor;
            into.push('M' + v + ' 0 V100', 'M0 ' + v + ' H100');
        }

        var parts = [
            '<path class="sp-draw-grid" d="' + minor.join(' ') + '" stroke-width="0.25"/>',
            '<path class="sp-draw-grid-major" d="' + major.join(' ') + '" stroke-width="0.4"/>',
            '<rect class="sp-draw-frame" x="0" y="0" width="100" height="100" stroke-width="0.5"/>',
            /* Dieselbe Strichstärke wie die eingebauten Zeichnungen, nur
               kleiner: hier wird gezeichnet, gewogen wird in der Vorschau. */
            '<g class="sp-art" stroke-width="0.75">' + SPDraw.markup(draw.shapes) + '</g>'
        ];

        parts.push(draw.shapes.map(function (shape, i) {
            return '<g data-i="' + i + '">' + SPDraw.shapeMarkup(shape, 'sp-draw-hit') + '</g>';
        }).join(''));

        if (draw.run) {
            var pts = draw.run.pts.concat(draw.cursor ? [draw.cursor] : []);
            if (pts.length > 1) {
                parts.push('<path class="sp-draw-ink" d="M' + pts.map(function (p) {
                    return p[0] + ' ' + p[1];
                }).join(' L') + (draw.run.k === 'polygon' && pts.length > 2 ? ' Z' : '') + '"/>');
            }
            parts.push(draw.run.pts.map(function (p) {
                return '<circle class="sp-draw-node" cx="' + p[0] + '" cy="' + p[1] + '" r="1.2"/>';
            }).join(''));
        } else if (drawSelected()) {
            var b = SPDraw.bounds(drawSelected());
            parts.push('<rect class="sp-draw-sel" x="' + (b.x - 1) + '" y="' + (b.y - 1) +
                '" width="' + (b.w + 2) + '" height="' + (b.h + 2) + '"/>');
            parts.push(DRAW_HANDLES.map(function (h) {
                return '<rect class="sp-draw-handle" data-handle="' + h.id +
                    '" x="' + (b.x + b.w * h.fx - DRAW_HANDLE / 2) +
                    '" y="' + (b.y + b.h * h.fy - DRAW_HANDLE / 2) +
                    '" width="' + DRAW_HANDLE + '" height="' + DRAW_HANDLE + '"/>';
            }).join(''));
        }

        return parts.join('');
    }

    /* Die Zeichnung als Requisit, in Bühnengröße auf einem echten Grundriss.
       Erst hier zeigt sich, ob die Linien bei der wirklichen Größe noch
       auseinanderzuhalten sind. */
    function drawRenderPreview() {
        var host = $('#spDrawPreview', draw.body);
        if (!host) return;
        var w = Math.max(0.05, fromField($('#spDrawW', draw.body).value, 1));
        var h = Math.max(0.05, fromField($('#spDrawH', draw.body).value, 1));
        var prop = { id: 'sp-drawn', name: '', cat: '', w: w, h: h, art: SPDraw.markup(draw.shapes) };
        var stage = Object.assign({}, SP.DEFAULT_STAGE, {
            shape: 'rect',
            width: Math.max(2, SP.round(w * 3.4, 2)),
            depth: Math.max(1.4, SP.round(h * 2.6, 2)),
            grid: { show: true, spacing: Math.max(w, h) < 1.4 ? 0.5 : 1, labels: false },
            centreLine: false, settingLine: false, scaleBar: false,
            wings: { show: false }, curtains: [], markers: []
        });
        host.innerHTML = SPPlan.svg({
            stage: stage,
            scene: { placements: [SP.makePlacement(prop, 0, stage.depth / 2)], curtains: {} },
            resolve: function () { return prop; },
            units: units(), labels: 'none', idPrefix: 'spdrawn',
            centreLine: false, settingLine: false, wings: false,
            curtains: false, audience: false, scaleBar: false,
            ariaLabel: t('On the plan')
        });
    }

    function drawRender() {
        var board = $('#spDrawBoard svg', draw.body);
        if (!board) return;
        board.innerHTML = drawBoardMarkup();

        var shape = drawSelected();
        var isRun = draw.tool === 'polyline' || draw.tool === 'polygon';

        $$('#spDrawTools button', draw.body).forEach(function (btn) {
            btn.setAttribute('aria-checked', btn.dataset.drawTool === draw.tool ? 'true' : 'false');
        });
        $$('#spDrawModes button', draw.body).forEach(function (btn) {
            var active = (shape ? shape.m : draw.mode) === btn.dataset.drawMode;
            btn.setAttribute('aria-checked', active ? 'true' : 'false');
        });

        var radius = $('#spDrawRadiusField', draw.body);
        radius.hidden = !shape || shape.k !== 'rect';
        if (!radius.hidden && document.activeElement !== $('#spDrawRadius', draw.body)) {
            $('#spDrawRadius', draw.body).value = String(shape.r || 0);
        }

        ['front', 'back', 'delete'].forEach(function (name) {
            $('[data-draw="' + name + '"]', draw.body).disabled = !shape;
        });
        $('[data-draw="undo"]', draw.body).disabled = !draw.undo.length;
        $('[data-draw="redo"]', draw.body).disabled = !draw.redo.length;
        $('[data-draw="finish"]', draw.body).hidden = !draw.run;
        $('[data-draw="snap"]', draw.body).classList.toggle('is-on', draw.snap);
        $('#spDrawBoard', draw.body).classList.toggle('is-drawing', draw.tool !== 'select');

        var count = SPDraw.clean(draw.shapes).length;
        $('#spDrawCount', draw.body).textContent = count
            ? SPI18n.plural(count, '1 shape', '{n} shapes') : '';
        $('#spDrawHint', draw.body).textContent = isRun
            ? t('Click each corner. Double-click, or press Enter, to finish the run.')
            : (count ? t('Drag across the square to draw. Pick a shape to move or resize it.')
                : t('Nothing drawn yet. Pick a tool above and drag across the square.'));

        drawRenderPreview();
    }

    /* ------------------------------------------------------------- Zeiger */

    function drawPointerDown(e) {
        var board = $('#spDrawBoard', draw.body);
        var pt = drawPoint(e);
        board.focus();

        if (draw.tool === 'polyline' || draw.tool === 'polygon') {
            if (!draw.run) draw.run = { k: draw.tool, pts: [] };
            var first = draw.run.pts[0];
            /* Zurück auf den Anfangspunkt schließt den Umriss — dieselbe
               Geste wie in jedem anderen Zeichenprogramm. */
            if (first && draw.run.k === 'polygon' && draw.run.pts.length >= 3 &&
                Math.abs(first[0] - pt[0]) <= DRAW_CLOSE && Math.abs(first[1] - pt[1]) <= DRAW_CLOSE) {
                drawFinishRun();
                return;
            }
            draw.run.pts.push(pt);
            draw.cursor = pt;
            drawRender();
            return;
        }

        if (draw.tool === 'select') {
            var handle = e.target.closest('[data-handle]');
            if (handle && drawSelected()) {
                drawRemember();
                draw.drag = {
                    type: 'resize', handle: handle.dataset.handle, from: pt,
                    box: SPDraw.bounds(drawSelected()), base: drawSelected()
                };
                board.setPointerCapture(e.pointerId);
                return;
            }
            var hit = e.target.closest('[data-i]');
            if (hit) {
                draw.sel = Number(hit.dataset.i);
                drawRemember();
                draw.drag = { type: 'move', from: pt, base: draw.shapes[draw.sel] };
                board.setPointerCapture(e.pointerId);
                drawRender();
                return;
            }
            draw.sel = -1;
            drawRender();
            return;
        }

        drawRemember();
        draw.shapes.push(drawFromDrag(pt, pt, draw.tool));
        draw.sel = draw.shapes.length - 1;
        draw.drag = { type: 'draw', k: draw.tool, from: pt };
        board.setPointerCapture(e.pointerId);
        drawRender();
    }

    function drawPointerMove(e) {
        if (draw.run) { draw.cursor = drawPoint(e); drawRender(); return; }
        if (!draw.drag) return;
        var pt = drawPoint(e);
        var dx = pt[0] - draw.drag.from[0];
        var dy = pt[1] - draw.drag.from[1];

        if (draw.drag.type === 'draw') {
            draw.shapes[draw.sel] = drawFromDrag(draw.drag.from, pt, draw.drag.k);
        } else if (draw.drag.type === 'move') {
            draw.shapes[draw.sel] = SPDraw.moveBy(draw.drag.base, dx, dy);
        } else {
            draw.shapes[draw.sel] = SPDraw.setBounds(draw.drag.base,
                drawResizeBox(draw.drag.box, draw.drag.handle, dx, dy));
        }
        drawRender();
    }

    function drawPointerUp() {
        if (!draw.drag) return;
        var gesture = draw.drag;
        draw.drag = null;
        /* Ein Klick ohne Ziehen darf keine unsichtbare Form hinterlassen —
           sonst sammeln sich Nullflächen, die niemand wieder findet. */
        if (gesture.type === 'draw' && !SPDraw.isDrawable(draw.shapes[draw.sel])) {
            draw.shapes.splice(draw.sel, 1);
            draw.sel = -1;
            draw.undo.pop();
        }
        drawRender();
    }

    function drawFinishRun() {
        if (!draw.run) return;
        var run = draw.run;
        draw.run = null;
        draw.cursor = null;
        var shape = SPDraw.normalise({ k: run.k, m: draw.mode, pts: run.pts });
        if (SPDraw.isDrawable(shape)) {
            drawRemember();
            draw.shapes.push(shape);
            draw.sel = draw.shapes.length - 1;
        }
        drawRender();
    }

    function drawSetMode(mode) {
        draw.mode = mode;
        var shape = drawSelected();
        if (shape) {
            drawRemember();
            shape.m = mode;
        }
        drawRender();
    }

    function drawReorder(toFront) {
        var shape = drawSelected();
        if (!shape) return;
        drawRemember();
        draw.shapes.splice(draw.sel, 1);
        if (toFront) { draw.shapes.push(shape); draw.sel = draw.shapes.length - 1; }
        else { draw.shapes.unshift(shape); draw.sel = 0; }
        drawRender();
    }

    function drawDeleteShape() {
        if (!drawSelected()) return;
        drawRemember();
        draw.shapes.splice(draw.sel, 1);
        draw.sel = -1;
        drawRender();
    }

    function drawCommand(name) {
        switch (name) {
        case 'snap': draw.snap = !draw.snap; drawRender(); break;
        case 'undo': drawStepBack(draw.undo, draw.redo); break;
        case 'redo': drawStepBack(draw.redo, draw.undo); break;
        case 'front': drawReorder(true); break;
        case 'back': drawReorder(false); break;
        case 'delete': drawDeleteShape(); break;
        case 'finish': drawFinishRun(); break;
        default: break;
        }
    }

    /* ------------------------------------------------------------- Dialog */

    function drawPropDialog(existing) {
        var cats = SPProps.CATEGORIES;
        var start = existing || { name: '', cat: 'Small props', w: 1, h: 1, tags: '' };
        var orphan = !!(existing && existing.art && !(existing.draft || []).length);

        var body =
            '<div class="sp-draw">' +
            '<div class="sp-draw-main">' +
            '<div class="sp-draw-bar">' +
            '<div class="sp-seg" id="spDrawTools" role="radiogroup" aria-label="' + esc(t('Drawing tools')) + '">' +
            SPDraw.TOOLS.map(function (tool) {
                return '<button type="button" role="radio" aria-checked="false" data-draw-tool="' +
                    esc(tool.id) + '">' + esc(t(tool.label)) + '</button>';
            }).join('') + '</div>' + why('draw.tools') +
            '<span class="sp-sep"></span>' +
            '<button type="button" class="sp-btn" data-draw="snap">' + esc(t('Snap to the grid')) + '</button>' +
            why('draw.snap') +
            '<button type="button" class="sp-btn is-quiet" data-draw="undo">' + esc(t('Undo')) + '</button>' +
            '<button type="button" class="sp-btn is-quiet" data-draw="redo">' + esc(t('Redo')) + '</button>' +
            '<button type="button" class="sp-btn" data-draw="finish" hidden>' + esc(t('Finish this run')) + '</button>' +
            '</div>' +
            '<div class="sp-draw-board" id="spDrawBoard" tabindex="0" role="application" ' +
            'aria-label="' + esc(t('Draw your own prop')) + '" aria-describedby="spDrawHint">' +
            '<svg class="sp-plan" viewBox="0 0 100 100" preserveAspectRatio="none" ' +
            'xmlns="http://www.w3.org/2000/svg"></svg></div>' +
            '<p class="sp-hint" style="margin-top:0.5rem"><span id="spDrawHint"></span> ' +
            '<span class="sp-draw-count" id="spDrawCount"></span></p>' +
            (orphan ? '<p class="sp-hint">' + esc(t('The old drawing cannot be taken apart again. Draw it afresh, or close this and leave it as it is.')) + '</p>' : '') +
            '</div>' +

            '<div class="sp-draw-side">' +
            '<div class="sp-section"><h3>' + esc(t('Line and area')) + why('draw.paint') + '</h3>' +
            '<div class="sp-seg" id="spDrawModes" role="radiogroup" aria-label="' + esc(t('Line and area')) + '">' +
            SPDraw.MODES.map(function (mode) {
                return '<button type="button" role="radio" aria-checked="false" data-draw-mode="' +
                    esc(mode.id) + '">' + esc(t(mode.label)) + '</button>';
            }).join('') + '</div>' +
            '<div class="sp-field" id="spDrawRadiusField" style="margin-top:0.6rem" hidden>' +
            '<label for="spDrawRadius">' + esc(t('Rounded corners')) + why('draw.radius') + '</label>' +
            '<input type="range" id="spDrawRadius" min="0" max="50" step="1" value="0"></div>' +
            '<div class="sp-btn-row" style="margin-top:0.6rem">' +
            '<button type="button" class="sp-btn is-quiet" data-draw="front">' + esc(t('Bring to front')) + '</button>' +
            '<button type="button" class="sp-btn is-quiet" data-draw="back">' + esc(t('Send to back')) + '</button>' +
            why('draw.order') +
            '<button type="button" class="sp-btn is-quiet is-danger" data-draw="delete">' + esc(t('Delete shape')) + '</button>' +
            '</div></div>' +

            '<div class="sp-section"><h3>' + esc(t('On the plan')) + why('draw.preview') + '</h3>' +
            '<div class="sp-draw-preview" id="spDrawPreview"></div></div>' +

            '<div class="sp-section">' +
            '<div class="sp-field"><label for="spDrawName">' + esc(t('Name')) + '</label>' +
            '<input type="text" id="spDrawName" value="' + esc(start.name) + '" placeholder="' +
            esc(t('Grandfather clock')) + '"></div>' +
            '<div class="sp-field"><label for="spDrawCat">' + esc(t('Category')) + '</label>' +
            '<select id="spDrawCat">' + cats.map(function (c) {
                return '<option value="' + esc(c) + '"' + (start.cat === c ? ' selected' : '') +
                    '>' + esc(t(c)) + '</option>';
            }).join('') + '</select></div>' +
            '<div class="sp-field-row">' +
            '<div><label for="spDrawW">' + esc(t('Across ({unit})', { unit: lengthLabel() })) + why('draw.footprint') + '</label>' +
            '<input type="number" id="spDrawW" step="0.05" min="0.05" value="' + toField(start.w) + '"></div>' +
            '<div><label for="spDrawH">' + esc(t('Deep ({unit})', { unit: lengthLabel() })) + '</label>' +
            '<input type="number" id="spDrawH" step="0.05" min="0.05" value="' + toField(start.h) + '"></div>' +
            '</div>' +
            '<div class="sp-field"><label for="spDrawTags">' + esc(t('Search words')) + '</label>' +
            '<input type="text" id="spDrawTags" value="' + esc(start.tags || '') + '" placeholder="' +
            esc(t('chair table wooden')) + '"></div>' +
            '</div></div></div>';

        var modal = openModal({
            title: existing ? t('Edit the drawing') : t('Draw your own prop'),
            modalClass: 'is-draw',
            body: body,
            onClose: function () { draw = null; },
            actions: [{
                label: existing ? t('Save') : t('Add it'),
                primary: true,
                onClick: function (host) {
                    var name = $('#spDrawName', host).value.trim();
                    var shapes = SPDraw.clean(draw.shapes);
                    if (!name) { toast(t('Give the prop a name.'), 'error'); return false; }
                    if (!shapes.length) { toast(t('Draw something first.'), 'error'); return false; }
                    var made = {
                        id: existing ? existing.id : SP.uid('prop'),
                        name: name,
                        cat: $('#spDrawCat', host).value,
                        w: Math.max(0.05, fromField($('#spDrawW', host).value, 1)),
                        h: Math.max(0.05, fromField($('#spDrawH', host).value, 1)),
                        art: SPDraw.markup(shapes),
                        tags: $('#spDrawTags', host).value.trim(),
                        draft: shapes
                    };
                    change(function () {
                        if (existing) {
                            /* War die Requisite vorher ein hochgeladenes Bild,
                               muss es weg — sonst zeichnet der Plan weiter das
                               Bild und nicht die neuen Formen. */
                            delete existing.image;
                            Object.assign(existing, made);
                        } else {
                            db.library.push(made);
                        }
                    });
                }
            }]
        });

        draw = {
            body: modal.body,
            shapes: existing ? SPDraw.clean(existing.draft || []) : [],
            tool: 'rect', mode: 'o', snap: true, sel: -1,
            undo: [], redo: [], drag: null, run: null, cursor: null
        };

        var board = $('#spDrawBoard', modal.body);
        board.addEventListener('pointerdown', drawPointerDown);
        board.addEventListener('pointermove', drawPointerMove);
        board.addEventListener('pointerup', drawPointerUp);
        board.addEventListener('pointercancel', drawPointerUp);
        board.addEventListener('dblclick', function (e) { e.preventDefault(); drawFinishRun(); });

        board.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); drawFinishRun(); return; }
            if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); drawDeleteShape(); return; }
            if (!(e.ctrlKey || e.metaKey)) return;
            var key = e.key.toLowerCase();
            if (key === 'z') { e.preventDefault(); drawCommand(e.shiftKey ? 'redo' : 'undo'); }
            else if (key === 'y') { e.preventDefault(); drawCommand('redo'); }
        });

        modal.body.addEventListener('click', function (e) {
            var tool = e.target.closest('[data-draw-tool]');
            if (tool) {
                /* Werkzeugwechsel bricht einen offenen Zug ab, statt ihn
                   halbfertig weiterlaufen zu lassen. */
                if (draw.run) drawFinishRun();
                draw.tool = tool.dataset.drawTool;
                if (draw.tool !== 'select') draw.sel = -1;
                drawRender();
                return;
            }
            var mode = e.target.closest('[data-draw-mode]');
            if (mode) { drawSetMode(mode.dataset.drawMode); return; }
            var cmd = e.target.closest('[data-draw]');
            if (cmd) drawCommand(cmd.dataset.draw);
        });

        /* Der Regler meldet jeden Pixel. Ein Rückgängig-Schritt entsteht
           deshalb nur beim ersten Schub, nicht bei jedem Zwischenwert. */
        var radiusHeld = false;
        modal.body.addEventListener('input', function (e) {
            if (e.target.id === 'spDrawRadius') {
                var shape = drawSelected();
                if (!shape || shape.k !== 'rect') return;
                if (!radiusHeld) { drawRemember(); radiusHeld = true; }
                draw.shapes[draw.sel] = SPDraw.normalise(
                    Object.assign({}, shape, { r: Number(e.target.value) }));
                drawRender();
                return;
            }
            if (e.target.id === 'spDrawW' || e.target.id === 'spDrawH') drawRenderPreview();
        });
        modal.body.addEventListener('change', function (e) {
            if (e.target.id === 'spDrawRadius') radiusHeld = false;
        });

        drawRender();
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

    /*
     * Zwei Dokumente, zwei Knöpfe. Welches gerade in der Vorschau steht,
     * merkt sich ui.printDoc.
     */
    function printDoc() {
        return ui.printDoc === 'changeover' ? 'changeover' : 'plans';
    }

    function renderPrintTab() {
        var o = printOptions();
        var p = production();
        var doc = printDoc();

        var head =
            '<div class="sp-section" style="padding-left:0;padding-right:0">' +
            '<h2 style="margin-bottom:0.3rem">' + esc(t('Print')) + why('print.docs') + '</h2>' +
            '<p class="sp-hint">' + esc(t('A4 sheets, straight from the browser. Choose “Save as PDF” in the print dialogue if you would rather send a file than carry paper.')) + '</p>' +
            '<div class="sp-doc-switch" role="tablist">' +
            '<button class="sp-doc' + (doc === 'plans' ? ' is-on' : '') + '" data-act="print-doc" data-doc="plans">' +
            '<b>' + esc(t('The plans')) + '</b><span>' + esc(t('Drawings only — one scene to a sheet, the number and the title, nothing to read.')) + '</span></button>' +
            '<button class="sp-doc' + (doc === 'changeover' ? ' is-on' : '') + '" data-act="print-doc" data-doc="changeover">' +
            '<b>' + esc(t('The Umbauplan')) + '</b><span>' + esc(t('The table: what comes off, what goes on and what gets moved between every pair of scenes.')) + '</span></button>' +
            '</div></div>';

        var scope = p.acts.length
            ? '<div class="sp-field"><label>' + esc(t('Which scenes')) + why('print.scope') + '</label>' +
              '<select data-print="scope"><option value="all"' + (o.scope === 'all' ? ' selected' : '') +
              '>' + esc(t('The whole production')) + '</option>' + p.acts.map(function (a) {
                  return '<option value="' + esc(a.id) + '"' + (o.scope === a.id ? ' selected' : '') + '>' +
                      esc(t('{act} only', { act: actName(a) })) + '</option>';
              }).join('') + '</select></div>'
            : '';

        var footer = '<div class="sp-field"><label for="spPrintFooter">' + esc(t('Footer line')) +
            why('print.footer') + '</label><input type="text" id="spPrintFooter" data-print="footer" value="' +
            esc(o.footer || '') + '" placeholder="' + esc(t('Draft 3, please recycle')) + '"></div>';

        var body;
        if (doc === 'changeover') {
            body =
                '<div class="sp-section" style="padding-left:0;padding-right:0"><h3>' +
                esc(t('The Umbauplan')) + '</h3>' + scope +
                printCheck('referenceBox', t('Include the reference box'), o, 'print.referenceBox') +
                printCheck('positions', t('Include positions in the table'), o, 'print.positions') +
                footer + '</div>';
        } else {
            body =
                '<div class="sp-section" style="padding-left:0;padding-right:0"><h3>' + esc(t('Paper')) + '</h3>' +
                '<div class="sp-field"><label>' + esc(t('Paper')) + why('print.orientation') + '</label>' +
                '<select data-print="orientation">' +
                '<option value="portrait"' + (o.orientation === 'portrait' ? ' selected' : '') + '>' +
                esc(t('A4 upright')) + '</option>' +
                '<option value="landscape"' + (o.orientation === 'landscape' ? ' selected' : '') + '>' +
                esc(t('A4 on its side')) + '</option></select></div>' +
                scope + footer + '</div>' +

                '<div class="sp-section" style="padding-left:0;padding-right:0"><h3>' +
                esc(t('Sheets to print')) + '</h3>' +
                printCheck('cover', t('Title sheet'), o, 'print.cover') +
                printCheck('actPages', t('A divider before each act'), o, 'print.actPages') +
                printCheck('scenePages', t('One sheet per scene'), o, 'print.scenePages') +
                printCheck('overview', t('Overview sheets'), o, 'print.overview') +
                printCheck('inventory', t('Prop inventory'), o, 'print.inventory') +
                '</div>' +

                '<div class="sp-section" style="padding-left:0;padding-right:0"><h3>' +
                esc(t('Scene sheets')) + '</h3>' +
                '<div class="sp-field"><label for="spPrintLabels">' + esc(t('Labels on the plan')) +
                why('print.labels') + '</label><select id="spPrintLabels" data-print="labels">' +
                [['name', t('Prop names')], ['custom', t('Written labels only')], ['both', t('Name and label')],
                 ['number', t('Numbers keyed to the list')], ['none', t('No labels')]].map(function (opt) {
                    return '<option value="' + opt[0] + '"' + (o.labels === opt[0] ? ' selected' : '') + '>' +
                        esc(opt[1]) + '</option>';
                }).join('') + '</select></div>' +
                printCheck('showGrid', t('Show the floor grid'), o, 'print.showGrid') +
                printCheck('showWings', t('Mark the wings'), o, 'stage.wings') +
                printCheck('showCurtains', t('Draw the curtains'), o, 'stage.curtains') +
                printCheck('showGuides', t('Centre line and setting line'), o, 'print.showGuides') +
                printCheck('showScaleBar', t('Scale bar'), o, 'stage.scaleBar') +
                printCheck('showAudience', t('Where the audience sits'), o, 'print.showAudience') +
                printCheck('showTitle', t('Title beside the number'), o, 'print.showTitle') +
                printCheck('showPlace', t('Include the place'), o, 'print.showPlace') +
                printCheck('showNotes', t('Include scene notes'), o, 'print.showNotes') +
                printCheck('showFooter', t('Footer on every sheet'), o, 'print.showFooter') +
                printCheck('numberOutside', t('Number only, beside the stage'), o, 'print.numberOutside') +
                '<div class="sp-btn-row" style="margin-top:0.7rem">' +
                '<button class="sp-btn" data-act="print-preset-bare">' +
                esc(t('Set it up like my Umbauplan')) + '</button>' + why('print.presetBare') + '</div>' +
                '<p class="sp-hint">' + esc(t('Landscape, the number large and alone, wings marked, and nothing else on the sheet.')) + '</p>' +
                '</div>' +

                '<div class="sp-section" style="padding-left:0;padding-right:0"><h3>' +
                esc(t('Overview sheets')) + '</h3>' +
                '<div class="sp-field"><label for="spOverviewSize">' + esc(t('Scenes to a sheet')) +
                why('print.overviewSize') + '</label><select id="spOverviewSize" data-act="overview-size">' +
                [[2, 2], [3, 2], [3, 3], [4, 3], [4, 4], [5, 5], [6, 4]].map(function (g) {
                    return '<option value="' + g[0] + 'x' + g[1] + '"' +
                        (o.overviewCols === g[0] && o.overviewRows === g[1] ? ' selected' : '') + '>' +
                        esc(t('{cols} by {rows}, {n} scenes',
                            { cols: g[0], rows: g[1], n: g[0] * g[1] })) + '</option>';
                }).join('') +
                '<option value="custom"' + (isCustomGrid(o) ? ' selected' : '') + '>' +
                esc(t('Something else')) + '</option></select></div>' +
                (isCustomGrid(o) ? '<div class="sp-field-row">' +
                    '<div><label for="spOvCols">' + esc(t('Across')) + '</label>' +
                    '<input type="number" id="spOvCols" min="1" max="8" data-print-number="overviewCols" value="' +
                    o.overviewCols + '"></div>' +
                    '<div><label for="spOvRows">' + esc(t('Down')) + '</label>' +
                    '<input type="number" id="spOvRows" min="1" max="8" data-print-number="overviewRows" value="' +
                    o.overviewRows + '"></div></div>' : '') +
                printCheck('overviewSplitActs', t('Start a fresh sheet for each act'), o, 'print.splitActs') +
                '</div>';
        }

        $('#spPrintOptions').innerHTML = head + body +
            '<div class="sp-section" style="padding-left:0;padding-right:0">' +
            '<div class="sp-btn-row"><button class="sp-btn is-primary" data-act="do-print">' +
            esc(doc === 'changeover' ? t('Print the Umbauplan') : t('Print the plans')) + '</button></div>' +
            '<p class="sp-page-count" id="spPageCount" style="margin-top:0.5rem"></p>' +
            '<p class="sp-hint">' + esc(t('In the print dialogue, set margins to none and turn on background graphics so the plans come out exactly as they look here.')) + '</p></div>';

        renderPrintPreview();
    }

    function isCustomGrid(o) {
        var known = ['2x2', '3x2', '3x3', '4x3', '4x4', '5x5', '6x4'];
        return known.indexOf(o.overviewCols + 'x' + o.overviewRows) === -1;
    }

    /* Kästchen und Fragezeichen in einer Zeile. Getrennt rutschte das "?"
       darunter und zog die Spalte unnötig in die Länge. */
    function printCheck(key, label, o, explainKey) {
        return '<div class="sp-check-row"><label class="sp-check">' +
            '<input type="checkbox" data-print-flag="' + key + '"' +
            (o[key] ? ' checked' : '') + '> ' + esc(label) + '</label>' +
            (explainKey ? why(explainKey) : '') + '</div>';
    }

    function buildSheets() {
        var input = {
            production: production(),
            resolve: resolveProp,
            units: units(),
            options: printOptions()
        };
        return printDoc() === 'changeover'
            ? SPSheets.buildChangeover(input)
            : SPSheets.buildPlans(input);
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
                count.textContent = SPI18n.plural(sheets.length, '1 sheet', '{n} sheets of A4') +
                    (sheets.length > 40 ? t(', which is a thick pile') : '');
            }
            if (!sheets.length) {
                host.innerHTML = '<p class="sp-empty">' + esc(t('Nothing selected to print.')) + '</p>';
                return;
            }
            var landscape = printDoc() === 'plans' && o.orientation === 'landscape';
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
        var landscape = printDoc() === 'plans' && o.orientation === 'landscape';
        style.textContent = '@page { size: A4 ' + (landscape ? 'landscape' : 'portrait') + '; margin: 0; }';

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
        img.onerror = function () { toast(t('The picture could not be made.'), 'error'); };
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
            title: t('Production'),
            body: '<div class="sp-field"><label for="spProdName">' + esc(t('Name')) + '</label>' +
                '<input type="text" id="spProdName" value="' + esc(p.name) + '"></div>' +
                '<div class="sp-field"><label for="spProdSub">' + esc(t('Subtitle')) + '</label>' +
                '<input type="text" id="spProdSub" value="' + esc(p.subtitle || '') +
                '" placeholder="' + esc(t('A play in two acts')) + '"></div>' +
                '<div class="sp-field"><label for="spProdVenue">' + esc(t('Venue')) + '</label>' +
                '<input type="text" id="spProdVenue" value="' + esc(p.venue || '') + '"></div>' +
                '<div class="sp-field"><label for="spProdNotes">' + esc(t('Notes for the title sheet')) + '</label>' +
                '<textarea id="spProdNotes">' + esc(p.notes || '') + '</textarea></div>' +
                '<div class="sp-field"><label for="spNumbering">' + esc(t('Number the scenes')) +
                why('scene.numbering') + '</label>' +
                '<select id="spNumbering">' +
                [['continuous', t('Straight through, 1 to the end')],
                 ['per-act', t('Restart in each act, as II.3')],
                 ['per-act-roman', t('Restart in each act, roman (I.I, I.II …)')]].map(function (opt) {
                    return '<option value="' + opt[0] + '"' +
                        (p.numbering === opt[0] ? ' selected' : '') + '>' + esc(opt[1]) + '</option>';
                }).join('') + '</select></div>' +
                '<div class="sp-field"><label for="spProdDirections">' + esc(t('Directions as seen by')) +
                why('stage.directions') + '</label>' +
                '<select id="spProdDirections"><option value="audience"' +
                (p.directions === 'cast' ? '' : ' selected') + '>' + esc(t('the audience')) + '</option>' +
                '<option value="cast"' + (p.directions === 'cast' ? ' selected' : '') + '>' +
                esc(t('the cast')) + '</option></select></div>' +
                '<div class="sp-btn-row" style="margin-top:1rem">' +
                '<button class="sp-btn" data-act="run-setup">' + esc(t('Run the setup again')) + '</button>' +
                '<button class="sp-btn" data-act="new-production">' + esc(t('Start another production')) + '</button>' +
                '<button class="sp-btn" data-act="duplicate-production">' + esc(t('Duplicate this one')) + '</button>' +
                '<button class="sp-btn" data-act="load-example">' + esc(t('Open the example')) + '</button>' +
                '<button class="sp-btn" data-act="export-json">' + esc(t('Export a backup')) + '</button>' +
                '<button class="sp-btn" data-act="import-json">' + esc(t('Restore a backup')) + '</button>' +
                (db.productions.length > 1
                    ? '<button class="sp-btn is-danger" data-act="delete-production">' + esc(t('Delete this production')) + '</button>' : '') +
                '</div>',
            actions: [{
                label: t('Save'), primary: true,
                onClick: function (body) {
                    change(function () {
                        p.name = $('#spProdName', body).value.trim() || t('Untitled production');
                        p.subtitle = $('#spProdSub', body).value;
                        p.venue = $('#spProdVenue', body).value;
                        p.notes = $('#spProdNotes', body).value;
                        p.directions = $('#spProdDirections', body).value;
                        p.numbering = $('#spNumbering', body).value;
                        SP.setDirections(p.directions);
                    });
                }
            }]
        });
    }

    function addProduction(source) {
        change(function () {
            var fresh = source
                ? Object.assign(JSON.parse(JSON.stringify(source)), { id: SP.uid('prod'), name: t('{title} (copy)', { title: source.name }) })
                : newProduction(t('Untitled production'));
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
        if (!window.confirm(t('Delete “{name}” with its {n} scenes?', { name: p.name, n: p.scenes.length }))) return;
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
        toast(t('Example production opened. Delete it whenever you like.'), 'success');
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
        toast(t('Backup saved to your downloads.'), 'success');
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
                    toast(t('That file is not a scene plan.'), 'error');
                    return;
                }
                var incoming = parsed && parsed.data ? parsed.data : parsed;
                if (!incoming || !Array.isArray(incoming.productions)) {
                    toast(t('That file is not a scene plan.'), 'error');
                    return;
                }
                var mode = window.confirm(
                    'Add ' + incoming.productions.length + ' production' +
                    (incoming.productions.length === 1 ? '' : 's') + ' from the backup?\n\n' +
                    t('OK adds them alongside what you have. Cancel replaces everything.'));
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
                toast(t('Backup restored.'), 'success');
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
            $('#spPointerReadout').textContent = t('Turned {n}°', { n: Math.round(target.rot) });
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
            var scaleProp = resolveProp(item.propId);
            if (!e.altKey || SPPlan.keepsAspect(scaleProp)) {
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
        var fit = SPPlan.artTransform(prop, placement.w, placement.h, placement.flip);
        var art = $('.sp-art', node);
        if (art) {
            art.setAttribute('transform', 'scale(' + SP.round(fit.sx, 5) + ' ' + SP.round(fit.sy, 5) +
                ') translate(-50 -50)');
            art.setAttribute('stroke-width', SP.round(plan.unit / fit.unit * (prop.sw || 1), 5));
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
     * Erklärkästen
     *
     * An jeder Einstellung, bei der man sich fragen kann, was sie tut, hängt
     * ein "?". Es öffnet einen kleinen Kasten neben dem Schalter, der sagt,
     * was er auf dem Papier bewirkt. Nichts wird dadurch verstellt.
     * ================================================================== */

    function why(key) {
        if (!SPI18n.explain(key)) return '';
        return '<button type="button" class="sp-why" data-explain="' + esc(key) +
            '" aria-label="' + esc(t('What is this?')) + '">?</button>';
    }

    function closeExplainer() {
        var open = $('.sp-explainer');
        if (open) open.remove();
    }

    function openExplainer(button) {
        var info = SPI18n.explain(button.dataset.explain);
        if (!info) return;
        closeExplainer();

        var box = document.createElement('div');
        box.className = 'sp-explainer';
        box.setAttribute('role', 'dialog');
        box.innerHTML = '<h4>' + esc(info.title) + '</h4><p>' + esc(info.body) + '</p>' +
            '<button type="button" class="sp-explainer-close" data-close-explainer="1" ' +
            'aria-label="' + esc(t('Close')) + '">×</button>';
        document.body.appendChild(box);

        // Neben dem Fragezeichen, aber immer im Fenster.
        var r = button.getBoundingClientRect();
        var w = box.offsetWidth;
        var h = box.offsetHeight;
        var left = Math.min(Math.max(8, r.left - w / 2 + r.width / 2), window.innerWidth - w - 8);
        var top = r.bottom + 8;
        if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
        box.style.left = Math.round(left) + 'px';
        box.style.top = Math.round(top) + 'px';
        box.dataset.for = button.dataset.explain;
    }

    /* ================================================================== *
     * Orte
     * ================================================================== */

    function renderPlacesTab() {
        var p = production();
        var host = $('#spPlaceList');
        if (!host) return;

        if (!p.places.length) {
            host.innerHTML = '<p class="sp-empty">' + esc(t('No places yet.')) + '</p>';
            $('#spPlaceSide').innerHTML = placeSideHelp();
            return;
        }

        var numbers = SP.sceneNumbers(p);
        host.innerHTML = p.places.map(function (place) {
            var used = SP.scenesInPlace(p, place.id);
            var drifting = SP.scenesDriftingFrom(p, place.id);
            var usedText = used.length === 0 ? t('Not used yet')
                : SPI18n.plural(used.length, 'Used in 1 scene', 'Used in {n} scenes');

            var art = (place.placements || []).length
                ? SPPlan.svg({
                    stage: p.stage,
                    scene: { placements: place.placements, curtains: {} },
                    resolve: resolveProp, units: units(),
                    idPrefix: 'place-' + place.id,
                    labels: 'none', grid: false, scaleBar: false, audience: false,
                    settingLine: false, centreLine: false, curtains: false
                })
                : '<p class="sp-empty" style="margin:0">' + esc(t('No set yet')) + '<br>' +
                  '<span class="sp-hint">' + esc(t('Arrange a scene, then update the place from it.')) + '</span></p>';

            var status = !(place.placements || []).length ? ''
                : (drifting.length
                    ? '<span class="sp-place-drift">' +
                      esc(SPI18n.plural(drifting.length, '1 scene differs', '{n} scenes differ')) + ' · ' +
                      esc(drifting.map(function (sc) { return numbers[sc.id].label; }).join(', ')) +
                      '</span>' + why('place.drift')
                    : '<span class="sp-place-ok">' + esc(t('All scenes match')) + '</span>');

            return '<section class="sp-place" data-place="' + esc(place.id) + '">' +
                '<div class="sp-place-head">' +
                '<input type="text" class="sp-place-name" data-place-field="name" ' +
                'data-place="' + esc(place.id) + '" value="' + esc(place.name) + '" ' +
                'placeholder="' + esc(t('Name of the place')) + '">' +
                '<span class="sp-place-count">' + esc(usedText) +
                (used.length ? ' · ' + esc(used.map(function (sc) {
                    return numbers[sc.id].label;
                }).join(', ')) : '') + '</span>' +
                '<button class="sp-btn is-quiet is-danger" data-act="delete-place" ' +
                'data-id="' + esc(place.id) + '">' + esc(t('Delete')) + '</button>' +
                '</div>' +

                '<div class="sp-place-body">' +
                '<div class="sp-place-plan">' + art + '</div>' +
                '<div class="sp-place-side">' +
                '<label class="sp-place-label">' + esc(t('Standing props, in your own words')) +
                why('place.props') + '</label>' +
                '<textarea class="sp-place-props" rows="3" data-place-field="props" ' +
                'data-place="' + esc(place.id) + '" placeholder="' +
                esc(t('Leave empty and the list is read from the set.')) + '">' +
                esc((place.props || []).join('\n')) + '</textarea>' +
                (status ? '<div class="sp-place-status">' + status + '</div>' : '') +
                '</div></div></section>';
        }).join('');

        $('#spPlaceSide').innerHTML = placeSideHelp();
    }

    function placeSideHelp() {
        return ['place.what', 'place.set', 'place.props', 'place.drift'].map(function (key) {
            var info = SPI18n.explain(key);
            return '<div class="sp-section"><h3>' + esc(info.title) + '</h3>' +
                '<p class="sp-hint">' + esc(info.body) + '</p></div>';
        }).join('');
    }

    function addPlace() {
        change(function () {
            production().places.push(SP.newPlace(''));
        });
        setTab('places');
    }

    function deletePlace(id) {
        var p = production();
        var place = SP.placeById(p, id);
        if (!place) return;
        var used = SP.scenesInPlace(p, id);
        if (used.length && !window.confirm(
            t('Delete “{name}”?', { name: place.name || t('Place') }) + '\n' +
            t('Scenes keep their props; they simply lose the place.'))) return;
        change(function () {
            p.places = p.places.filter(function (x) { return x.id !== id; });
            p.scenes.forEach(function (sc) { if (sc.placeId === id) sc.placeId = null; });
        });
    }

    function suggestPlaceProps(id) {
        var lines = SP.suggestPlaceProps(production(), id, function (propId) {
            return t((resolveProp(propId) || { name: t('Unknown prop') }).name);
        });
        var field = $('textarea[data-place-field="props"][data-place="' + id + '"]');
        if (field) {
            field.value = lines.join('\n');
            field.focus();
        }
        change(function () {
            var place = SP.placeById(production(), id);
            if (place) place.props = lines;
        });
    }

    /* ================================================================== *
     * Umbau zwischen zwei Szenen
     * ================================================================== */

    /*
     * Weicht die Szene von ihrem Ort ab? Nur ein Hinweis mit zwei Knöpfen —
     * die Szene wird nie von selbst angeglichen.
     */
    function driftPanel(sc) {
        var drift = SP.placeDrift(production(), sc);
        if (!drift) return '';
        return '<div class="sp-section"><h3>' + esc(t('The set')) + why('place.drift') + '</h3>' +
            (drift.count
                ? '<p class="sp-hint sp-drift"><b>' +
                  esc(SPI18n.plural(drift.count, '1 thing differs from the place',
                      '{n} things differ from the place')) + '</b><br>' +
                  esc(t('The scene always wins — nothing here is changed behind your back.')) + '</p>' +
                  '<div class="sp-btn-row">' +
                  '<button class="sp-btn" data-act="insert-place-set">' +
                  esc(t('Match this scene to the place')) + '</button>' +
                  '<button class="sp-btn" data-act="update-place-set">' +
                  esc(t('Update the place from this scene')) + '</button></div>'
                : '<p class="sp-hint">' + esc(t('This scene matches its place.')) + '</p>') +
            '</div>';
    }

    function transitionPanel(sc) {
        var p = production();
        var prev = previousScene();
        if (!prev) return '';
        var trans = SP.getTransition(p, prev, sc) || { note: '', critical: false, banners: [] };
        var banners = trans.banners || [];

        return '<div class="sp-section"><h3>' + esc(t('Notes for this change')) + why('trans.note') + '</h3>' +
            '<textarea id="spTransNote" data-bound="trans.note" rows="2" placeholder="' +
            esc(t('Hold ready')) + '">' + esc(trans.note || '') + '</textarea>' +
            '<div class="sp-check-row"><label class="sp-check"><input type="checkbox" data-trans-flag="critical"' +
            (trans.critical ? ' checked' : '') + '> ' + esc(t('Mark this change as critical')) +
            '</label>' + why('trans.critical') + '</div>' +
            '<div class="sp-btn-row" style="margin-top:0.6rem">' +
            '<button class="sp-btn is-quiet" data-act="add-banner">' +
            esc(t('Break the table here')) + '</button>' + why('trans.banner') + '</div>' +
            (banners.length ? '<ul class="sp-banner-list">' + banners.map(function (b, i) {
                return '<li><b>' + esc(b.text || '—') + '</b>' +
                    (b.sub ? '<span>' + esc(b.sub) + '</span>' : '') +
                    '<button class="sp-btn is-quiet is-danger" data-act="delete-banner" ' +
                    'data-index="' + i + '">' + esc(t('Delete')) + '</button></li>';
            }).join('') + '</ul>' : '') +
            '</div>';
    }

    /* ------------------------------------------------------ Gassenzettel */

    function wingNotePanel(sc) {
        var stage = stageOf(sc);
        var notes = sc.wingNotes || [];
        var body;

        if (!stage.wings || !stage.wings.show) {
            body = '<p class="sp-hint">' + esc(t('The wings have to be marked on the Stage tab before a note can sit in one.')) + '</p>';
        } else {
            body = (notes.length ? '<ul class="sp-banner-list">' + notes.map(function (note, i) {
                var prop = note.propId ? resolveProp(note.propId) : null;
                return '<li><b>' + esc(note.side === 'left' ? t('Left wing') : t('Right wing')) + '</b>' +
                    '<span>' + esc(note.text || '') + (prop ? ' · ' + esc(t(prop.name)) : '') + '</span>' +
                    '<button class="sp-btn is-quiet is-danger" data-act="delete-wing-note" ' +
                    'data-index="' + i + '">' + esc(t('Delete')) + '</button></li>';
            }).join('') + '</ul>' : '') +
            '<div class="sp-btn-row" style="margin-top:0.5rem">' +
            '<button class="sp-btn" data-act="add-wing-note">' + esc(t('Add a wing note')) + '</button></div>';
        }

        return '<div class="sp-section"><h3>' + esc(t('Wing notes')) + why('scene.wingNotes') + '</h3>' +
            body + '</div>';
    }

    function addWingNoteDialog() {
        var sc = scene();
        if (!sc) return;
        var props = allProps();
        openModal({
            title: t('Add a wing note'),
            body: '<p class="sp-hint" style="margin-bottom:0.7rem">' +
                esc(SPI18n.explain('scene.wingNotes').body) + '</p>' +
                '<div class="sp-field"><label for="spWingText">' + esc(t('What has to be ready')) + '</label>' +
                '<input type="text" id="spWingText" placeholder="' +
                esc(t('Hold ready')) + '"></div>' +
                '<div class="sp-field"><label for="spWingSide">' + esc(t('Which side')) + '</label>' +
                '<select id="spWingSide">' +
                '<option value="right">' + esc(t('Right wing')) + '</option>' +
                '<option value="left">' + esc(t('Left wing')) + '</option></select></div>' +
                '<div class="sp-field"><label for="spWingProp">' + esc(t('Drawing to show')) + '</label>' +
                '<select id="spWingProp"><option value="">' + esc(t('No drawing')) + '</option>' +
                props.map(function (pr) {
                    return '<option value="' + esc(pr.id) + '">' + esc(t(pr.name)) + '</option>';
                }).join('') + '</select></div>',
            actions: [{
                label: t('Apply'), primary: true,
                onClick: function (body) {
                    var text = $('#spWingText', body).value.trim();
                    var propId = $('#spWingProp', body).value;
                    if (!text && !propId) return false;
                    change(function () {
                        if (!sc.wingNotes) sc.wingNotes = [];
                        sc.wingNotes.push({
                            id: SP.uid('wn'),
                            text: text,
                            side: $('#spWingSide', body).value,
                            propId: propId || null
                        });
                    });
                }
            }]
        });
    }

    function addBannerDialog() {
        var sc = scene();
        var prev = previousScene();
        if (!prev) return;
        openModal({
            title: t('Break the table here'),
            body: '<p class="sp-hint" style="margin-bottom:0.7rem">' +
                esc(SPI18n.explain('trans.banner').body) + '</p>' +
                '<div class="sp-field"><label for="spBannerText">' + esc(t('Banner text')) + '</label>' +
                '<input type="text" id="spBannerText" value="' + esc(t('INTERVAL')) + '"></div>' +
                '<div class="sp-field"><label for="spBannerSub">' + esc(t('Line underneath')) + '</label>' +
                '<input type="text" id="spBannerSub" placeholder=""></div>' +
                '<div class="sp-field"><label for="spBannerWhere">' + esc(t('Position')) + '</label>' +
                '<select id="spBannerWhere">' +
                '<option value="before">' + esc(t('Before the show')) + '</option>' +
                '<option value="after">' + esc(t('Next')) + '</option></select></div>',
            actions: [{
                label: t('Apply'), primary: true,
                onClick: function (body) {
                    var text = $('#spBannerText', body).value.trim();
                    if (!text) return false;
                    change(function () {
                        SP.ensureTransition(production(), prev, sc).banners.push({
                            text: text,
                            sub: $('#spBannerSub', body).value.trim(),
                            where: $('#spBannerWhere', body).value
                        });
                    });
                }
            }]
        });
    }


    /* ================================================================== *
     * Der erste Besuch
     *
     * Zwei Wege: ein fertiges Beispiel zum Anschauen, oder die Einrichtung
     * für ein konkretes Stück. Die Einrichtung fragt nur nach dem Rahmen —
     * Stück, Gliederung, Bühne, Orte, Anzahl der Szenen. Was auf der Bühne
     * steht, trägt niemand außer dir ein.
     * ================================================================== */

    var WELCOME_KEY = 'sp.planner.welcomed.v1';

    function hasBeenWelcomed() {
        try { return localStorage.getItem(WELCOME_KEY) === '1'; } catch (err) { return true; }
    }

    function markWelcomed() {
        try { localStorage.setItem(WELCOME_KEY, '1'); } catch (err) { /* egal */ }
    }

    /*
     * Der Weg zurück in die Einrichtung. Ohne den kam man nur wieder hinein,
     * indem man die Browserdaten der Seite löschte — das war zu wenig.
     */
    function helpDialog() {
        var modal = openModal({
            title: t('Help and setup'),
            cancelLabel: t('Close'),
            body: '<div class="sp-choice-grid">' +
                '<button type="button" class="sp-choice" data-choose="setup">' +
                '<b>' + esc(t('Start over with a new production')) + '</b>' +
                '<span>' + esc(t('Walks you through the piece, the stage, the acts, the scenes and the places, and leaves a fresh production behind. What you have now stays untouched.')) + '</span></button>' +
                '<button type="button" class="sp-choice" data-choose="welcome">' +
                '<b>' + esc(t('Show the opening question again')) + '</b>' +
                '<span>' + esc(t('The one you saw the very first time — set up a production, or open the example.')) + '</span></button>' +
                '<button type="button" class="sp-choice" data-choose="example">' +
                '<b>' + esc(t('Open the worked example')) + '</b>' +
                '<span>' + esc(t('A finished production to pull apart. It is added alongside what you have.')) + '</span></button>' +
                '</div>' +
                '<div class="sp-section" style="padding-left:0;padding-right:0;margin-top:0.9rem">' +
                '<h3>' + esc(t('What is this?')) + '</h3>' +
                '<p class="sp-hint">' + esc(t('Every setting in the planner has a ? beside it. It says what the setting does on the printed sheet, not just what it is called.')) + '</p></div>' +
                '<div class="sp-section" style="padding-left:0;padding-right:0">' +
                '<h3>' + esc(t('Show the introductions again')) + '</h3>' +
                '<p class="sp-hint">' + esc(t('The short panel that appears the first time you open each section.')) + '</p>' +
                '<div class="sp-btn-row"><button class="sp-btn" data-act="intros-on">' +
                esc(t('Show the introductions again')) + '</button></div></div>' +
                '<div class="sp-section" style="padding-left:0;padding-right:0">' +
                '<h3>' + esc(t('Where things live')) + '</h3>' +
                '<p class="sp-hint">' + esc(t('Scene numbering, units and the direction convention are under Settings, next to the production name. The stage shape, the grid, the wings and the curtains are on the Stage tab.')) + '</p></div>'
        });
        modal.body.addEventListener('click', function (e) {
            var choice = e.target.closest('[data-choose]');
            if (!choice) return;
            modal.close();
            if (choice.dataset.choose === 'example') loadExample();
            else if (choice.dataset.choose === 'welcome') welcomeDialog();
            else startSetup();
        });
    }

    function welcomeDialog() {
        var modal = openModal({
            title: t('What brings you here?'),
            cancelLabel: t('Set up later'),
            body: '<div class="sp-choice-grid">' +
                '<button type="button" class="sp-choice" data-choose="setup">' +
                '<b>' + esc(t('I am planning a real production')) + '</b>' +
                '<span>' + esc(t('Set the whole thing up step by step — the piece, the stage, the acts, the scenes and the places they play in. Nothing is guessed for you.')) + '</span>' +
                '</button>' +
                '<button type="button" class="sp-choice" data-choose="example">' +
                '<b>' + esc(t('I am just having a look')) + '</b>' +
                '<span>' + esc(t('Opens a worked example you can pull apart. You can start a real plan at any time.')) + '</span>' +
                '</button></div>'
        });
        markWelcomed();

        modal.body.addEventListener('click', function (e) {
            var choice = e.target.closest('[data-choose]');
            if (!choice) return;
            modal.close();
            if (choice.dataset.choose === 'example') loadExample();
            else startSetup();
        });
    }

    /* --------------------------------------------------------- Einrichtung */

    var WIZARD_STEPS = ['piece', 'structure', 'stage', 'places', 'scenes', 'ready'];

    function startSetup() {
        var draft = {
            step: 0,
            name: '',
            subtitle: '',
            venue: '',
            hasActs: false,
            actCount: 2,
            numbering: 'continuous',
            units: 'm',
            directions: 'audience',
            shape: 'rect',
            dims: {},
            places: '',
            sceneCount: 6,
            perAct: []
        };
        SP.STAGE_SHAPES.forEach(function () { /* Maße kommen aus DEFAULT_STAGE */ });
        Object.keys(SP.DEFAULT_STAGE).forEach(function (k) {
            if (typeof SP.DEFAULT_STAGE[k] === 'number') draft.dims[k] = SP.DEFAULT_STAGE[k];
        });

        var backdrop = document.createElement('div');
        backdrop.className = 'sp-modal-backdrop';
        backdrop.innerHTML = '<div class="sp-modal is-wizard" role="dialog" aria-modal="true">' +
            '<header><h2 id="spWizTitle"></h2><p class="sp-wiz-step" id="spWizStep"></p></header>' +
            '<div class="sp-modal-body" id="spWizBody"></div>' +
            '<footer><button class="sp-btn" data-wiz="cancel">' + esc(t('Set up later')) + '</button>' +
            '<span style="flex:1 1 auto"></span>' +
            '<button class="sp-btn" data-wiz="back">' + esc(t('Back')) + '</button>' +
            '<button class="sp-btn is-primary" data-wiz="next">' + esc(t('Next')) + '</button>' +
            '</footer></div>';
        closeIntro();
        document.body.appendChild(backdrop);

        function close() {
            backdrop.remove();
            renderIntro(ui.tab);
        }

        function readStep() {
            var body = $('#spWizBody', backdrop);
            var step = WIZARD_STEPS[draft.step];
            if (step === 'piece') {
                draft.name = $('#spWizName', body).value.trim();
                draft.subtitle = $('#spWizSub', body).value.trim();
                draft.venue = $('#spWizVenue', body).value.trim();
            } else if (step === 'structure') {
                draft.hasActs = $('#spWizHasActs', body).value === 'yes';
                draft.actCount = Math.max(1, Math.min(12, parseInt($('#spWizActs', body).value, 10) || 1));
                draft.numbering = $('#spWizNumbering', body).value;
            } else if (step === 'stage') {
                draft.shape = $('#spWizShape', body).value;
                draft.units = $('#spWizUnits', body).value;
                draft.directions = $('#spWizDirections', body).value;
                $$('[data-dim]', body).forEach(function (input) {
                    var value = parseFloat(input.value);
                    if (isFinite(value)) {
                        draft.dims[input.dataset.dim] = input.dataset.dim === 'sides'
                            ? Math.round(value) : SP.toMetres(value, draft.units);
                    }
                });
            } else if (step === 'places') {
                draft.places = $('#spWizPlaces', body).value;
            } else if (step === 'scenes') {
                if (draft.hasActs) {
                    draft.perAct = $$('[data-act-scenes]', body).map(function (input) {
                        return Math.max(0, Math.min(60, parseInt(input.value, 10) || 0));
                    });
                } else {
                    draft.sceneCount = Math.max(1, Math.min(99,
                        parseInt($('#spWizScenes', body).value, 10) || 1));
                }
            }
        }

        function dimensionInputs() {
            var shape = SP.shapeById(draft.shape);
            var labels = {
                width: t('Width'), depth: t('Depth'), backWidth: t('Back width'),
                diameter: t('Diameter'), sides: t('Sides'),
                apronWidth: t('Apron width'), apronDepth: t('Apron depth')
            };
            return '<div class="sp-field-row">' + shape.fields.map(function (field) {
                var value = field === 'sides' ? draft.dims[field]
                    : SP.round(SP.toUnit(draft.dims[field], draft.units), 2);
                return '<div><label>' + esc(labels[field] || field) +
                    (field === 'sides' ? '' : ' (' + esc(SP.unitSuffix(draft.units)) + ')') + '</label>' +
                    '<input type="number" step="' + (field === 'sides' ? '1' : '0.1') +
                    '" data-dim="' + field + '" value="' + value + '"></div>';
            }).join('') + '</div>';
        }

        function renderStep() {
            var step = WIZARD_STEPS[draft.step];
            var body = $('#spWizBody', backdrop);
            $('#spWizStep', backdrop).textContent =
                t('Step {n} of {total}', { n: draft.step + 1, total: WIZARD_STEPS.length });

            var titles = {
                piece: t('The piece'), structure: t('How is the evening divided?'),
                stage: t('The stage'), places: t('The places'),
                scenes: t('The scenes'), ready: t('Ready')
            };
            $('#spWizTitle', backdrop).textContent = titles[step];

            if (step === 'piece') {
                body.innerHTML =
                    '<div class="sp-field"><label for="spWizName">' + esc(t('What is it called?')) + '</label>' +
                    '<input type="text" id="spWizName" value="' + esc(draft.name) + '" placeholder="' +
                    esc(t('Title of the piece')) + '"></div>' +
                    '<div class="sp-field"><label for="spWizSub">' + esc(t('Subtitle, if it has one')) + '</label>' +
                    '<input type="text" id="spWizSub" value="' + esc(draft.subtitle) + '"></div>' +
                    '<div class="sp-field"><label for="spWizVenue">' + esc(t('Venue')) + '</label>' +
                    '<input type="text" id="spWizVenue" value="' + esc(draft.venue) + '"></div>' +
                    '<p class="sp-hint">' + esc(t('The name goes on every sheet you print.')) + '</p>';
            } else if (step === 'structure') {
                body.innerHTML =
                    '<div class="sp-field"><label for="spWizHasActs">' + esc(t('How is the evening divided?')) + '</label>' +
                    '<select id="spWizHasActs"><option value="no"' + (draft.hasActs ? '' : ' selected') + '>' +
                    esc(t('One act, straight through')) + '</option><option value="yes"' +
                    (draft.hasActs ? ' selected' : '') + '>' + esc(t('Several acts')) + '</option></select></div>' +
                    '<div class="sp-field" id="spWizActWrap"' + (draft.hasActs ? '' : ' hidden') + '>' +
                    '<label for="spWizActs">' + esc(t('How many acts?')) + '</label>' +
                    '<input type="number" id="spWizActs" min="1" max="12" value="' + draft.actCount + '"></div>' +
                    '<div class="sp-field"><label for="spWizNumbering">' + esc(t('Scene numbering')) +
                    why('scene.numbering') + '</label><select id="spWizNumbering">' +
                    '<option value="continuous"' + (draft.numbering === 'continuous' ? ' selected' : '') + '>' +
                    esc(t('Straight through (1, 2, 3 …)')) + '</option>' +
                    '<option value="per-act"' + (draft.numbering === 'per-act' ? ' selected' : '') + '>' +
                    esc(t('Restart in each act (I.1, I.2, II.1 …)')) + '</option>' +
                    '<option value="per-act-roman"' + (draft.numbering === 'per-act-roman' ? ' selected' : '') + '>' +
                    esc(t('Restart in each act, roman (I.I, I.II, II.I …)')) + '</option></select></div>';
                $('#spWizHasActs', body).addEventListener('change', function (e) {
                    $('#spWizActWrap', body).hidden = e.target.value !== 'yes';
                });
            } else if (step === 'stage') {
                body.innerHTML =
                    '<div class="sp-field"><label for="spWizShape">' + esc(t('What shape is the playing area?')) +
                    why('stage.shape') + '</label><select id="spWizShape">' +
                    SP.STAGE_SHAPES.map(function (shape) {
                        return '<option value="' + shape.id + '"' +
                            (draft.shape === shape.id ? ' selected' : '') + '>' + esc(t(shape.name)) + '</option>';
                    }).join('') + '</select>' +
                    '<p class="sp-hint">' + esc(t(SP.shapeById(draft.shape).blurb)) + '</p></div>' +
                    '<div class="sp-field"><label for="spWizUnits">' + esc(t('Units')) + '</label>' +
                    '<select id="spWizUnits"><option value="m"' + (draft.units === 'm' ? ' selected' : '') + '>' +
                    esc(t('Metres')) + '</option><option value="ft"' + (draft.units === 'ft' ? ' selected' : '') +
                    '>' + esc(t('Feet and inches')) + '</option></select></div>' +
                    '<div id="spWizDims">' + dimensionInputs() + '</div>' +
                    '<div class="sp-field"><label for="spWizDirections">' + esc(t('Directions as seen by')) +
                    why('stage.directions') + '</label><select id="spWizDirections">' +
                    '<option value="audience"' + (draft.directions === 'audience' ? ' selected' : '') + '>' +
                    esc(t('the audience')) + '</option><option value="cast"' +
                    (draft.directions === 'cast' ? ' selected' : '') + '>' + esc(t('the cast')) + '</option>' +
                    '</select></div>';
                $('#spWizShape', body).addEventListener('change', function (e) {
                    readStep();
                    draft.shape = e.target.value;
                    renderStep();
                });
                $('#spWizUnits', body).addEventListener('change', function (e) {
                    readStep();
                    draft.units = e.target.value;
                    renderStep();
                });
            } else if (step === 'places') {
                body.innerHTML =
                    '<p class="sp-hint" style="margin-bottom:0.7rem">' +
                    esc(t('A place is a set that comes back — the kitchen, the market, the café. Name them now and every scene can simply pick one.')) + '</p>' +
                    '<div class="sp-field"><label for="spWizPlaces">' + esc(t('One place per line')) +
                    why('place.what') + '</label>' +
                    '<textarea id="spWizPlaces" rows="6" placeholder="' +
                    esc(t('Kitchen\nMarket\nCafé')) + '">' + esc(draft.places) + '</textarea></div>' +
                    '<p class="sp-hint">' + esc(t('You can add places later, and a scene never has to have one.')) + '</p>';
            } else if (step === 'scenes') {
                if (draft.hasActs) {
                    var rows = '';
                    for (var i = 0; i < draft.actCount; i++) {
                        rows += '<div><label>' + esc(t('Scenes in act {n}', { n: SP.roman(i + 1) })) + '</label>' +
                            '<input type="number" min="0" max="60" data-act-scenes="' + i + '" value="' +
                            (draft.perAct[i] === undefined ? 5 : draft.perAct[i]) + '"></div>';
                    }
                    body.innerHTML = '<div class="sp-field-row" style="flex-wrap:wrap">' + rows + '</div>' +
                        '<p class="sp-hint">' + esc(t('Empty scenes are created now and you fill them in as you go. Add or remove scenes at any time.')) + '</p>';
                } else {
                    body.innerHTML =
                        '<div class="sp-field"><label for="spWizScenes">' + esc(t('How many scenes are there?')) + '</label>' +
                        '<input type="number" id="spWizScenes" min="1" max="99" value="' + draft.sceneCount + '"></div>' +
                        '<p class="sp-hint">' + esc(t('Empty scenes are created now and you fill them in as you go. Add or remove scenes at any time.')) + '</p>';
                }
            } else {
                body.innerHTML =
                    '<p style="margin-bottom:0.8rem">' + esc(t('That is the frame. From here you drag props onto the stage, scene by scene; the tool works out what has to be carried on and off between them and prints it as an Umbauplan.')) + '</p>' +
                    '<p class="sp-hint">' + esc(t('Nothing is placed for you — the stage starts empty, exactly as you left it.')) + '</p>';
            }

            $('[data-wiz="back"]', backdrop).disabled = draft.step === 0;
            $('[data-wiz="next"]', backdrop).textContent =
                draft.step === WIZARD_STEPS.length - 1 ? t('Take me to the first scene') : t('Next');
            var focus = $('input, select, textarea', body);
            if (focus) focus.focus();
        }

        function finish() {
            var p = newProduction(draft.name || t('Untitled production'));
            p.subtitle = draft.subtitle;
            p.venue = draft.venue;
            p.units = draft.units;
            p.numbering = draft.numbering;
            p.directions = draft.directions;
            p.stage = Object.assign(defaultStage(), draft.dims, { shape: draft.shape });
            p.scenes = [];
            p.acts = [];

            draft.places.split('\n').map(function (line) { return line.trim(); })
                .filter(Boolean).forEach(function (name) {
                    p.places.push(SP.newPlace(name));
                });

            if (draft.hasActs) {
                for (var a = 0; a < draft.actCount; a++) {
                    var act = { id: SP.uid('act'), name: t('Act {n}', { n: SP.roman(a + 1) }), notes: '' };
                    p.acts.push(act);
                    var count = draft.perAct[a] === undefined ? 5 : draft.perAct[a];
                    for (var i = 0; i < count; i++) {
                        var scene = newScene('');
                        scene.actId = act.id;
                        p.scenes.push(scene);
                    }
                }
            } else {
                for (var k = 0; k < draft.sceneCount; k++) p.scenes.push(newScene(''));
            }
            if (!p.scenes.length) p.scenes.push(newScene(''));

            db.productions.push(p);
            db.activeId = p.id;
            ui.sceneId = p.scenes[0].id;
            ui.tab = 'scenes';
            undoStack = [];
            redoStack = [];
            saveNow();
            render();
            close();
        }

        backdrop.addEventListener('click', function (e) {
            var why = e.target.closest('[data-explain]');
            if (why) { openExplainer(why); return; }
            var btn = e.target.closest('[data-wiz]');
            if (!btn) return;
            var action = btn.dataset.wiz;
            if (action === 'cancel') { close(); return; }
            readStep();
            if (action === 'back') {
                draft.step = Math.max(0, draft.step - 1);
                renderStep();
            } else if (draft.step === WIZARD_STEPS.length - 1) {
                finish();
            } else {
                draft.step += 1;
                renderStep();
            }
        });

        backdrop.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') close();
        });

        renderStep();
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
        case 'update-place-set': updatePlaceFromScene(); break;
        case 'insert-place-set': insertPlaceSet(); break;
        case 'export-png': exportScenePng(); break;
        case 'clear-scene':
            if (scene() && scene().placements.length &&
                window.confirm(t('Take everything off the stage in this scene?'))) {
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
                    name: stage.curtains.length ? t('Traveller {n}', { n: stage.curtains.length }) : t('House curtain'),
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
        case 'draw-custom-prop': drawPropDialog(null); break;
        case 'edit-prop': {
            /* Gezeichnetes gehört in den Zeichner, Hochgeladenes in den
               Bilddialog — was die Requisite trägt, entscheidet. */
            var known = libraryById(data.prop);
            if (known && !known.image) drawPropDialog(known);
            else customPropDialog(known);
            break;
        }
        case 'delete-prop': deleteCustomProp(data.prop); break;
        case 'new-production': addProduction(null); break;
        case 'duplicate-production': addProduction(production()); break;
        case 'delete-production': deleteProduction(); break;
        case 'export-json': exportJson(); break;
        case 'import-json': importJson(); break;
        case 'do-print': doPrint(); break;
        case 'overview-size': break;
        case 'add-place': addPlace(); break;
        case 'delete-place': deletePlace(data.id); break;
        case 'suggest-place-props': suggestPlaceProps(data.id); break;
        case 'add-banner': addBannerDialog(); break;
        case 'add-wing-note': addWingNoteDialog(); break;
        case 'delete-wing-note':
            change(function () {
                (scene().wingNotes || []).splice(Number(data.index), 1);
            });
            break;
        case 'delete-banner': {
            var prevBanner = previousScene();
            if (prevBanner) {
                change(function () {
                    var trans = SP.ensureTransition(production(), prevBanner, scene());
                    trans.banners.splice(Number(data.index), 1);
                });
            }
            break;
        }
        case 'run-setup': startSetup(); break;
        case 'intro-done': dismissIntro(data.tab); break;
        case 'intro-off': introsOff(); break;
        case 'intros-on': introsOn(); break;
        case 'print-preset-bare':
            updatePrint({
                orientation: 'landscape',
                cover: false, actPages: false, overview: false, inventory: false,
                scenePages: true, labels: 'none',
                showGrid: false, showGuides: false, showScaleBar: false, showAudience: false,
                showTitle: false, showPlace: false, showNotes: false, showFooter: false,
                showWings: true, showCurtains: false, numberOutside: true
            });
            renderPrintTab();
            break;
        case 'print-doc':
            ui.printDoc = data.doc;
            persistUi();
            renderPrintTab();
            break;
        default: break;
        }
        void event;
    }

    /* Eine Kante ändern. Zeichnungen mit eigenem Verhältnis ziehen die
       andere Kante mit, sonst passte das Bild nicht mehr in seine Fläche. */
    function resize(placement, axis, next) {
        var value = Math.max(0.05, next);
        var prop = resolveProp(placement.propId);
        if (SPPlan.keepsAspect(prop) && placement[axis] > 0) {
            var other = axis === 'w' ? 'h' : 'w';
            placement[other] = SP.round(Math.max(0.05, placement[other] * (value / placement[axis])), 3);
        }
        placement[axis] = SP.round(value, 3);
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
        case 'scene.placeId': sc.placeId = value || null; break;
        case 'prod.directions': production().directions = value; SP.setDirections(value); break;
        case 'trans.note': {
            var prevScene = previousScene();
            if (prevScene) SP.ensureTransition(production(), prevScene, sc).note = value;
            break;
        }
        case 'prod.units': production().units = value; break;
        case 'prod.numbering': production().numbering = value; break;
        case 'item.label': sel.forEach(function (p) { p.label = value; }); break;
        case 'item.note': sel.forEach(function (p) { p.note = value; }); break;
        case 'item.x': sel.forEach(function (p) { p.x = SP.round(fromField(value, p.x), 3); }); break;
        case 'item.upstage': sel.forEach(function (p) { p.y = SP.round(out.frontY - fromField(value, out.frontY - p.y), 3); }); break;
        case 'item.rot': sel.forEach(function (p) { p.rot = SP.normaliseAngle(parseFloat(value) || 0); }); break;
        case 'item.w': sel.forEach(function (p) { resize(p, 'w', fromField(value, p.w)); }); break;
        case 'item.h': sel.forEach(function (p) { resize(p, 'h', fromField(value, p.h)); }); break;
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
            var actor = e.target.closest('.sp-modal [data-act], .sp-intro [data-act]');
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
            if (el.matches('[data-bound]')) {
                setBound(el.dataset.bound, el.value);
                persist();
                return;
            }
            if (el.matches('[data-place-field]')) {
                var place = SP.placeById(production(), el.dataset.place);
                if (place) {
                    if (el.dataset.placeField === 'name') place.name = el.value;
                    else place.props = el.value.split('\n').map(function (line) {
                        return line.trim();
                    }).filter(Boolean);
                    persist();
                }
                return;
            }
            if (el.matches('[data-bind]') && (el.tagName === 'TEXTAREA' || el.type === 'text')) {
                setBound(el.dataset.bind, el.value);
                persist();
                if (el.dataset.bind.indexOf('scene.') === 0) renderSceneList();
                if (el.dataset.bind === 'item.label') renderCanvas(true);
                return;
            }
            /* Beim Tippen zeigt die zweite Kante schon mit, was passieren wird.
               Geschrieben wird erst beim Verlassen des Feldes — sonst stünde
               für jeden Tastendruck ein Schritt in der Rückgängig-Liste. */
            if (el.dataset.bind === 'item.w' || el.dataset.bind === 'item.h') {
                var one = selectedPlacements()[0];
                var partner = el.dataset.bind === 'item.w' ? $('#spItemH') : $('#spItemW');
                var typed = parseFloat(el.value);
                if (one && partner && isFinite(typed) && typed > 0 &&
                    SPPlan.keepsAspect(resolveProp(one.propId))) {
                    var from = el.dataset.bind === 'item.w' ? one.w : one.h;
                    var other = el.dataset.bind === 'item.w' ? one.h : one.w;
                    if (from > 0) {
                        partner.value = toField(Math.max(0.05, other * (fromField(typed, from) / from)), 2);
                    }
                }
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
            if (el.dataset.transFlag) {
                var prevForFlag = previousScene();
                if (prevForFlag) {
                    change(function () {
                        SP.ensureTransition(production(), prevForFlag, scene())[el.dataset.transFlag] = el.checked;
                    });
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
                    else if (flag.indexOf('wings.') === 0) stage.wings[flag.slice(6)] = el.checked;
                    else stage[flag] = el.checked;
                });
                return;
            }
            if (el.dataset.stageNumber) {
                change(function () {
                    var stage = editingStage();
                    var key = el.dataset.stageNumber;
                    if (key.indexOf('wings.') === 0) {
                        stage.wings[key.slice(6)] = Math.max(0.05, fromField(el.value, 1));
                    }
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
        $('#spAddPlace').addEventListener('click', addPlace);
        $('#spCopyLayout').addEventListener('click', copyLayoutDialog);
        $('#spMirror').addEventListener('click', mirrorScene);
        $('#spPresetSave').addEventListener('click', updatePlaceFromScene);
        $('#spPresetApply').addEventListener('click', insertPlaceSet);
        $('#spProductionMenu').addEventListener('click', productionDialog);
        $('#spBackup').addEventListener('click', exportJson);
        $('#spHelp').addEventListener('click', helpDialog);
        $('#spUndo').addEventListener('click', undo);
        $('#spRedo').addEventListener('click', redo);

        /* ------------------------------------------------- Erklärkästen */

        document.addEventListener('click', function (e) {
            var button = e.target.closest('[data-explain]');
            if (button) {
                e.preventDefault();
                var open = $('.sp-explainer');
                // Nochmal auf dasselbe "?" schließt den Kasten wieder.
                if (open && open.dataset.for === button.dataset.explain) closeExplainer();
                else openExplainer(button);
                return;
            }
            if (e.target.closest('[data-close-explainer]') || !e.target.closest('.sp-explainer')) {
                closeExplainer();
            }
        }, true);

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeExplainer();
        });

        window.addEventListener('resize', function () {
            closeExplainer();
            var open = $('.sp-intro');
            if (open) placeIntro(open, open.dataset.tab);
        });

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
        translateMarkup();
        wire();
        render();
        setSaveState(t('Saved locally'));

        /* Beim allerersten Öffnen fragen, was ansteht — danach nie wieder. */
        if (!hasBeenWelcomed()) welcomeDialog();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
