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
    /* Die Zeichnungen sind so gewählt, dass man erkennt, was das Ding ist —
       darauf beruht der ganze Fundus. Unter jedes Sofa noch „Sofa" zu
       schreiben arbeitet dagegen: es macht den Plan voll und sagt nichts, was
       das Bild nicht schon sagt. Geschrieben steht deshalb nur, was jemand
       selbst hingeschrieben hat. Katalognamen und beides zusammen stehen
       weiter in der Auswahl über dem Plan; Nummern gibt es dort nicht mehr. */
    var ui = {
        tab: 'scenes',
        inspector: 'props',
        sceneId: null,
        selection: [],
        view: null,
        snap: true,
        ghosts: false,
        labels: 'custom',
        propSearch: '',
        propCategory: 'all',
        librarySearch: '',
        libraryCategory: 'all',
        printDoc: 'plans',
        printMore: false,
        buildMore: false,
        itemMore: false,
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
            parsed.library.forEach(migrateProp);
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

    /* Eine selbst gezeichnete Requisite aus einer früheren Fassung trägt noch
       kein gemessenes Feld. Damals wurde die Zeichnung auf die Standfläche
       gezogen, heute wird sie gleichmäßig hineingesetzt — ohne das Feld
       stünde sie plötzlich kleiner da. Aus den gespeicherten Formen lässt es
       sich nachrechnen; wo die fehlen, bleibt das ganze Feld stehen, und das
       ist genau das, was vorher galt. */
    function migrateProp(prop) {
        if (!prop || prop.box || prop.image || !prop.art) return;
        var shapes = prop.draft && prop.draft.length ? SPDraw.clean(prop.draft) : null;
        var b = shapes && shapes.length ? SPDraw.boundsOf(shapes) : null;
        prop.box = b && b.w > 0 && b.h > 0 ? [b.x, b.y, b.w, b.h] : [0, 0, 100, 100];
    }

    /* Eingeklappte Katalogeinträge. Zwei Sofas waren dasselbe Sofa, zwei
       Betten dasselbe Bett, und „Tisch von oben" war der Esstisch noch einmal
       als Zeichnung — ohne Beinmarke, ohne Rundung, ohne Decke. Ein Plan, der
       die alten Namen trägt, zeigt weiter dasselbe: die Maße stehen an der
       Aufstellung und nicht am Katalog. */
    var PROP_ALIASES = {
        'sofa-short': 'sofa',
        'sofa-long': 'sofa',
        'bed-single': 'bed',
        'bed-double': 'bed',
        'ill-table': 'dining-table',
        'ill-tablecloth': 'table-cloth',
        /* Der Beistelltisch war der runde Tisch noch einmal, nur von vorn
           gezeichnet: einbeinig, rund, gleiche Größe. Wer ihn gestellt hat,
           bekommt den runden Tisch, der sich auch im Maß einstellen lässt. */
        'ill-sidetable': 'round-table'
    };

    function migratePlacement(pl) {
        if (!pl.trackId) pl.trackId = SP.uid('trk');
        if (typeof pl.rot !== 'number') pl.rot = 0;
        var to = PROP_ALIASES[pl.propId];
        if (!to) return true;
        pl.propId = to;
        /* Die Decke war vorher die Zeichnung selbst; jetzt ist sie ein Wert. */
        if (to === 'table-cloth') pl.params = Object.assign({ cloth: true }, pl.params || {});
        return true;
    }

    /* Fills in anything a plan saved by an earlier version is missing, so an
       old file never lands the editor in a half-built state. */
    function migrateProduction(p) {
        p.units = p.units || 'm';
        p.numbering = p.numbering || 'continuous';
        p.directions = p.directions === 'cast' ? 'cast' : 'audience';
        p.acts = p.acts || [];
        p.places = p.places || [];
        p.places.forEach(function (place) {
            place.placements = (place.placements || []).filter(migratePlacement);
        });
        p.transitions = p.transitions || {};
        SP.foldPresetsIntoPlaces(p);
        p.presets = p.presets || [];
        p.scenes = p.scenes || [];
        p.stage = Object.assign({}, SP.DEFAULT_STAGE, p.stage || {});
        if (!SP.STAGE_SHAPES.some(function (sh) { return sh.id === p.stage.shape; })) {
            p.stage.shape = 'rect';
        }
        delete p.stage.sides;
        p.stage.grid = Object.assign({ show: true, spacing: 1, labels: false }, p.stage.grid || {});
        /* Eine Bühne aus einer alten Sicherung kann jede Zahl mitbringen.
           Ungeklemmt rechnete der Planer nach jedem Neuladen wieder
           sekundenlang an einem Raster, das niemand sehen will. */

        p.stage.wings = Object.assign({ show: false, inset: 1.2, depth: 3.6 }, p.stage.wings || {});
        p.stage.curtains = p.stage.curtains || [];
        p.stage.markers = p.stage.markers || [];
        p.scenes.forEach(function (s) {
            s.placements = s.placements || [];
            s.curtains = s.curtains || {};
            if (s.placeId === undefined) s.placeId = null;
            s.wingNotes = s.wingNotes || [];
            s.placements = s.placements.filter(migratePlacement);
            /* Wo eine Szene noch eine eigene Bühne trägt, gilt ab jetzt die
               der Produktion. */
            delete s.stage;
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
        /* Die Vorgabe für die Beschriftung ist von „Requisitennamen" auf „nur
           eigene" gewechselt: die Zeichnungen sagen ohnehin, was ein Ding ist,
           und unter jedes Sofa „Sofa" zu schreiben machte den Plan voll. Eine
           gespeicherte Einstellung überlebt eine geänderte Vorgabe normalerweise
           — hier einmal nicht, sonst hätte niemand etwas davon. Wer Namen
           will, stellt sie über dem Plan wieder ein. */
        if (!ui.labelDefaultMoved) {
            if (ui.labels === 'name') ui.labels = 'custom';
            ui.labelDefaultMoved = true;
        }
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
        if (['name', 'custom', 'both', 'none'].indexOf(ui.labels) === -1) ui.labels = 'custom';
        /* „Nummern passend zur Liste" gab es einmal und zeigte auf keine
           Liste. Gespeicherte Einstellungen fallen auf die Namen zurück. */
        if (ui.print && ui.print.labels === 'number') ui.print.labels = 'name';
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
                printDoc: ui.printDoc, printMore: ui.printMore, buildMore: ui.buildMore,
                itemMore: ui.itemMore, introSeen: ui.introSeen, print: ui.print,
                /* Wer in Szene sieben arbeitet und neu lädt, will in Szene
                   sieben landen und nicht wieder am Anfang. */
                sceneId: ui.sceneId, labelDefaultMoved: ui.labelDefaultMoved
            }));
        } catch (err) { /* ignore */ }
    }

    function setSaveState(text, tone) {
        var el = $('#spSaveState');
        if (!el) return;
        el.textContent = text;
        el.style.color = tone === 'bad' ? 'var(--accent)' : '';
    }

    /*
     * Zwei Fenster auf demselben Rechner, dieselbe Ablage. Wer im zweiten
     * Fenster weiterarbeitet, hat den neueren Stand; das erste weiß bisher
     * nichts davon und schrieb beim Verlassen blind seinen alten zurück.
     * Ab jetzt hält das überholte Fenster an und fragt, statt zu überschreiben.
     */
    var overtaken = false;
    var overtakenAsking = false;

    function pausedState() {
        setSaveState(t('Paused — another window'), 'bad');
    }

    function persist() {
        clearTimeout(saveTimer);
        saveTimer = null;
        if (overtaken) { pausedState(); return; }
        setSaveState(t('Saving…'));
        saveTimer = setTimeout(saveNow, 350);
    }

    function saveNow() {
        clearTimeout(saveTimer);
        /* Ohne dieses `null` blieb die Nummer des abgelaufenen Zeitgebers
           stehen. `if (saveTimer)` beim Verlassen war damit ab der ersten
           Änderung für immer wahr — und genau das war der Griff, mit dem ein
           altes Fenster die Arbeit eines neuen wegwischte. */
        saveTimer = null;
        if (overtaken) { pausedState(); return; }
        try {
            production().updatedAt = Date.now();
            localStorage.setItem(STORE_KEY, JSON.stringify(db));
            setSaveState(t('Saved locally'));
        } catch (err) {
            setSaveState(t('Could not save: storage is full'), 'bad');
            toast(t('This browser will not store any more. Export a backup, then delete an old production or a heavy custom prop.'), 'error');
        }
    }

    /* Ein anderes Fenster hat geschrieben. Anhalten, sagen, und beides
       anbieten — den anderen Stand holen oder den eigenen darüberschreiben. */
    function noteOtherWindow() {
        overtaken = true;
        clearTimeout(saveTimer);
        saveTimer = null;
        pausedState();
        if (overtakenAsking) return;
        overtakenAsking = true;
        openModal({
            title: t('Newer work in another window'),
            cancelLabel: t('Decide later'),
            body: '<p>' + esc(t('Another window of the planner has saved something newer. This window still shows what it had before and has stopped saving, so it cannot write over the other one.')) + '</p>' +
                '<p class="sp-hint">' + esc(t('“Reload” fetches the newer state — anything changed in this window since then is gone. “Keep mine” writes this window over it — then the work from the other window is gone.')) + '</p>',
            actions: [
                {
                    label: t('Keep mine'), danger: true,
                    onClick: function () {
                        overtaken = false;
                        saveNow();
                        toast(t('Kept this window. The other window’s newer work is gone.'), 'success');
                    }
                },
                {
                    label: t('Reload'), primary: true,
                    onClick: function () { window.location.reload(); }
                }
            ],
            onClose: function () { overtakenAsking = false; }
        });
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
        void target;
        return production().stage;
    }


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
        var wasActive = db.activeId;
        db.activeId = parsed.activeId;
        db.productions = parsed.productions;
        db.library = parsed.library;
        db.productions.forEach(migrateProduction);
        if (!scene() || scenes().indexOf(scene()) === -1) ui.sceneId = (scenes()[0] || {}).id;
        ui.selection = ui.selection.filter(function (id) { return !!findPlacement(id); });
        /* Führt der Schritt in eine andere Produktion, taugt der alte
           Bildausschnitt nicht mehr — dort steht eine andere Bühne. */
        if (wasActive !== db.activeId) { ui.view = null; ui.selection = []; }
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

    /* --------------------------------------------------------- measures */

    function fromField(value, fallback) {
        var n = parseFloat(String(value).replace(',', '.'));
        if (!isFinite(n)) return fallback;
        return SP.toMetres(n);
    }

    function toField(metres, digits) {
        var v = SP.toUnit(metres);
        return String(SP.round(v, digits === undefined ? 2 : digits));
    }

    /* Vorhangzustände sind gespeicherte Werte ('open'/'half'/'closed');
       übersetzt wird nur, was davon auf dem Schirm steht. */
    function curtainStateLabel(state) {
        if (state === 'half') return t('Half open');
        if (state === 'open') return t('Open');
        return t('Closed');
    }

    function lengthLabel() { return 'm'; }

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

        function put(propId, x, y, rot, label, over) {
            var prop = SPProps.get(propId);
            /* Ein Tippfehler oder ein umbenanntes Requisit ließ die Sache hier
               wortlos verschwinden: das Beispiel druckte eine Schulklasse ohne
               Pult. Ein Test wacht jetzt darüber, hier fällt es trotzdem auf. */
            if (!prop) throw new Error('the example places a prop that is gone: ' + propId);
            var pl = SP.makePlacement(prop, x, y);
            pl.rot = rot || 0;
            if (label) pl.label = label;
            if (over) Object.assign(pl, over);
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
            put('dining-table', 0.4, 2.5, 0, null, { w: 1.3, h: 0.6 }),
            put('ill-chalk', 0.62, 2.62),
            put('ill-chair', -1.9, 4.4), put('ill-chair', -0.7, 4.4),
            put('ill-chair', 0.8, 4.4), put('ill-chair', 2.0, 4.4)
        ]);

        var s2 = scene(t('The market'), market.id, act1.id, [
            put('dining-table', -0.4, 2.3, 0, null, { w: 1.4, h: 0.7 }),
            put('ill-pot', -0.55, 2.1),
            put('ill-crate', -2.5, 3.7, -12),
            put('ill-crate', 1.5, 3.1, 6)
        ]);

        var s3 = scene(t('The living room'), living.id, act1.id, [
            put('table-cloth', 0, 3.2, -12, null, { params: { cloth: true } }),
            put('ill-chair', -1.6, 3.0, 90, t('Anna’s chair')),
            put('ill-chair', 0.2, 1.9, 180),
            put('ill-coatstand', 3.1, 1.3),
            put('round-table', -2.9, 4.6),
            put('ill-typewriter', -2.9, 4.5),
            put('ill-bottle', 0.15, 3.25)
        ]);

        var s4 = scene(t('The park'), park.id, act2.id, [
            put('ill-bench', -0.4, 4.2),
            put('ill-bin', 2.7, 4.6)
        ]);

        var s5 = scene(t('The café'), cafe.id, act2.id, [
            put('round-table', 0, 3.4, 0, null, { w: 0.75, h: 0.75 }),
            put('ill-pot', -0.28, 3.15),
            put('ill-mug', 0.25, 3.15),
            put('ill-menu', 0.25, 3.62),
            put('ill-cafechair', -1.6, 3.3, 0),
            put('ill-cafechair', 1.6, 3.3, 180),
            put('ill-cafechair', 0, 2.0, 90),
            put('ill-mug', -0.25, 3.62)
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

    /* Wie viele Bedienelemente deckt der Kasten zu, wenn er hier steht? Die
       Einführung zum Requisiten-Reiter legte sich mittig unter die Reiter und
       damit genau auf „Requisit zeichnen" — den Knopf, von dem sie erzählt. */
    function introCovers(left, top, w, h) {
        var hit = 0;
        $$('.sp-panel.is-active button, .sp-panel.is-active input, ' +
            '.sp-panel.is-active select, .sp-panel.is-active .sp-tile').forEach(function (el) {
            var r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) return;
            if (r.right <= left || r.left >= left + w) return;
            if (r.bottom <= top || r.top >= top + h) return;
            hit++;
        });
        return hit;
    }

    function placeIntro(box, tab) {
        var button = $('.sp-tab-btn[data-tab="' + tab + '"]');
        if (!button) return;
        var r = button.getBoundingClientRect();
        var w = box.offsetWidth;
        var h = box.offsetHeight;
        var top = Math.round(r.bottom + 6);
        var centred = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
        var spots = [[centred, top], [window.innerWidth - w - 8, top], [8, top]];

        /* Die Zeichenfläche ist die einzige große Fläche ohne Bedienelemente.
           Passt der Kasten dort hinein, steht er dort — über dem Plan deckt er
           nichts zu, was man gerade braucht. */
        var host = $('.sp-panel.is-active .sp-stage-host') ||
            $('.sp-panel.is-active .sp-print-preview');
        if (host) {
            var hr = host.getBoundingClientRect();
            if (hr.width > w + 24 && hr.height > h + 24) {
                spots.push([Math.round(hr.left + hr.width / 2 - w / 2), Math.round(hr.top + 14)]);
            }
        }

        var best = spots[0];
        var least = Infinity;
        spots.forEach(function (spot) {
            var covered = introCovers(spot[0], spot[1], w, h);
            if (covered < least) { least = covered; best = spot; }
        });
        box.style.left = Math.round(best[0]) + 'px';
        box.style.top = Math.round(best[1]) + 'px';
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
                    '<button class="sp-tool" data-act="edit-act" data-id="' + esc(group.act.id) +
                    '" title="' + esc(t('Rename this act')) + '" aria-label="' +
                    esc(t('Rename this act')) + '">' + ICON.pencil + '</button></div>';
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
                    '<span class="sp-scene-main"><span class="sp-scene-title"' +
                    (s.title ? '' : ' data-leer="1"') + '>' +
                    esc(s.title || t('Untitled scene')) + '</span>' +
                    '<span class="sp-scene-sub">' + sub + '</span></span>' +
                    '<span class="sp-scene-tools">' +
                    '<button class="sp-tool" data-act="rename-scene" data-id="' + esc(s.id) +
                    '" title="' + esc(t('Rename this scene')) + '" aria-label="' +
                    esc(t('Rename this scene')) + '">' + ICON.pencil + '</button>' +
                    '<button class="sp-tool" data-act="duplicate-scene" data-id="' + esc(s.id) +
                    '" title="' + esc(t('Duplicate this scene')) + '" aria-label="' +
                    esc(t('Duplicate this scene')) + '">' + ICON.copy + '</button>' +
                    '<button class="sp-tool is-danger" data-act="delete-scene" data-id="' + esc(s.id) +
                    '" title="' + esc(t('Delete this scene')) + '" aria-label="' +
                    esc(t('Delete this scene')) + '">' + ICON.cross + '</button>' +
                    '</span></div>';
            }).join('');
        }).join('');

        host.innerHTML = html;
    }

    /* Den Namen dort ändern, wo er steht. Vorher lag dafür ein Feld in der
       Werkzeugleiste, das die Zeile für alles andere schmaler machte — und
       weit weg von der Zeile stand, die es benannte. Doppelklick öffnet es,
       der Stift daneben auch; Enter schreibt, Escape lässt es. */
    function renameSceneInRow(id) {
        var row = $('.sp-scene-row[data-id="' + id + '"]');
        if (!row) return;
        var slot = $('.sp-scene-title', row);
        if (!slot || $('input', slot)) return;
        var sc = (scenes() || []).filter(function (x) { return x.id === id; })[0];
        if (!sc) return;

        var field = document.createElement('input');
        field.type = 'text';
        field.className = 'sp-scene-rename';
        field.value = sc.title || '';
        field.placeholder = t('Untitled scene');
        field.setAttribute('aria-label', t('Rename this scene'));
        slot.textContent = '';
        slot.appendChild(field);
        field.focus();
        field.select();

        var done = false;
        function commit(keep) {
            if (done) return;
            done = true;
            var typed = field.value;
            /* Ist die Szene inzwischen weg — gelöscht, oder durch Rückgängig
               oder einen Produktionswechsel ersetzt —, gibt es nichts mehr zu
               benennen. Sie hier wieder anzulegen wäre das Gegenteil dessen,
               was gerade geschehen ist. */
            var lebt = (scenes() || []).some(function (x) { return x === sc; });
            if (keep && lebt && typed !== (sc.title || '')) {
                change(function () { sc.title = typed; });
                return;
            }
            if (lebt) { renderSceneList(); renderCanvas(true); }
        }
        /* Beim Verlassen wird erst der laufende Aufbau zu Ende gebracht.
           `blur` feuert genau in dem Augenblick, in dem die Liste ersetzt
           wird; ein zweiter Aufbau von hier aus riss dem ersten die Knoten
           unter den Händen weg — sechsmal „NotFoundError" beim Löschen,
           Rückgängigmachen und Produktionswechsel. */
        function finishLater(keep) {
            if (done) return;
            setTimeout(function () { commit(keep); }, 0);
        }
        field.addEventListener('keydown', function (e) {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); commit(true); }
            else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
        });
        field.addEventListener('blur', function () { finishLater(true); });
        /* Ein Klick ins Feld darf die Zeile nicht auswählen oder ziehen. */
        field.addEventListener('click', function (e) { e.stopPropagation(); });
        field.addEventListener('dblclick', function (e) { e.stopPropagation(); });
        field.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    }

    /* ------------------------------------------------------------ canvas */

    function planSettings(sc, extra) {
        var prev = previousScene();
        var diff = prev ? SP.diffScenes(prev, sc) : null;
        var settings = {
            stage: stageOf(sc),
            scene: sc,
            resolve: resolveProp,
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
            $('#spSceneTitle').textContent = '';
            return;
        }
        /* Der volle Name hängt am Titel, weil die Überschrift ihn kürzt. */
        $('#spSceneTitle').textContent = sc.title || t('Untitled scene');
        $('#spSceneTitle').title = sc.title || t('Untitled scene');

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

    /*
     * Sagt an, was Shift und Alt gerade bewirken. Ein gutes Drittel der
     * Bedienung hängt an diesen beiden Tasten und stand bisher nirgends.
     */
    /* Was beim Aufziehen gerade gilt, in der Leiste unten rechts. Der Planer
       verbirgt keine Fähigkeit: wo eine Kante festhängt, steht daneben, wie
       man sie löst. */
    var SCALE_HINTS = {
        free: 'Both edges free',
        derived: 'The depth follows the width · Alt frees it',
        ratio: 'Keeps its proportion · Alt frees the edges',
        square: 'Stays square · Alt frees the edges',
        width: 'Only the width · Alt frees the depth',
        depth: 'Only the length · Alt frees the width',
        none: 'This one comes in one size · Alt drags it anyway'
    };

    function setModifierHint(mode) {
        var el = $('#spModifierHint');
        if (!el) return;
        var text = '';
        if (mode === 'move') text = t('Shift finer · Alt free');
        else if (mode === 'rotate') text = t('Shift 5° · Alt free');
        else if (mode === 'scale') {
            text = SCALE_HINTS[(drag && drag.grip) || 'free'] ?
                t(SCALE_HINTS[(drag && drag.grip) || 'free']) : t('Alt frees the edges');
            /* Wo beide Kanten frei sind, ist Strg der Griff, der die Form
               hält — das steht sonst nirgends. */
            var free = !drag || drag.grip === 'free' || drag.grip === 'width' || drag.grip === 'depth';
            if (free) text += ' · ' + t('Ctrl keeps the shape');
        }
        else if (selectedPlacements().length) text = t('Drag to move · Shift adds to the selection');
        else text = t('Space or middle mouse pans · wheel zooms');
        el.textContent = text;
    }

    /* Ein Pfeil wird nicht aufgezogen, sondern gelegt: man fasst eine Spitze
       und zieht sie hin, wo sie zeigen soll. Länge und Winkel folgen daraus.
       Deshalb hängt an beiden Enden ein Griff. */
    function isArrow(placement) {
        var prop = placement && resolveProp(placement.propId);
        return !!(prop && prop.mark === 'arrow');
    }

    function arrowEnds(p) {
        var a = (p.rot || 0) * Math.PI / 180;
        var hx = (p.w / 2) * Math.cos(a);
        var hy = (p.w / 2) * Math.sin(a);
        return { tail: { x: p.x - hx, y: p.y - hy }, tip: { x: p.x + hx, y: p.y + hy } };
    }

    function arrowHandles(p, handle, hair) {
        if (!isArrow(p)) return '';
        var hw = p.w / 2;
        return ['-', ''].map(function (sign, i) {
            var x = i ? hw : -hw;
            return '<circle class="sp-handle" cx="' + x + '" cy="0" r="' + handle * 0.45 +
                '" stroke-width="' + hair * 1.4 + '"/>' +
                '<circle class="sp-handle-hit" data-handle="arrow-' + (i ? 'tip' : 'tail') +
                '" cx="' + x + '" cy="0" r="' + handle + '"/>';
        }).join('');
    }

    /* Welche Kanten sich ziehen lassen, sagt die Bauvorschrift. Was sie
       hergibt, bekommt einen Griff — und was nicht, bekommt keinen. */
    function scaleHandles(p, full, hair) {
        var grip = SPPlan.gripOf(resolveProp(p.propId));
        if (grip === 'none') return '';
        var hw = p.w / 2, hh = p.h / 2;
        var out = [];
        /* Die Griffe folgen dem Zoom, aber nie so weit, dass sie das Requisit
           verdecken: bei einem Stück Kreide von fünf Zentimetern lagen
           Eckgriff, Breitengriff und Tiefengriff innerhalb von zwei
           Bildpunkten übereinander und waren nicht auseinanderzuhalten. */
        var least = Math.min(p.w, p.h);
        /* Ist für drei Griffe kein Platz, bleibt der Eckgriff allein. Drei
           Griffe auf einem Fingernagel sind kein Angebot, sondern ein
           Ärgernis — die Zahlenfelder rechts stehen für genau diesen Fall.
           Dann darf der eine auch seine volle Größe behalten: mitgeschrumpft
           war er einen Bildpunkt breit und gar nicht mehr zu sehen. */
        var tight = least < full * 1.6;
        var handle = tight ? full : Math.min(full, least / 2.6);
        var corner = grip !== 'width' && grip !== 'depth';
        if (corner) {
            out.push('<rect class="sp-handle" x="' + (hw - handle * 0.4) + '" y="' + (hh - handle * 0.4) +
                '" width="' + handle * 0.8 + '" height="' + handle * 0.8 + '" stroke-width="' + hair * 1.4 + '"/>' +
                /* Gezeichnet wird klein, gegriffen wird großzügig: sonst
                   wäre der Griff auf einem kleinen Stück zwar zu sehen, aber
                   nicht zu treffen. */
                '<rect class="sp-handle-hit" data-handle="scale" x="' + (hw - full) + '" y="' + (hh - full) +
                '" width="' + full * 2 + '" height="' + full * 2 + '"/>');
        }
        /* Bei „Verhältnis" und „quadratisch" gehen beide Kanten ohnehin
           zusammen — eine einzelne Kante wäre dort eine leere Zusage. */
        var edges = tight && corner ? []
            : grip === 'free' ? ['w', 'h']
            : grip === 'derived' || grip === 'width' ? ['w']
            : grip === 'depth' ? ['h'] : [];
        edges.forEach(function (axis) {
            var x = axis === 'w' ? hw : 0;
            var y = axis === 'w' ? 0 : hh;
            var long = handle * 0.9, thick = handle * 0.3;
            out.push('<rect class="sp-handle" x="' + (x - (axis === 'w' ? thick : long) / 2) +
                '" y="' + (y - (axis === 'w' ? long : thick) / 2) +
                '" width="' + (axis === 'w' ? thick : long) +
                '" height="' + (axis === 'w' ? long : thick) +
                '" stroke-width="' + hair * 1.4 + '"/>' +
                '<rect class="sp-handle-hit" data-handle="scale-' + axis +
                '" x="' + (x - full) + '" y="' + (y - full) +
                '" width="' + full * 2 + '" height="' + full * 2 + '"/>');
        });
        return out.join('');
    }

    /* Der mitlaufende Wert neben dem Stück: heller Grund, damit er über der
       Zeichnung lesbar bleibt. Er dreht sich nicht mit — eine Zahl auf dem
       Kopf liest niemand. */
    function dragBadge(p, text, scale, hair) {
        var fs = scale / 46;
        var pad = fs * 0.42;
        var w = text.length * fs * 0.56 + pad * 2;
        var h = fs * 1.5;
        /* Wie hoch das Stück gedreht wirklich baut — mit `max(w, h)` sprang
           das Schild bei einer breit gezogenen Wand quer über die Bühne. */
        var a = (p.rot || 0) * Math.PI / 180;
        var halfY = (Math.abs(p.w * Math.sin(a)) + Math.abs(p.h * Math.cos(a))) / 2;
        var x = p.x - w / 2;
        var y = p.y - halfY - h - fs * 0.9;
        /* Am Rand rutscht es nach innen, statt aus dem Bild zu laufen. */
        if (ui.view) {
            x = Math.min(Math.max(x, ui.view.x + fs * 0.3), ui.view.x + ui.view.w - w - fs * 0.3);
            y = Math.max(y, ui.view.y + fs * 0.3);
        }
        return '<g class="sp-badge-drag">' +
            '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h +
            '" rx="' + (h * 0.22) + '" stroke-width="' + hair + '"/>' +
            '<text x="' + (x + w / 2) + '" y="' + (y + h * 0.72) +
            '" text-anchor="middle" font-size="' + fs + '">' + esc(text) + '</text></g>';
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
                    /* Griffe erscheinen nur, wo sie etwas bewirken: an der
                       Ecke, was beide Kanten bewegt, an der Kante, was nur
                       eine bewegt. Bei einem Stück in einer Größe gab es
                       vorher trotzdem einen Griff, an dem nichts geschah. */
                    scaleHandles(p, handle, hair)) +
                (p.locked ? '' : arrowHandles(p, handle, hair)) +
                '</g>');
            /* Was gerade herauskommt, steht am Stück und nicht nur unten in
               der Leiste — dort sucht man es beim Ziehen nicht. */
            if (drag && drag.badge) parts.push(dragBadge(p, drag.badge, scale, hair));
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
        /* Nichts ausgewählt heißt: der Auswahl-Bereich hat nichts zu zeigen.
           Dann gehört die Requisitenliste dorthin, damit man das Nächste
           gleich hineinziehen kann, statt jedes Mal zurückzuklicken.
           Wer den Reiter von Hand gewählt hat, behält ihn. */
        if (selectedPlacements().length) {
            ui.stickyInspector = false;
        } else if (ui.inspector === 'item' && !ui.stickyInspector) {
            ui.inspector = 'props';
        }
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
              SP.describePosition(stageOf(scene()), sel[0].x, sel[0].y)
            : (sel.length ? SPI18n.plural(sel.length, '1 prop selected', '{n} props selected') : '');
        setModifierHint(null);
    }

    /* ------------------------------------------------------------------ *
     * Vorschaubilder der Requisiten
     *
     * Ein Requisit wird in Bühnenmetern gezeichnet, also ist das Feld der
     * Vorschau seine Standfläche — nicht mehr ein Feld von 100 × 100
     * Einheiten, in dem die Zeichnung irgendwo sitzt und das erst gemessen
     * werden musste. Wie weit eine übernommene Zeichnung in ihrem eigenen
     * Feld reicht, steht als box in den Daten; shapes.js rechnet damit, hier
     * ist nichts mehr zu messen. Die Striche bleiben gleich dick, weil sie in
     * Bildschirmpunkten gerechnet werden (.sp-thumb in planner.css).
     * ------------------------------------------------------------------ */

    function round4(n) { return Math.round(n * 10000) / 10000; }

    /* Ein Vorschaubild, wie es in der Palette und im Fundus steht. Es wird
       mit derselben Rechnung gesetzt wie die Bühne, nur in einem Feld, das
       genau um das Requisit liegt. Vorher hatte die Vorschau einen eigenen
       Weg — dann zeigte die Palette das eine und die Bühne das andere, und
       man traute keiner von beiden. */
    function artThumb(prop) {
        var w = Math.max(0.05, SP.num(prop.w, 1));
        var h = Math.max(0.05, SP.num(prop.h, 1));
        var seen = SPShapes.extent(prop, w, h);
        var big = Math.max(seen.w, seen.h);
        var pad = big * 0.06;
        return '<svg viewBox="' + round4(-seen.w / 2 - pad) + ' ' + round4(-seen.h / 2 - pad) + ' ' +
            round4(seen.w + pad * 2) + ' ' + round4(seen.h + pad * 2) + '" class="sp-plan sp-thumb">' +
            SPShapes.draw(prop, w, h, prop.params, big / 70, { text: '', hint: t(prop.name) }) +
            '</svg>';
    }

    /* Was in eine Hand passt: darunter sagt der Abdruck nichts mehr über den
       Platz auf der Bühne. Vierzig Zentimeter sind die Grenze — ein Stuhl
       liegt darüber, eine Tasse darunter. */
    function handProp(prop) {
        return prop.w < 0.4 && prop.h < 0.4;
    }

    function propTile(prop) {
        var art = artThumb(prop);
        return '<div class="sp-tile" draggable="true" data-act="add-prop" data-prop="' + esc(prop.id) + '" title="' +
            esc(t(prop.name)) + '">' + art +
            '<span class="sp-tile-name">' + esc(t(prop.name)) + '</span>' +
            /* Bei einem Buch oder einem Glas kommt es aufs Erkennen an und
               nicht auf den Abdruck. Das Maß steht deshalb nur dort, wo man
               wirklich damit plant — im Auswahl-Bereich steht es bei allem.
               Entscheidend ist die Größe, nicht ob sich das Stück ziehen
               lässt: der Kleiderständer und das Klavier kommen in einer Größe
               und sind trotzdem Möbel, mit denen man den Platz einteilt. */
            (handProp(prop) ? '' :
                '<span class="sp-tile-size">' + toField(prop.w, 2) + ' × ' +
                toField(prop.h, 2) + ' ' + lengthLabel() + '</span>') + '</div>';
    }

    /* Gesucht wird in dem, was dasteht — nicht in dem, was im Quelltext
       steht. „Tür" fand nichts, weil die Requisite intern „Doorway" heißt und
       die Suche nur den englischen Namen kannte. */
    function matchesSearch(prop, query) {
        if (!query) return true;
        var q = query.toLowerCase();
        var haystack = [prop.name, t(prop.name), prop.tags || '', prop.cat, t(prop.cat)]
            .join(' ').toLowerCase();
        return haystack.indexOf(q) !== -1;
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
            /* Der Augenblick, in dem jemand etwas sucht, das es nicht gibt.
               Später sagt er es nicht mehr. */
            $('#spPalette').innerHTML = '<p class="sp-empty" style="grid-column:1/-1">' +
                esc(t('Nothing matches that.')) +
                (feedbackAvailable()
                    ? '<br><button class="sp-btn" style="margin-top:0.6rem" data-act="suggest-prop">' +
                      esc(ui.propSearch
                          ? t('Suggest “{word}”', { word: ui.propSearch })
                          : t('Suggest a prop')) + '</button>'
                    : '') + '</p>';
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
        if (feedbackAvailable()) {
            html += '<p class="sp-palette-say" style="grid-column:1/-1">' +
                '<button class="sp-btn is-quiet" data-act="suggest-prop">' +
                esc(t('Something missing? Say so.')) + '</button></p>';
        }
        $('#spPalette').innerHTML = html;
    }

    /* ================================================================== *
     * Schieber und Zahlenfeld
     *
     * Kein einstellbarer Wert steht im Planer allein da. Der Schieber ist
     * zum Suchen: man zieht, bis es aussieht, wie es aussehen soll. Das
     * Zahlenfeld ist zum Wissen: dort steht das Maß, das die Bühne nachher
     * wirklich hat, und dort trägt man es ein, wenn man es schon kennt.
     * Beide schreiben denselben Wert, und jeder zeigt sofort, was der andere
     * getan hat.
     *
     * Die Beschriftung steht über beiden, nicht daneben. Bei 312 px Spalte
     * bricht „Vor der Bühnenkante (m)" neben einem Feld auf drei Zeilen um;
     * darüber steht es in einer.
     * ================================================================== */

    function decimalsFor(step) {
        if (step >= 1) return 0;
        if (step >= 0.1) return 1;
        if (step >= 0.01) return 2;
        return 3;
    }

    function slideRow(o) {
        var step = o.step || 0.01;
        var value = SP.round(SP.num(o.value, 0), decimalsFor(step));
        /* Ein Wert außerhalb der Skala schiebt die Skala auf, statt sich
           beschneiden zu lassen. Wer eine Wand 12 m breit zieht, soll den
           Schieber danach dort finden, wo der Wert steht. */
        var min = Math.min(SP.num(o.min, 0), value);
        var max = Math.max(SP.num(o.max, 1), value);
        /* Ein Schieber rastet vom unteren Ende aus in Schritten ein. Ein
           Katalogmaß von 0,86 m läge zwischen zwei Rasten und würde als 0,85
           angezeigt — daneben stünde im Zahlenfeld 0,86, und man wüsste nicht,
           welchem von beiden zu glauben ist. Also wird das Raster auf den Wert
           gelegt statt der Wert aufs Raster. Was das Feld unterschreiten darf,
           steht ohnehin in hardMin und wird beim Schreiben geprüft. */
        min = SP.round(value - Math.ceil((value - min) / step) * step, 4);
        max = SP.round(value + Math.ceil((max - value) / step) * step, 4);
        return '<div class="sp-slide">' +
            '<label for="' + o.id + '">' + esc(o.label) + (o.why || '') + '</label>' +
            '<input type="range" class="sp-slide-bar" tabindex="-1"' +
            ' aria-label="' + esc(o.label) + '"' +
            ' min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '"' +
            ' data-bind="' + esc(o.bind) + '">' +
            '<input type="number" class="sp-slide-num" id="' + o.id + '"' +
            (o.hardMin === undefined ? '' : ' min="' + o.hardMin + '"') +
            ' step="' + step + '" value="' + value + '"' +
            ' data-bind="' + esc(o.bind) + '"></div>';
    }

    /* Zwei oder drei Zahlen nebeneinander statt untereinander. Ein Schieber
       braucht eine ganze Zeile für sich und gibt dafür nur ungefähre Zahlen;
       bei „quer" und „tief" weiß man aber, was man will, und tippt es. Was
       sich wirklich ziehen lässt, zieht man auf der Bühne. */
    function numRow(cells) {
        return '<div class="sp-nums">' + cells.filter(Boolean).map(function (c) {
            var step = c.step || 0.05;
            var value = SP.round(SP.num(c.value, 0), decimalsFor(step));
            return '<div class="sp-num"><label for="' + c.id + '">' + esc(c.label) +
                (c.why || '') + '</label>' +
                '<input type="number" id="' + c.id + '"' +
                (c.min === undefined ? '' : ' min="' + c.min + '"') +
                (c.max === undefined ? '' : ' max="' + c.max + '"') +
                ' step="' + step + '" value="' + value + '"' +
                ' data-bind="' + esc(c.bind) + '"></div>';
        }).join('') + '</div>';
    }

    function lengthNum(o) {
        return {
            id: o.id, bind: o.bind, why: o.why,
            label: o.label + ' (' + lengthLabel() + ')',
            value: SP.toUnit(o.value),
            min: o.min === undefined ? undefined : SP.round(SP.toUnit(o.min), 3),
            step: o.step || 0.05
        };
    }

    /* Dasselbe für ein Bühnenmaß. Gespeichert wird immer in Metern; angezeigt
       wird, was eingestellt ist. */
    function lengthSlide(o) {
        var step = o.step || 0.05;
        return slideRow({
            id: o.id, bind: o.bind, why: o.why,
            label: o.label + ' (' + lengthLabel() + ')',
            value: SP.toUnit(o.value),
            min: SP.toUnit(SP.num(o.min, 0)),
            max: SP.toUnit(SP.num(o.max, 1)),
            hardMin: o.hardMin === undefined ? undefined : SP.round(SP.toUnit(o.hardMin), 3),
            step: step
        });
    }

    /* Ein Schalter und die Erklärung dazu sind ein Ding. Ohne diese Klammer
       reißt der Zeilenumbruch das „?" von seinem Schalter los, und es steht
       dann neben dem nächsten — wo es etwas anderes zu bedeuten scheint. */
    /* Kleine Zeichen, an einer Stelle. Als Schriftzeichen kamen sie in jedem
       Browser anders heraus und saßen auf der Grundlinie statt in der Mitte
       ihres Knopfes. */
    var ICON = {
        up: '<svg class="sp-icon" viewBox="0 0 16 16" aria-hidden="true">' +
            '<path d="M8 13V3M3.6 7.4L8 3l4.4 4.4"/></svg>',
        down: '<svg class="sp-icon" viewBox="0 0 16 16" aria-hidden="true">' +
            '<path d="M8 3v10M3.6 8.6L8 13l4.4-4.4"/></svg>',
        cross: '<svg class="sp-icon" viewBox="0 0 16 16" aria-hidden="true">' +
            '<path d="M4 4l8 8M12 4l-8 8"/></svg>',
        pencil: '<svg class="sp-icon" viewBox="0 0 16 16" aria-hidden="true">' +
            '<path d="M2.5 13.5l0.7-2.8 7-7 2.1 2.1-7 7z"/>' +
            '<path d="M10.2 3.7l1.4-1.4a1 1 0 0 1 1.4 0l0.7 0.7a1 1 0 0 1 0 1.4l-1.4 1.4"/></svg>',
        copy: '<svg class="sp-icon" viewBox="0 0 16 16" aria-hidden="true">' +
            '<rect x="5.5" y="5.5" width="8" height="8" rx="1"/>' +
            '<path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>'
    };

    /* ---------------------------------------------------------- Kopfleiste
     *
     * Die Leiste weicht in zwei Stufen zurück, und zwar erst dann, wenn sie
     * wirklich nicht mehr passt — gemessen, nicht an einer festen Breite
     * geraten. Zuerst werden aus „Rückgängig" und „Wiederherstellen" zwei
     * Pfeile. Reicht das nicht, wandert das Seltene in ein Menü.
     *
     * Vorher schob sich die Leiste waagerecht: bei 1024 px standen
     * „Rückmeldung" und die Hilfe außerhalb des Fensters, ohne dass man sah,
     * dass dort noch etwas ist — und ohne dass man hinscrollen konnte.
     */
    function barOverflows(bar) {
        return bar.scrollWidth > bar.clientWidth + 1;
    }

    function fitBar() {
        var bar = $('.sp-bar');
        if (!bar) return;
        var rare = $('#spBarRare');
        var settings = $('#spProductionMenu');
        var more = $('#spBarMore');
        if (!rare || !more) return;

        /* Erst alles zeigen, dann messen — sonst bliebe die Leiste in der
           Stufe hängen, in die sie einmal gefallen ist. */
        bar.classList.remove('is-tight');
        rare.hidden = false;
        settings.hidden = false;
        more.hidden = true;

        if (barOverflows(bar)) bar.classList.add('is-tight');
        if (barOverflows(bar)) {
            rare.hidden = true;
            settings.hidden = true;
            more.hidden = false;
        }
        if (more.hidden) closeBarMenu();
    }

    function closeBarMenu() {
        var open = $('.sp-bar-menu');
        if (open) open.remove();
        var more = $('#spBarMore');
        if (more) more.setAttribute('aria-expanded', 'false');
    }

    function toggleBarMenu() {
        if ($('.sp-bar-menu')) { closeBarMenu(); return; }
        var more = $('#spBarMore');
        var box = document.createElement('div');
        box.className = 'sp-bar-menu';
        box.setAttribute('role', 'menu');
        box.innerHTML = [
            ['menu-settings', t('Settings')],
            ['menu-backup', t('Back-up')],
            ['menu-feedback', t('Say something')],
            ['menu-help', t('Help and setup')]
        ].map(function (row) {
            /* Das Rückmeldeformular gibt es nur, wo eine Adresse dafür steht. */
            if (row[0] === 'menu-feedback' && !FEEDBACK_FORM) return '';
            return '<button class="sp-bar-menu-item" role="menuitem" data-act="' +
                row[0] + '">' + esc(row[1]) + '</button>';
        }).join('');
        $('#spApp').appendChild(box);
        var r = more.getBoundingClientRect();
        box.style.top = Math.round(r.bottom + 4) + 'px';
        box.style.right = Math.round(window.innerWidth - r.right) + 'px';
        more.setAttribute('aria-expanded', 'true');
        var first = $('.sp-bar-menu-item', box);
        if (first) first.focus();
    }

    function btnWhy(button, key) {
        var mark = why(key);
        return mark ? '<span class="sp-btn-pair">' + button + mark + '</span>' : button;
    }

    function checkRow(id, bind, label, on, why) {
        return '<label class="sp-check" for="' + id + '">' +
            '<input type="checkbox" id="' + id + '" data-toggle="' + esc(bind) + '"' +
            (on ? ' checked' : '') + '>' + esc(label) + '</label>' + (why || '');
    }

    /* Was ein Requisit auf der Bühne mit sich machen lässt — und dass es hier
       trotzdem jede Zahl annimmt. Beides steht da, weil sonst das eine wie ein
       Verbot aussieht und man den Ausweg nicht fände. */
    var GRIP_NOTES = {
        derived: 'The depth is what the leaf sweeps, so it follows the width by itself.',
        ratio: 'On the stage this drawing keeps its proportion. Here the second edge follows along.',
        square: 'On the stage this stays square. Here you can write any two numbers.',
        width: 'On the stage you can only pull this one wider. Here you can write any two numbers.',
        depth: 'On the stage you can only pull this one longer. Here you can write any two numbers.',
        none: 'This comes in one size, so the stage will not let you pull it. Here you can write any two numbers.'
    };

    function gripNote(prop) {
        var lines = [];
        /* Eine Ansicht zeigt das Requisit von der Seite, damit man es erkennt.
           Dann ist „tief" die Höhe des Bildes und nicht die Standfläche — wer
           das nicht weiß, trägt an der falschen Zahl herum. */
        if (prop && prop.view === 'front') {
            lines.push(t('This one is drawn from the side, so you can tell what it is. “Deep” is the height of the picture here, not the floor it stands on.'));
        }
        var note = GRIP_NOTES[SPPlan.gripOf(prop)];
        if (note) lines.push(t(note));
        if (!lines.length) return '';
        return '<p class="sp-hint" style="margin-bottom:0.5rem">' + lines.map(esc).join('<br>') + '</p>';
    }

    /* Die Werte, die dieses eine Requisit hat und kein anderes. Welche das
       sind, sagt die Bauvorschrift selbst — der Planer weiß nichts über
       Armlehnen und Sprossen, er baut nur die Bedienelemente dazu. */
    function buildSection(p, prop) {
        var live = SPShapes.live(prop, p.params);
        if (!live.length) return '';
        var vals = SPShapes.values(prop, p.params);
        var rows = live.map(function (def) {
            var id = 'spParam-' + def.key;
            var bind = 'item.param.' + def.key;
            var label = t(def.label);
            if (def.type === 'toggle') return checkRow(id, bind, label, !!vals[def.key]);
            if (def.unit === 'length') {
                return lengthSlide({ id: id, bind: bind, label: label,
                    value: vals[def.key], min: def.min, max: def.max, step: def.step });
            }
            return slideRow({ id: id, bind: bind, label: label,
                value: vals[def.key], min: def.min, max: def.max, step: def.step });
        }).join('');
        /* Zugeklappt, aber nicht versteckt: im Kopf der Klappe steht das
           Stück, wie es gerade gebaut ist, und daneben in Worten, was
           eingestellt ist. Wer nichts ändern will, sieht trotzdem, dass es
           hier etwas zu ändern gäbe — und was. */
        return '<div class="sp-section">' +
            '<details class="sp-more sp-build"' + (ui.buildMore ? ' open' : '') +
            ' data-fold="buildMore">' +
            '<summary><span class="sp-build-thumb">' + artThumb(propAsBuilt(prop, p)) + '</span>' +
            '<span class="sp-build-head"><b>' + esc(t('How this one is built')) + '</b>' +
            '<span class="sp-build-says">' + esc(buildSummary(live, vals)) + '</span></span>' +
            why('item.build') + '</summary>' + rows + '</details></div>';
    }

    /* Das Requisit so, wie es dieses eine Mal gebaut ist — für das Bild im
       Kopf der Klappe. */
    function propAsBuilt(prop, placement) {
        return Object.assign({}, prop, { params: placement.params, w: prop.w, h: prop.h });
    }

    /* „Mit Decke · 4 Beine · 1,2 m" — was eingestellt ist, in einer Zeile. */
    function buildSummary(live, vals) {
        return live.map(function (def) {
            var v = vals[def.key];
            if (def.type === 'toggle') return v ? t(def.label) : '';
            if (def.unit === 'length') return t(def.label) + ' ' + SP.formatLength(v);
            return t(def.label) + ' ' + SP.round(v, 2);
        }).filter(Boolean).join(' · ');
    }

    /* Was sich beim Ziehen mitschreibt, ohne dass der Bereich neu gebaut wird
       — sonst verlöre das halb getippte Feld unter dem Finger den Inhalt.
       Aufgerufen wird das aus jedem Zug: Wertschild und Statuszeile liefen
       sonst mit, die Zahlen im Auswahl-Bereich standen bis zum Loslassen auf
       dem alten Wert und widersprachen dem Schild daneben. */
    function refreshItemReadouts() {
        var p = selectedPlacements()[0];
        if (!p) return;
        var stage = stageOf(scene());
        var out = SP.stageOutline(stage);
        var gridRef = stage.grid && stage.grid.labels
            ? SP.gridReference(stage, p.x, p.y, SP.num(stage.grid.spacing, 1)) : null;
        var zone = $('#spItemZone');
        if (zone) {
            zone.textContent = SP.zoneName(stage, p.x, p.y) +
                (gridRef ? ', ' + t('square {ref}', { ref: gridRef }) : '');
        }
        var says = $('#spItemSays');
        if (says) says.textContent = SP.describePosition(stage, p.x, p.y);
        /* Die Tiefe wird von der Bühnenkante aus gezählt: verschiebt man das
           Requisit über den Plan, muss die Zahl mitgehen. */
        syncSlide('item.upstage', SP.toUnit(out.frontY - p.y));
        syncSlide('item.x', SP.toUnit(p.x));
        syncSlide('item.w', SP.toUnit(p.w));
        syncSlide('item.h', SP.toUnit(p.h));
        syncSlide('item.rot', SP.round(p.rot || 0, 1));
    }

    /* Beide Hälften eines Paares auf denselben Stand bringen, ohne das Feld
       zu stören, in dem gerade getippt wird. */
    function syncSlide(bind, value, except) {
        $$('[data-bind="' + bind + '"]').forEach(function (el) {
            if (el === except || el === document.activeElement) return;
            var step = parseFloat(el.step) || 0.01;
            var text = String(SP.round(value, decimalsFor(step)));
            if (el.value !== text) el.value = text;
        });
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
                btnWhy('<button class="sp-btn" data-act="align" data-axis="x">' +
                    esc(t('Line up across')) + '</button>', 'item.align') +
                '<button class="sp-btn" data-act="align" data-axis="y">' + esc(t('Line up upstage')) + '</button>' +
                '<button class="sp-btn" data-act="spread" data-axis="x">' + esc(t('Space evenly')) + '</button>' +
                '<button class="sp-btn" data-act="mirror-selection">' + esc(t('Mirror')) + '</button>' +
                '<button class="sp-btn" data-act="duplicate-selection">' + esc(t('Duplicate')) + '</button>' +
                '<button class="sp-btn is-danger" data-act="delete-selection">' + esc(t('Delete')) + '</button>' +
                '</div></div>' +
                '<div class="sp-section"><h3>' + esc(t('In this selection')) + '</h3><ul style="list-style:none;padding:0;margin:0">' +
                SP.groupByProp(sel, function (id) { return t((resolveProp(id) || {}).name || id); }).map(function (g) {
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

        /* Beim Textfeld ist die Beschriftung nicht Beiwerk, sondern der
           ganze Inhalt. Sie steht deshalb zuoberst und heißt, was sie tut. */
        var isTextPlate = prop.mark === 'label';

        host.innerHTML =
            '<div class="sp-section">' +
            '<h3>' + esc(t(prop.name)) + '</h3>' +
            '<div class="sp-field"><label for="spItemLabel">' +
            esc(isTextPlate ? t('Text in the field') : t('Written on the plan')) + why('item.label') + '</label>' +
            (isTextPlate
                ? '<textarea id="spItemLabel" class="sp-plate-text" rows="3" data-bind="item.label" placeholder="' +
                  esc(t('e.g. Sofa goes off here')) + '">' + esc(p.label || '') + '</textarea>'
                : '<input type="text" id="spItemLabel" data-bind="item.label" value="' + esc(p.label || '') +
                  '" placeholder="' + esc(t('e.g. Anna’s chair')) + '">') + '</div>' +
            (isTextPlate ? '<p class="sp-hint">' +
                esc(t('This is what stands in the field, on screen and on paper. Every line break is one on the plan, and the letters grow to fill the field. Empty prints as an empty field.')) +
                '</p>' : '') +
            '<div class="sp-field"><label for="spItemNote">' + esc(t('Note for the crew')) + '</label>' +
            '<textarea id="spItemNote" data-bind="item.note" placeholder="' + esc(t('Comes on from stage right')) + '">' +
            esc(p.note || '') + '</textarea></div>' +
            '</div>' +

            buildSection(p, prop) +

            /* Steht, wo es steht, und ist so groß, wie es ist — beides in
               einem Abschnitt und in je einer Zeile. Vorher waren das zwei
               Abschnitte mit fünf Schiebern und über 500 px. */
            '<div class="sp-section"><h3>' + esc(t('Where and how big')) + why('item.size') + '</h3>' +
            numRow([
                lengthNum({ id: 'spItemX', bind: 'item.x', label: t('Across'), value: p.x }),
                /* Nicht „tief" — das steht eine Zeile darunter und meint dort
                   das Maß des Stücks und nicht seinen Platz. */
                lengthNum({ id: 'spItemY', bind: 'item.upstage', label: t('Back from the front'),
                    value: out.frontY - p.y }),
                { id: 'spItemRot', bind: 'item.rot', label: t('Turned (°)'), why: why('item.rot'),
                  value: p.rot || 0, step: 1 }
            ]) +
            numRow([
                lengthNum({ id: 'spItemW', bind: 'item.w', label: t('Wide'), value: p.w, min: 0.05 }),
                lengthNum({ id: 'spItemH', bind: 'item.h', label: t('Deep'), value: p.h, min: 0.05 })
            ]) +
            gripNote(prop) +
            '<p class="sp-hint"><span id="spItemZone">' + esc(SP.zoneName(stage, p.x, p.y)) +
            (gridRef ? ', ' + esc(t('square {ref}', { ref: gridRef })) : '') + '</span><br>' +
            '<span id="spItemSays">' + esc(SP.describePosition(stage, p.x, p.y)) + '</span></p>' +
            '</div>' +

            '<div class="sp-section"><div class="sp-btn-row">' +
            btnWhy('<button class="sp-btn' + (p.flip ? ' is-on' : '') + '" data-act="flip">' +
                esc(t('Flip')) + '</button>', 'item.flip') +
            btnWhy('<button class="sp-btn' + (p.locked ? ' is-on' : '') + '" data-act="lock">' +
                esc(p.locked ? t('Locked') : t('Lock')) + '</button>', 'item.lock') +
            '<button class="sp-btn" data-act="duplicate-selection">' + esc(t('Duplicate')) + '</button>' +
            '<button class="sp-btn is-danger" data-act="delete-selection">' + esc(t('Delete')) + '</button>' +
            '</div>' +
            /* Was man selten braucht, steht hinter einer Klappe — aber es
               steht da, und man sieht auf einen Blick, was drin ist. */
            '<details class="sp-more"' + (ui.itemMore ? ' open' : '') + ' data-fold="itemMore">' +
            '<summary>' + esc(t('Order, copies, catalogue size')) + '</summary>' +
            '<div class="sp-btn-row">' +
            '<button class="sp-btn" data-act="raise">' + esc(t('Bring forward')) + '</button>' +
            '<button class="sp-btn" data-act="lower">' + esc(t('Send back')) + '</button>' +
            '<button class="sp-btn" data-act="reset-size">' + esc(t('Back to catalogue size')) + '</button>' +
            btnWhy('<button class="sp-btn" data-act="push-forward">' +
                esc(t('Carry into later scenes…')) + '</button>', 'scene.pushForward') +
            '</div></details></div>';
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
            /* Was mit dem Ort zu tun ist, steht beim Ort. In der Werkzeugleiste
               nahmen die beiden Knöpfe 474 px und standen weit weg von der
               Auswahl, auf die sie sich beziehen. Ohne Ort gibt es nichts zu
               übernehmen und nichts einzusetzen — dann stehen sie nicht da. */
            (sc.placeId
                ? '<div class="sp-btn-row" style="margin-top:-0.2rem">' +
                  '<button class="sp-btn" data-act="place-update">' +
                  esc(t('Update the place from this scene')) + '</button>' +
                  '<button class="sp-btn" data-act="place-insert">' +
                  esc(t('Insert this place’s set')) + '</button></div>'
                : '') +
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


            (curtainRows ? '<div class="sp-section"><h3>' + esc(t('Curtains in this scene')) + '</h3>' + curtainRows + '</div>' : '') +

            '<div class="sp-section"><h3>' + esc(t('Layout')) + why('scene.copyLayout') + '</h3><div class="sp-btn-row">' +
            /* „Aus anderer Szene übernehmen", „An der Mitte spiegeln" und die
               beiden Ort-Knöpfe stehen schon in der Werkzeugleiste über dem
               Plan — zwei davon hießen dort sogar anders. Hier bleibt, wozu es
               keinen zweiten Weg gibt. */
            '<button class="sp-btn" data-act="push-layout">' + esc(t('Copy this layout to other scenes…')) + '</button>' +
            '<button class="sp-btn" data-act="export-png">' + esc(t('Save this plan as a picture')) + '</button>' +
            '<button class="sp-btn is-danger" data-act="clear-scene">' + esc(t('Clear the stage')) + '</button>' +
            '</div></div>' +

'';
    }

    /* Dieselben Zeilen, die auch im Umbauplan stehen — einmal formuliert,
       damit Bildschirm und Papier nicht auseinanderlaufen. */
    function changeLines(diff, stage) {
        var nameOf = function (id) { return t((resolveProp(id) || { name: t('Unknown prop') }).name); };
        return {
            on: SP.groupByProp(diff.added, nameOf).map(SP.describeGroup),
            off: SP.groupByProp(diff.removed, nameOf).map(SP.describeGroup),
            move: diff.moved.map(function (m) {
                var label = nameOf(m.to.propId) + (m.to.label ? ' (' + SP.oneLine(m.to.label) + ')' : '');
                if (m.distance <= 0.12 && m.turned > 4) {
                    return label + ' → ' + Math.round(m.to.rot) + '°';
                }
                return label + ' → ' + SP.describePosition(stage, m.to.x, m.to.y);
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

    var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
        'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    function focusableIn(root) {
        return $$(FOCUSABLE, root).filter(function (el) {
            return el.offsetParent !== null || el === document.activeElement;
        });
    }

    /*
     * Hält Tab im Dialog. Ohne das wandert der Fokus hinter das Fenster in die
     * Seite, die gerade nicht bedienbar ist — man tabbt ins Leere und kommt
     * nur mit der Maus zurück.
     */
    function trapFocus(backdrop) {
        backdrop.addEventListener('keydown', function (e) {
            if (e.key !== 'Tab') return;
            var items = focusableIn(backdrop);
            if (!items.length) return;
            var first = items[0];
            var last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault(); last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault(); first.focus();
            }
        });
    }

    /*
     * Beim Schließen dorthin zurück, wo der Anwender herkam. Gab es keinen
     * Ausgangspunkt — beim allerersten Öffnen etwa — dann auf die Bühne,
     * damit der Fokus nicht im Nichts liegt und die Tastatur weiter greift.
     */
    function restoreFocus(opener) {
        if (opener && opener.isConnected && opener !== document.body) {
            opener.focus({ preventScroll: true });
            return;
        }
        var fallback = $('#spCanvas') || $('.sp-tab-btn[aria-selected="true"]') || $('.sp-tab-btn');
        if (fallback) fallback.focus({ preventScroll: true });
    }

    /* Beim Öffnen ins erste bedienbare Element. */
    function focusFirstIn(backdrop) {
        var field = $('input:not([type="hidden"]), select, textarea', backdrop);
        var target = field || focusableIn(backdrop)[0];
        if (target) target.focus({ preventScroll: true });
    }

    /* ================================================================== *
     * Rückmeldung
     *
     * Wer ein Requisit sucht, das es nicht gibt, ist genau in dem Moment
     * bereit, das zu sagen — nicht später, nicht in einem Formular auf einer
     * anderen Seite. Deshalb steht der Knopf dort, wo die Suche leer ausgeht,
     * und das Suchwort steht schon im Feld. Pflicht ist ein einziges Feld.
     *
     * Was sonst noch mitgeht, steht am Ende der Nachricht und muss niemand
     * tippen: welcher Reiter offen war, wie breit das Fenster ist, welcher
     * Browser. Das sind die Fragen, die man sonst zurückschreiben müsste, und
     * dann antwortet keiner mehr.
     * ================================================================== */

    /* Die Formspree-Adresse. Ohne sie bleibt der Knopf verborgen: ein
       Formular, das ins Leere schickt, ist schlimmer als keines. */
    var FEEDBACK_FORM = 'mankdzjn';

    var FEEDBACK_KINDS = [
        { id: 'prop', label: 'A prop is missing' },
        { id: 'bug', label: 'Something is broken' },
        { id: 'idea', label: 'Something else' }
    ];

    function feedbackAvailable() {
        return /^[A-Za-z0-9]{6,}$/.test(FEEDBACK_FORM);
    }

    /* Was der Absender nicht tippen soll. Nichts davon benennt eine Person:
       kein Name, keine Adresse, kein Inhalt einer Produktion. */
    function feedbackContext() {
        var sc = scene();
        return [
            t('Tab') + ': ' + ui.tab,
            t('Window') + ': ' + window.innerWidth + '×' + window.innerHeight,
            t('Props on the stage') + ': ' + ((sc && sc.placements) ? sc.placements.length : 0),
            t('Language') + ': ' + (navigator.language || '?'),
            'UA: ' + (navigator.userAgent || '?')
        ].join('\n');
    }

    /* Was jemand ins Rückmeldeformular getippt und noch nicht abgeschickt hat.
       Zehntausend Zeichen einer in Ruhe ausformulierten Fehlerbeschreibung
       waren nach einem Escape wortlos weg. */
    var feedbackDraft = null;

    function feedbackDialog(kind, prefill) {
        if (!feedbackAvailable()) return;
        var chosen = (feedbackDraft && feedbackDraft.kind) || kind || 'prop';
        var body = document.createElement('div');
        body.innerHTML =
            '<div class="sp-seg sp-feedback-kind" role="radiogroup">' +
            FEEDBACK_KINDS.map(function (k) {
                return '<button type="button" role="radio" data-kind="' + k.id + '" aria-checked="' +
                    (k.id === chosen ? 'true' : 'false') + '">' + esc(t(k.label)) + '</button>';
            }).join('') + '</div>' +
            '<div class="sp-field" style="margin-top:0.7rem">' +
            '<textarea id="spSayText" rows="5" class="sp-say-text"></textarea></div>' +
            '<div class="sp-field"><label for="spSayBack">' +
            esc(t('Your e-mail, only if you want an answer')) + '</label>' +
            '<input type="email" id="spSayBack" autocomplete="email" placeholder="' +
            esc(t('Leave it empty and stay anonymous')) + '"></div>' +
            '<p class="sp-hint">' + esc(t('Sent with it: which tab was open, how wide the window is and which browser. No names, nothing out of your production.')) + '</p>';

        var sent = false;
        var placeholders = {
            prop: t('e.g. A hospital bed on castors, about 1.00 × 2.10 m'),
            bug: t('e.g. The door swings the wrong way after I mirror the scene'),
            idea: t('Whatever it is. A sentence is enough.')
        };
        var field = $('#spSayText', body);
        field.value = prefill || (feedbackDraft && feedbackDraft.text) || '';
        field.placeholder = placeholders[chosen];
        if (feedbackDraft && feedbackDraft.back) {
            $('#spSayBack', body).value = feedbackDraft.back;
        }

        $('.sp-feedback-kind', body).addEventListener('click', function (e) {
            var btn = e.target.closest('[data-kind]');
            if (!btn) return;
            chosen = btn.dataset.kind;
            $$('[data-kind]', body).forEach(function (b) {
                b.setAttribute('aria-checked', b === btn ? 'true' : 'false');
            });
            field.placeholder = placeholders[chosen];
            field.focus();
        });

        openModal({
            title: t('Say something'),
            body: body,
            /* Beim Schließen bleibt stehen, was noch nicht abgeschickt ist —
               beim nächsten Öffnen steht es wieder da. Abgeschickt wird nichts
               davon; es liegt nur in diesem Fenster. */
            onClose: function () {
                if (sent) { feedbackDraft = null; return; }
                var text = field.value.trim();
                feedbackDraft = text
                    ? { kind: chosen, text: field.value, back: $('#spSayBack', body).value }
                    : null;
            },
            actions: [{
                label: t('Send'),
                primary: true,
                onClick: function (host, close) {
                    var text = $('#spSayText', host).value.trim();
                    if (!text) { $('#spSayText', host).focus(); return false; }
                    sendFeedback(chosen, text, $('#spSayBack', host).value.trim());
                    sent = true;
                    close();
                }
            }]
        });
        field.focus();
    }

    function sendFeedback(kind, text, from) {
        var label = (FEEDBACK_KINDS.filter(function (k) { return k.id === kind; })[0] || {}).label || kind;
        var payload = {
            _subject: 'Bühnenbild-Planer — ' + t(label),
            kind: kind,
            message: text,
            context: feedbackContext()
        };
        if (from) payload.email = from;
        /* Abgeschickt ist abgeschickt: der Dialog schließt sofort und die
           Nachricht geht im Hintergrund raus. Wer auf eine Bestätigung warten
           muss, schreibt beim nächsten Mal nichts mehr. */
        toast(t('Thank you — it is on its way.'), 'success');
        fetch('https://formspree.io/f/' + FEEDBACK_FORM, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload)
        }).then(function (res) {
            if (!res.ok) throw new Error(res.status);
        }).catch(function () {
            toast(t('That did not go through. Is there a connection?'), 'error');
        });
    }

    function openModal(config) {
        var opener = document.activeElement;
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
            restoreFocus(opener);
            renderIntro(ui.tab);
        }
        function onKey(e) {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            /* Von innen nach außen: steht ein Erklärkasten offen, gilt Escape
               ihm. Vorher hing dieser Zuhörer in der Fangphase und hielt das
               Ereignis auf — der Dialog schloss sich, und der Kasten blieb
               frei über der Seite stehen, mitten auf einem anderen Reiter. */
            if ($('.sp-explainer')) { closeExplainer(); return; }
            /* Dann darf der Dialog Escape selbst verwerten — der Zeichner
               bricht damit den angefangenen Zug ab, statt alles wegzuwerfen. */
            if (config.onEscape && config.onEscape() === false) return;
            close();
        }

        backdrop.addEventListener('click', function (e) {
            if (e.target === backdrop || e.target.dataset.close) { close(); return; }
            /* Knöpfe im Rumpf führen aus dem Dialog heraus; er schließt sich
               vorher, damit sein Tastenzuhörer mitgeht. Vorher ging dabei
               auch das Getippte verloren: wer den Namen ändert und dann
               „Diese duplizieren" drückt, bekam die Kopie unter dem alten
               Namen und keine Meldung. `onLeave` schreibt die Felder erst
               weg. */
            if (e.target.closest('[data-act]')) {
                if (config.onLeave) config.onLeave(backdrop);
                close();
                return;
            }
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
        trapFocus(backdrop);
        focusFirstIn(backdrop);
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

    function addProp(propId, x, y, stagger) {
        var prop = resolveProp(propId);
        var sc = scene();
        if (!prop || !sc) return;
        /* Vier Stücke nacheinander angeklickt lagen exakt übereinander und
           waren nicht auseinanderzuhalten. Jedes weitere rückt eine halbe
           Rasterweite nach rechts unten, bis wieder Platz ist. */
        if (stagger) {
            var step = SP.num((stageOf(sc).grid || {}).spacing, 1) / 2;
            var taken = function (px, py) {
                return (sc.placements || []).some(function (pl) {
                    return Math.abs(pl.x - px) < step * 0.4 && Math.abs(pl.y - py) < step * 0.4;
                });
            };
            for (var n = 0; n < 24 && taken(x, y); n++) { x += step; y += step; }
        }
        change(function () {
            var placement = SP.makePlacement(prop, snap(x), snap(y));
            sc.placements.push(placement);
            ui.selection = [placement.id];
            ui.inspector = 'item';
        });
    }

    /*
     * Rastet auf halbe Rasterfelder ein. Mit gedrückter Shift-Taste noch
     * einmal halb so fein — für den Stuhl, der genau neben dem Tisch stehen
     * muss und nicht auf der nächsten Rasterlinie.
     */
    function snapStep(fine) {
        var spacing = SP.num((stageOf(scene()).grid || {}).spacing, 1) / 2;
        return fine ? spacing / 2 : spacing;
    }

    function snap(value, fine) {
        if (!ui.snap) return SP.round(value, 3);
        var step = snapStep(fine);
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
            window.confirm(target.title
                ? SPI18n.plural(target.placements.length,
                    'Delete “{title}” and the one prop in it?',
                    'Delete “{title}” and its {n} props?', { title: target.title })
                : SPI18n.plural(target.placements.length,
                    'Delete scene {label} and the one prop in it?',
                    'Delete scene {label} and its {n} props?',
                    { label: SP.sceneNumbers(p)[target.id].label }));
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

    /* Schieben mit den Pfeiltasten ist eine Bewegung, auch wenn sie aus
       zwanzig Tastendrücken besteht. Sie wird zu einem Rückgängig-Schritt
       zusammengefasst, solange nichts anderes dazwischenkommt — genau wie ein
       Zug mit der Maus und ein Zug am Schieber. */
    var nudgeTimer = null;

    function nudge(dx, dy) {
        var sel = selectedPlacements().filter(function (p) { return !p.locked; });
        if (!sel.length) return;
        if (nudgeTimer === null) beginHistory();
        else clearTimeout(nudgeTimer);
        nudgeTimer = setTimeout(function () {
            nudgeTimer = null;
            commitHistory();
            renderTopBar();
        }, 600);
        sel.forEach(function (p) {
            p.x = SP.round(p.x + dx, 3);
            p.y = SP.round(p.y + dy, 3);
            holdSpot(p);
        });
        persist();
        renderCanvas(true);
        refreshItemReadouts();
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
                        esc(SPI18n.plural(s.placements.length, '{title} (one prop)', '{title} ({n} props)',
                            { title: s.title || t('Untitled scene') })) + '</option>';
                }).join('') + '</select></div>' +
                '<div class="sp-field"><label for="spCopyMode">' + esc(t('And')) + '</label>' +
                '<select id="spCopyMode">' +
                '<option value="replace">' + esc(t('replace what is here')) + '</option>' +
                '<option value="merge">' + esc(t('add to what is here')) + '</option></select></div>' +
                '<label class="sp-check"><input type="checkbox" id="spCopyMirror"> ' + esc(t('Mirror it across the centre line')) + '</label>' +
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
    /*
     * Gefragt wird nur, wenn etwas verlorengeht. Hält die Szene alles, was
     * der Ort hatte, und mehr, läuft der Knopf stumm durch — das ist der
     * normale Weg und der soll ein Klick bleiben. Fehlt etwas, steht in der
     * Frage, was genau.
     */
    function placeLossQuestion(loss) {
        if (loss.all) return t('The place loses all {n}.', { n: loss.total });
        /* Die Zahl steht auch bei einem einzelnen Stück dabei: „verliert
           1 × Esstisch" ist eine Ansage, „verliert Esstisch" ein Stolperer. */
        var list = loss.items.map(function (item) {
            return item.count + ' \u00d7 ' +
                t((resolveProp(item.propId) || { name: t('Unknown prop') }).name);
        }).join(', ');
        return t('The place loses {list}.', { list: list });
    }

    function updatePlaceFromScene() {
        var sc = scene();
        var place = SP.placeForScene(production(), sc);
        if (!place) { toast(t('This scene has no place yet.')); return; }
        var loss = SP.placeLoss(place, sc);
        if (loss.count && !window.confirm(placeLossQuestion(loss) + '\n' + t('Carry on?'))) return;
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
                            /* „Welche Szenen" zeigte danach weiter auf den
                               toten Akt: das Feld sagte „Die ganze
                               Produktion", gefiltert wurde auf nichts, und es
                               kam kein einziges Blatt heraus. */
                            if (p.print && p.print.scope === id) p.print.scope = 'all';
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
     * Teilt den Ablauf an der aktuellen Szene: der neue Akt beginnt hier und
     * läuft bis zum Ende des Akts, in dem die Szene bisher lag. Spätere Akte
     * bleiben unberührt, und es wird nie einer gelöscht — in einem Akt steckt
     * ein Name und eine Notiz fürs Trennblatt, die niemand nebenbei verlieren
     * will.
     */
    function addAct() {
        var p = production();
        var current = scene();
        if (!current) { toast(t('Add a scene first.')); return; }

        var from = p.scenes.indexOf(current);
        var was = current.actId || null;
        var before = p.scenes[from - 1];
        var alreadyStarts = was && (from === 0 || !before || before.actId !== was);
        if (alreadyStarts) { toast(t('This scene already starts an act.')); return; }

        var moved = 0;
        change(function () {
            var act = { id: SP.uid('act'), name: '', notes: '' };
            var after = was
                ? p.acts.map(function (a) { return a.id; }).indexOf(was) + 1
                : p.acts.length;
            p.acts.splice(after, 0, act);
            for (var i = from; i < p.scenes.length; i++) {
                if ((p.scenes[i].actId || null) !== was) break;
                p.scenes[i].actId = act.id;
                moved += 1;
            }
        });
        toast(SPI18n.plural(moved, 'Act added, with 1 scene in it.',
            'Act added, with {n} scenes in it.'), 'success');
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

    /* Es gibt eine Bühne, die der Produktion. Eine eigene Bühne pro Szene
       gab es einmal; sie stand ganz unten im letzten Abschnitt der letzten
       Spalte, wurde nie gefunden, und wer sie doch fand, hatte danach zwei
       Bühnen zu pflegen. */
    function editingStage() {
        return production().stage;
    }

    function renderStageTab() {
        var stage = editingStage();
        $('#spStageHeading').textContent = t('The stage');
        $('#spStageIntro').textContent = t('Applies to every scene in this production.');

        /* Alle Karten zeigen dieselben Beispielmaße in derselben viewBox.
           Vorher rechnete jede ihre eigene aus, also füllte ein Rund von 10 m
           die Karte genauso wie eine Bühne von 12 m — die Karten logen über
           die Größe, die man gerade auswählt. */
        var samples = SP.STAGE_SHAPES.map(function (shape) {
            return SP.stageOutline(Object.assign({}, SP.DEFAULT_STAGE, {
                shape: shape.id, width: 12, depth: 9, backWidth: 8, diameter: 12,
                apronWidth: 7, apronDepth: 2.5
            }));
        });
        var span = samples.reduce(function (m, o) {
            return Math.max(m, o.bounds.w, o.bounds.h);
        }, 0) * 1.12;

        $('#spShapeGrid').innerHTML = SP.STAGE_SHAPES.map(function (shape, i) {
            var b = samples[i].bounds;
            var vx = (b.x + b.w / 2 - span / 2).toFixed(3);
            var vy = (b.y + b.h / 2 - span / 2).toFixed(3);
            return '<button class="sp-shape-card" data-act="set-shape" data-shape="' + esc(shape.id) + '"' +
                ' aria-pressed="' + (stage.shape === shape.id ? 'true' : 'false') + '">' +
                '<svg viewBox="' + vx + ' ' + vy + ' ' + span.toFixed(3) + ' ' + span.toFixed(3) +
                '" preserveAspectRatio="xMidYMid meet"><path d="' + samples[i].d +
                '" vector-effect="non-scaling-stroke"/></svg>' +
                '<span class="sp-shape-text"><strong>' + esc(t(shape.name)) + '</strong>' +
                '<span>' + esc(t(shape.blurb)) + '</span></span></button>';
        }).join('');

        drawStagePreview();

        var shape = SP.shapeById(stage.shape);
        /* Jedes Maß hat seine eigene Erklärung; an der Überschrift hing bisher
           nur die der Breite, Tiefe und Vorbühne standen unerklärt da. */
        var FIELD_EXPLAIN = {
            width: 'stage.width', depth: 'stage.depth',
            apronWidth: 'stage.apron', apronDepth: 'stage.apron'
        };
        var dimensionFields = shape.fields.map(function (field) {
            var value = toField(SP.num(stage[field], 1));
            /* Seit dem Vieleck ist jedes Bühnenmaß eine Länge; die Zahl der
               Ecken war das einzige Feld, das gezählt statt gemessen hat. */
            return '<div><label for="spDim-' + field + '">' + esc(FIELD_LABELS[field] || field) +
                ' (' + lengthLabel() + ')' + why(FIELD_EXPLAIN[field] || '') + '</label>' +
                '<input type="number" id="spDim-' + field + '" data-stage-field="' + field + '"' +
                ' step="0.1" min="' + SP.STAGE_MIN + '" max="' + SP.STAGE_MAX +
                '" value="' + value + '"></div>';
        }).join('');

        var curtains = (stage.curtains || []).map(function (c) {
            return '<div class="sp-curtain-row">' +
                '<input type="text" value="' + esc(c.name) + '" data-curtain="' + esc(c.id) + '" data-curtain-field="name" aria-label="' + esc(t('Curtain name')) + '">' +
                '<input type="number" step="0.1" min="0" max="' +
                toField(SP.stageBound('curtain.offset', stage).most) +
                '" value="' + toField(SP.num(c.offset, 0)) +
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
            '<div class="sp-section"><h3>' + esc(t('Measurements')) + '</h3>' +
            '<div class="' + (shape.fields.length > 2 ? 'sp-field-row' : 'sp-field-row') + '">' + dimensionFields + '</div>' +
            '<p class="sp-hint" id="spStageReadout" style="margin-top:0.5rem">' +
            esc(t('The playing area comes out {w} across by {h} deep.', {
                w: SP.formatLength(SP.stageOutline(stage).bounds.w),
                h: SP.formatLength(SP.stageOutline(stage).bounds.h)
            })) + '</p></div>' +

            '<div class="sp-section"><h3>' + esc(t('Grid')) + '</h3>' +
            '<div class="sp-check-row"><label class="sp-check"><input type="checkbox" data-stage-flag="grid.show"' +
            (stage.grid.show ? ' checked' : '') + '> ' + esc(t('Draw a grid on the floor')) + '</label>' + why('stage.grid.show') + '</div>' +
            '<div class="sp-check-row"><label class="sp-check"><input type="checkbox" data-stage-flag="grid.labels"' +
            (stage.grid.labels ? ' checked' : '') + '> ' + esc(t('Letter and number the squares')) + '</label>' + why('stage.grid.labels') + '</div>' +
            '<div class="sp-field" style="margin-top:0.5rem"><label for="spGridSpacing">' +
            esc(t('Squares are ({unit})', { unit: lengthLabel() })) + why('stage.grid.spacing') +
            '</label><input type="number" id="spGridSpacing" step="' + SP.GRID_MIN + '" min="' + SP.GRID_MIN + '" ' +
            'data-stage-field="grid.spacing" value="' + toField(SP.num(stage.grid.spacing, 1)) + '"></div>' +
            '<p class="sp-hint">' + esc(t('Lettered squares give the crew something to call out: “the trunk goes in C4”.')) + '</p>' + '</div>' +

            '<div class="sp-section"><h3>' + esc(t('Guides')) + '</h3>' +
            '<div class="sp-check-row"><label class="sp-check"><input type="checkbox" data-stage-flag="centreLine"' +
            (stage.centreLine ? ' checked' : '') + '> ' + esc(t('Centre line')) + '</label>' + why('stage.centreLine') + '</div>' +
            '<div class="sp-check-row"><label class="sp-check"><input type="checkbox" data-stage-flag="settingLine"' +
            (stage.settingLine ? ' checked' : '') + '> ' + esc(t('Setting line')) + '</label>' + why('stage.settingLine') + '</div>' +
            '<label class="sp-check"><input type="checkbox" data-stage-flag="scaleBar"' +
            (stage.scaleBar ? ' checked' : '') + '> ' + esc(t('Scale bar')) + '</label></div>' +

            (SP.hasWings(stage) ? '<div class="sp-section"><h3>' + esc(t('Wings')) + why('stage.wings') + '</h3>' +
            '<div class="sp-check-row"><label class="sp-check"><input type="checkbox" data-stage-flag="wings.show"' +
            (stage.wings.show ? ' checked' : '') + '> ' + esc(t('Mark the wings')) + '</label></div>' +
            (stage.wings.show ? '' : '<p class="sp-hint">' +
                esc(t('With the wings marked you can put notes in them on the plan — for anything that has to be standing by without being on stage.')) + '</p>') +
            (stage.wings.show ? '<div class="sp-field-row" style="margin-top:0.5rem">' +
                '<div><label for="spWingInset">' + esc(t('Inset from the side')) +
                ' (' + esc(lengthLabel()) + ')</label>' +
                '<input type="number" id="spWingInset" step="0.1" min="0.05" max="' +
                toField(SP.stageBound('wings.inset', stage).most, 2) +
                '" data-stage-number="wings.inset" value="' +
                toField(stage.wings.inset, 2) + '"></div>' +
                '<div><label for="spWingDepth">' + esc(t('How far forward')) +
                ' (' + esc(lengthLabel()) + ')</label>' +
                '<input type="number" id="spWingDepth" step="0.1" min="0.05" max="' +
                toField(SP.stageBound('wings.depth', stage).most, 2) +
                '" data-stage-number="wings.depth" value="' +
                toField(stage.wings.depth, 2) + '"></div></div>' : '') +
            '</div>' : '') +

            '<div class="sp-section"><h3>' + esc(t('Curtains')) + why('stage.curtains') + '</h3>' +
            (curtains ? '<div style="margin-bottom:0.5rem"><div class="sp-curtain-row" style="font-size:0.7rem;color:var(--sp-muted)">' +
                '<span>' + esc(t('Name')) + '</span><span>' + esc(t('Upstage ({unit})', { unit: lengthLabel() })) + why('stage.curtain.offset') + '</span><span>' + esc(t('Normally')) + '</span><span></span></div>' +
                curtains + '</div>' : '<p class="sp-hint">' + esc(t('No curtain marked.')) + '</p>') +
            '<div class="sp-btn-row"><button class="sp-btn" data-act="add-curtain">' + esc(t('Add a curtain')) + '</button></div>' +
            '<p class="sp-hint" style="margin-top:0.5rem">' +
            esc(t('Measured upstage from the setting line. Each scene can open or close them on its own.')) +
            '</p></div>' +

            '';
    }

    /* ================================================================== *
     * Bühnenmaße direkt am Bild ziehen
     *
     * Die Zahlenfelder rechts bleiben, wie sie sind — sie sind genauer und
     * für manche Maße der einzige Weg. Aber wer eine Bühne einrichtet, hat
     * ein Bild im Kopf und keine Tabelle, und Breite, Tiefe, Gassen und
     * Vorhänge lassen sich hier anfassen. Ein Zug ist ein Undo-Schritt.
     * ================================================================== */

    var SVGNS = 'http://www.w3.org/2000/svg';

    function drawStagePreview() {
        var host = $('#spStagePreview');
        if (!host) return;
        host.innerHTML = SPPlan.svg({
            stage: editingStage(),
            scene: scene() || { placements: [] },
            resolve: resolveProp,
            labels: 'none',
            idPrefix: 'stage-preview'
        });
        mountStageHandles();
    }

    /* Wo sitzt welcher Griff. Nur Maße, die diese Form überhaupt hat. */
    function stageHandleSpecs(stage) {
        var shape = SP.shapeById(stage.shape);
        var out = SP.stageOutline(stage);
        var b = out.bounds;
        var has = function (f) { return shape.fields.indexOf(f) > -1; };
        var specs = [];

        if (has('width')) {
            var half = SP.num(stage.width, b.w) / 2;
            specs.push({ key: 'width', x: -half, y: out.frontY, cursor: 'ew-resize', label: t('Width') });
            specs.push({ key: 'width', x: half, y: out.frontY, cursor: 'ew-resize', label: t('Width') });
        }
        if (has('diameter')) {
            specs.push({ key: 'diameter', x: SP.num(stage.diameter, b.w) / 2, y: b.y + b.h / 2,
                cursor: 'ew-resize', label: t('Diameter') });
        }
        if (has('depth')) {
            specs.push({ key: 'depth', x: 0, y: b.y + SP.num(stage.depth, b.h),
                cursor: 'ns-resize', label: t('Depth') });
        }
        {
            SP.wingLines(stage).forEach(function (line, side) {
                specs.push({ key: 'wings.inset', side: side, x: line[0][0],
                    y: b.y + (line[1][1] - b.y) / 2, cursor: 'ew-resize', label: t('Inset from the side') });
                specs.push({ key: 'wings.depth', x: line[1][0], y: line[1][1],
                    cursor: 'ns-resize', label: t('How far forward') });
            });
        }
        (stage.curtains || []).forEach(function (curtain) {
            specs.push({ key: 'curtain', id: curtain.id, x: 0,
                y: out.frontY - SP.num(curtain.offset, 0), cursor: 'ns-resize',
                label: curtain.name || t('Curtain') });
        });
        return specs;
    }

    /* Aus einem Punkt in Metern wird der neue Wert für dieses Maß. */
    function stageHandleValue(spec, stage, px, py) {
        var out = SP.stageOutline(stage);
        var b = out.bounds;
        if (spec.key === 'width' || spec.key === 'diameter') return Math.abs(px) * 2;
        if (spec.key === 'depth' || spec.key === 'wings.depth') return py - b.y;
        if (spec.key === 'wings.inset') return spec.side ? (b.x + b.w - px) : (px - b.x);
        if (spec.key === 'curtain') return out.frontY - py;
        return 0;
    }

    function applyStageHandle(spec, value) {
        var stage = editingStage();
        if (spec.key === 'curtain') {
            var curtain = (stage.curtains || []).filter(function (c) { return c.id === spec.id; })[0];
            if (curtain) {
                var bound = SP.stageBound('curtain.offset', stage);
                curtain.offset = SP.clamp(value, bound.least, bound.most);
            }
            return;
        }
        if (spec.key === 'wings.inset' || spec.key === 'wings.depth') {
            var wb = SP.stageBound(spec.key, stage);
            stage.wings[spec.key.split('.')[1]] = SP.clamp(value, wb.least, wb.most);
            return;
        }
        stage[spec.key] = SP.clamp(value, SP.STAGE_MIN, SP.STAGE_MAX);
    }

    /* Feldwerte nachziehen, damit Bild und Panel nie auseinanderlaufen. */
    function syncStageFields() {
        var stage = editingStage();
        SP.shapeById(stage.shape).fields.forEach(function (field) {
            var el = $('#spDim-' + field);
            if (el && document.activeElement !== el) {
                el.value = toField(SP.num(stage[field], 1));
            }
        });
        var inset = $('#spWingInset');
        if (inset && document.activeElement !== inset) inset.value = toField(stage.wings.inset, 2);
        var wdepth = $('#spWingDepth');
        if (wdepth && document.activeElement !== wdepth) wdepth.value = toField(stage.wings.depth, 2);
        (stage.curtains || []).forEach(function (curtain) {
            var el = $('[data-curtain="' + curtain.id + '"][data-curtain-field="offset"]');
            if (el && document.activeElement !== el) el.value = toField(SP.num(curtain.offset, 0));
        });
    }

    function previewPoint(svg, evt, frozenMatrix) {
        var matrix = frozenMatrix || svg.getScreenCTM();
        if (!matrix) return { x: 0, y: 0 };
        var point = svg.createSVGPoint();
        point.x = evt.clientX;
        point.y = evt.clientY;
        return point.matrixTransform(matrix.inverse());
    }

    function mountStageHandles() {
        var svg = $('#spStagePreview svg');
        if (!svg) return;
        var stage = editingStage();
        var bounds = SP.stageOutline(stage).bounds;
        var radius = Math.max(bounds.w, bounds.h) * 0.017;
        var specs = stageHandleSpecs(stage);

        var group = document.createElementNS(SVGNS, 'g');
        group.setAttribute('class', 'sp-stage-handles');
        specs.forEach(function (spec, i) {
            var dot = document.createElementNS(SVGNS, 'circle');
            dot.setAttribute('class', 'sp-stage-handle');
            dot.setAttribute('cx', spec.x);
            dot.setAttribute('cy', spec.y);
            dot.setAttribute('r', radius);
            dot.setAttribute('tabindex', '0');
            dot.setAttribute('role', 'slider');
            dot.setAttribute('aria-label', spec.label);
            dot.setAttribute('style', 'cursor:' + spec.cursor);
            dot.setAttribute('data-handle', String(i));
            group.appendChild(dot);
        });
        svg.appendChild(group);

        group.addEventListener('pointerdown', function (e) {
            var dot = e.target.closest('.sp-stage-handle');
            if (!dot) return;
            e.preventDefault();
            var spec = specs[Number(dot.getAttribute('data-handle'))];
            /* Die Geometrie beim Anfassen einfrieren. Rechnete man gegen die
               laufend veränderte Bühne, schaukelt sich der Wert auf. */
            var frozen = JSON.parse(JSON.stringify(editingStage()));
            var moved = false;
            /* Auch das Bild einfrieren, nicht nur die Zahlen. Die Vorschau
               passt sich nach jedem Schritt neu ein; rechnete man den
               Mauszeiger durch das jeweils neue Bild, wanderte der Griff unter
               dem Zeiger mit, und die Bühne wuchs von selbst weiter. Bei der
               halbrunden Bühne, die nur ein einziges Maß hat, hob sich das
               genau auf: ein Zug, und sie war riesig. */
            var view = svg.getScreenCTM();
            beginHistory();

            /* Am Fenster hängen, nicht am Griff: die Vorschau wird bei jedem
               Schritt neu gezeichnet, der Griff darunter also ausgetauscht.
               Aus demselben Grund muss das SVG jedes Mal neu geholt werden —
               das alte hängt nicht mehr im Dokument und hat keine Matrix. */
            function move(ev) {
                var live = $('#spStagePreview svg');
                if (!live) return;
                var point = previewPoint(live, ev, view);
                var step = ev.shiftKey ? 0.01 : 0.1;
                var value = stageHandleValue(spec, frozen, point.x, point.y);
                applyStageHandle(spec, Math.round(value / step) * step);
                moved = true;
                drawStagePreview();
                syncStageFields();
                setStageReadout();
            }
            function up() {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                if (moved) { commitHistory(); persist(); render(); } else { cancelHistory(); }
            }
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        });

        /* Mit der Tastatur genauso: Pfeiltasten schieben den Griff. */
        group.addEventListener('keydown', function (e) {
            var dot = e.target.closest('.sp-stage-handle');
            if (!dot) return;
            var delta = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
            if (!delta) return;
            e.preventDefault();
            var spec = specs[Number(dot.getAttribute('data-handle'))];
            var stageNow = editingStage();
            var current = spec.key === 'curtain'
                ? SP.num(((stageNow.curtains || []).filter(function (c) { return c.id === spec.id; })[0] || {}).offset, 0)
                : (spec.key.indexOf('wings.') === 0
                    ? SP.num(stageNow.wings[spec.key.split('.')[1]], 1)
                    : SP.num(stageNow[spec.key], 1));
            change(function () {
                applyStageHandle(spec, current + delta * (e.shiftKey ? 0.01 : 0.1));
            });
        });
    }

    function setStageReadout() {
        var el = $('#spStageReadout');
        if (!el) return;
        var b = SP.stageOutline(editingStage()).bounds;
        el.textContent = t('The playing area comes out {w} across by {h} deep.', {
            w: SP.formatLength(b.w),
            h: SP.formatLength(b.h)
        });
    }

    /* ================================================================== *
     * Prop library tab
     * ================================================================== */

    /* Wie oft ein Requisit in dieser Produktion steht. Vorher wurde über alle
       Produktionen gezählt: der Fundus meldete „Bett 1× verwendet" für einen
       Abend, in dem kein Bett vorkam. */
    function usageCount(propId) {
        var total = 0;
        (production().scenes || []).forEach(function (s) {
            (s.placements || []).forEach(function (pl) { if (pl.propId === propId) total += 1; });
        });
        return total;
    }

    /* Beim Löschen zählt dagegen alles: ein eigenes Requisit verschwindet aus
       jeder Produktion, nicht nur aus der offenen — und ein Ort hält eine
       eigene Kopie seines Bühnenbilds, die genauso mitgezählt gehört. */
    function usageEverywhere(propId) {
        return SP.countPropUses(db.productions, propId);
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
            var art = artThumb(prop);
            return '<div class="sp-lib-card">' +
                (prop.builtin ? '' : '<span class="sp-lib-tools">' +
                    /* Ein Stift und ein Kreuz, weil beide an jeder Kachel
                       hängen: als Wörter tragen sie den Namen der Requisite
                       zu, und das Kreuz war ein Schriftzeichen, das in jeder
                       Schrift anders sitzt. */
                    '<button class="sp-tool" data-act="edit-prop" data-prop="' + esc(prop.id) +
                    '" title="' + esc(t('Edit')) + '" aria-label="' + esc(t('Edit')) + '">' + ICON.pencil + '</button>' +
                    '<button class="sp-tool is-danger" data-act="delete-prop" data-prop="' + esc(prop.id) +
                    '" title="' + esc(t('Delete')) + '" aria-label="' + esc(t('Delete')) + '">' + ICON.cross + '</button>' +
                    '</span>') +
                art +
                '<div>' + esc(t(prop.name)) + '</div>' +
                '<div class="sp-lib-meta">' +
                /* Dieselbe Regel wie in der Palette: das Maß steht dort, wo man
                   damit plant. Bei einem Glas zählt, dass man es erkennt. */
                (handProp(prop) ? ''
                    : toField(prop.w, 2) + ' × ' + toField(prop.h, 2) + ' ' + lengthLabel()) +
                (prop.builtin ? '' : (handProp(prop) ? '' : ' · ') +
                    '<span class="sp-badge">' + esc(t('yours')) + '</span>') + '</div>' +
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
                : t('Nothing added yet. A PNG, JPEG or SVG works.')) +
            /* Die Erklärung zu „Requisit zeichnen" hing hier unter einem
               Absatz und damit an nichts. Sie steht jetzt an ihrem Knopf. */
            '</p></div>' +

            '<div class="sp-section"><h3>' + esc(t('Browser storage')) + '</h3>' +
            '<p class="sp-hint">' + esc(t('Everything you have made takes about {size}. Browsers usually stop somewhere around 5 MB, so keep custom drawings small and take a backup from time to time.', { size: formatBytes(bytes) })) + '</p>' +
            '</div>';
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
                    return '<option value="' + esc(c) + '"' + (draft.cat === c ? ' selected' : '') + '>' + esc(t(c)) + '</option>';
                }).join('') + '</select></div>' +
                '<div class="sp-field-row">' +
                '<div><label for="spPropW">' + esc(t('Across ({unit})', { unit: lengthLabel() })) + '</label>' +
                '<input type="number" id="spPropW" step="0.05" min="0.05" value="' + toField(draft.w) + '"></div>' +
                '<div><label for="spPropH">' + esc(t('Deep ({unit})', { unit: lengthLabel() })) + '</label>' +
                '<input type="number" id="spPropH" step="0.05" min="0.05" value="' + toField(draft.h) + '"></div>' +
                '</div>' +
                '<div class="sp-field"><label for="spPropFile">' + esc(t('Drawing (PNG, JPEG or SVG)')) + '</label>' +
                '<span class="sp-file-row">' +
                '<input type="file" id="spPropFile" accept="image/png,image/jpeg,image/svg+xml,image/webp">' +
                '<label class="sp-btn sp-file-button" for="spPropFile">' + esc(t('Choose a file')) + '</label>' +
                '<span class="sp-file-name" id="spPropFileName">' + esc(t('None chosen')) + '</span>' +
                '</span></div>' +
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
            var nameSlot = $('#spPropFileName', modal.body);
            if (nameSlot) nameSlot.textContent = file ? file.name : t('None chosen');
            if (!file) return;
            processImage(file, function (dataUrl) {
                if (!dataUrl) { toast(t('That file could not be read as a picture.'), 'error'); return; }
                draft.image = dataUrl;
                $('#spPropPreview', modal.body).innerHTML = '<img src="' + esc(dataUrl) + '" style="max-height:90px">';
            });
        });
    }

    function deleteCustomProp(id) {
        var uses = usageEverywhere(id);
        var message = uses
            ? SPI18n.plural(uses,
                'This prop stands in one place across all your productions. Deleting it leaves that place empty. Carry on?',
                'This prop stands in {n} places across all your productions. Deleting it leaves those places empty. Carry on?')
            : t('Delete this prop?');
        if (!window.confirm(message)) return;
        change(function () {
            db.library = db.library.filter(function (p) { return p.id !== id; });
            /* Auch aus dem gespeicherten Bühnenbild der Orte. Ohne das blieb
               dort eine Aufstellung stehen, die auf nichts mehr zeigt: kein
               Plan zeichnete sie, die Ablaufliste zählte sie mit, und
               „Bühnenbild dieses Orts einsetzen" trug sie in die Szene
               zurück. */
            SP.dropProp(db.productions, id);
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
    /* Breite und Tiefe eines selbst gezeichneten Requisits. Die Breite ist,
       was jemand eintippt; die Tiefe folgt aus dem Verhältnis der Zeichnung,
       weil sie gleichmäßig gesetzt wird. */
    function drawnFootprint(shapes, width) {
        var box = SPDraw.boundsOf(shapes);
        var w = Math.max(0.05, width);
        if (!(box.w > 0) || !(box.h > 0)) return { w: w, h: w };
        return { w: SP.round(w, 3), h: SP.round(Math.max(0.05, w * box.h / box.w), 3) };
    }

    function drawPoint(e) {
        var box = draw.board || $('#spDrawBoard', draw.body).getBoundingClientRect();
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
        /* Die Tiefe wird nicht gelesen, sondern gerechnet — und gleich ins
           Feld geschrieben, damit dort steht, was später gespeichert wird. */
        var h = drawnFootprint(draw.shapes, w).h;
        var depthField = $('#spDrawH', draw.body);
        if (depthField) depthField.value = toField(h);
        var seen = SPDraw.boundsOf(draw.shapes);
        var prop = { id: 'sp-drawn', name: '', cat: '', w: w, h: h,
            box: [seen.x, seen.y, seen.w, seen.h], art: SPDraw.markup(draw.shapes) };
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
            labels: 'none', idPrefix: 'spdrawn',
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
        /* Vor allem anderen messen: gleich darauf verschiebt das Neuzeichnen
           des Dialogs das Feld unter dem Finger weg. */
        draw.board = board.getBoundingClientRect();
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
        draw.board = null;
        if (!draw.drag) return;
        var gesture = draw.drag;
        draw.drag = null;
        /* Ein Klick ohne Ziehen darf keine unsichtbare Form hinterlassen —
           sonst sammeln sich Nullflächen, die niemand wieder findet. */
        if (gesture.type === 'draw' && !SPDraw.isDrawable(draw.shapes[draw.sel])) {
            draw.shapes.splice(draw.sel, 1);
            draw.sel = -1;
            draw.undo.pop();
        } else if (gesture.type === 'draw' && draw.sel > -1) {
            /* Die frisch gezogene Form bleibt ausgewählt und das Werkzeug
               springt zurück auf Auswählen. Sonst zeichnet der nächste Zug
               ein zweites Rechteck, statt das erste zu ändern — genau der
               Griff, den man als Erstes machen will. */
            draw.tool = 'select';
        }
        drawRender();
    }

    /* Bricht den angefangenen Linienzug ab und lässt alles andere stehen. */
    function drawCancelRun() {
        if (!draw.run) return;
        draw.run = null;
        draw.cursor = null;
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
            /* Die Zeichnung wird gleichmäßig gesetzt, damit aus dem Kreis
               keine Ellipse wird. Die Tiefe folgt also aus der Breite und dem,
               was gezeichnet ist — als Feld war sie ein Versprechen, das beim
               Speichern gebrochen wurde. Jetzt steht sie da und rechnet mit. */
            '<input type="number" id="spDrawH" value="' + toField(start.h) +
            '" readonly tabindex="-1" title="' +
            esc(t('Follows the width and the drawing')) + '"></div>' +
            '</div>' +
            '<p class="sp-hint" style="margin:-0.3rem 0 0">' +
            esc(t('The depth follows the width, so the drawing keeps its shape.')) + '</p>' +
            '<div class="sp-field"><label for="spDrawTags">' + esc(t('Search words')) + '</label>' +
            '<input type="text" id="spDrawTags" value="' + esc(start.tags || '') + '" placeholder="' +
            esc(t('chair table wooden')) + '"></div>' +
            '</div></div></div>';

        var modal = openModal({
            title: existing ? t('Edit the drawing') : t('Draw your own prop'),
            modalClass: 'is-draw',
            body: body,
            onClose: function () { draw = null; },
            onEscape: function () {
                /* Erst den angefangenen Zug, dann die Auswahl, dann erst zu. */
                if (draw && draw.run) { drawCancelRun(); return false; }
                if (draw && draw.sel > -1) { draw.sel = -1; drawRender(); return false; }
            },
            actions: [{
                label: existing ? t('Save') : t('Add it'),
                primary: true,
                onClick: function (host) {
                    var name = $('#spDrawName', host).value.trim();
                    var shapes = SPDraw.clean(draw.shapes);
                    if (!name) { toast(t('Give the prop a name.'), 'error'); return false; }
                    if (!shapes.length) { toast(t('Draw something first.'), 'error'); return false; }
                    /* Wie weit die Zeichnung in ihrem Feld reicht, wird
                       einmal beim Speichern gemessen und mitgeschrieben. Der
                       Plan misst nie selbst nach: unter Node gibt es nichts zu
                       messen, und was auf dem Papier landet, soll nicht davon
                       abhängen, wie ein Browser rundet. */
                    var drawnBox = SPDraw.boundsOf(shapes);
                    var typedW = fromField($('#spDrawW', host).value, 0);
                    if (!(typedW > 0.04)) {
                        /* Vorher wurden 0 und −3 stillschweigend zu 0,05 —
                           man drückte auf Hinzufügen und bekam ein Requisit,
                           das man nicht gemeint hatte. */
                        toast(t('Give it a real width, above 5 cm.'), 'error');
                        return false;
                    }
                    /* Eine Zeichnung wird gleichmäßig gesetzt, damit aus dem
                       Kreis keine Ellipse wird. Die Breite führt, die Tiefe
                       folgt aus dem Verhältnis der Zeichnung — sonst stand in
                       jedem Feld „2 m" und auf der Bühne lagen 10 cm. */
                    var size = drawnFootprint(shapes, typedW);
                    var made = {
                        id: existing ? existing.id : SP.uid('prop'),
                        name: name,
                        cat: $('#spDrawCat', host).value,
                        w: size.w,
                        h: size.h,
                        box: [drawnBox.x, drawnBox.y, drawnBox.w, drawnBox.h],
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
                            /* Eine geänderte Zeichnung hat ein anderes
                               Verhältnis. Ohne das hier behielten schon
                               gestellte Exemplare ihre alte Tiefe und wurden
                               beim Zeichnen kleiner, während im Feld weiter
                               die alte Zahl stand. */
                            /* Über Szenen und Orte: der Ort hält eine eigene
                               Kopie. Blieb sie stehen, meldete er danach eine
                               Abweichung, die niemand verschoben hatte, und
                               setzte beim Einsetzen das alte Maß zurück. */
                            db.productions.forEach(function (prod) {
                                SP.placementLists(prod).forEach(function (list) {
                                    list.forEach(function (pl) {
                                        if (pl.propId !== made.id) return;
                                        var again = drawnFootprint(shapes, pl.w);
                                        pl.w = again.w;
                                        pl.h = again.h;
                                    });
                                });
                            });
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
            undo: [], redo: [], drag: null, run: null, cursor: null, board: null
        };

        /* Escape ist hier geschützt, der Klick daneben war es nicht — also
           war ausgerechnet die ungenauere Geste die gefährliche. */
        modal.element.addEventListener('click', function (e) {
            if (e.target !== modal.element) return;
            if (!draw.shapes.length) return;
            if (window.confirm(t('Throw this drawing away?'))) return;
            e.stopPropagation();
        }, true);

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
        /* Und derselbe Riegel beim Lesen, für alles, was schon mit einem
           toten Akt im Bereich gespeichert wurde. Ohne Akte wird das Feld gar
           nicht gezeichnet — von Hand käme man da nicht wieder heraus. */
        if (p.print.scope && p.print.scope !== 'all' &&
            !(p.acts || []).some(function (a) { return a.id === p.print.scope; })) {
            p.print.scope = 'all';
        }
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
            '<div class="sp-doc-switch" role="tablist">' +
            '<button class="sp-doc' + (doc === 'plans' ? ' is-on' : '') + '" data-act="print-doc" data-doc="plans">' +
            '<b>' + esc(t('The plans')) + '</b><span>' + esc(t('One scene to a sheet.')) + '</span></button>' +
            '<button class="sp-doc' + (doc === 'changeover' ? ' is-on' : '') + '" data-act="print-doc" data-doc="changeover">' +
            '<b>' + esc(t('The Umbauplan')) + '</b><span>' + esc(t('The table for every changeover.')) + '</span></button>' +
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
                scope + '</div>' +

                '<div class="sp-section" style="padding-left:0;padding-right:0"><h3>' +
                esc(t('Sheets to print')) + '</h3>' +
                printCheck('cover', t('Title sheet'), o, 'print.cover') +
                printCheck('actPages', t('A divider before each act'), o, 'print.actPages') +
                printCheck('scenePages', t('One sheet per scene'), o, 'print.scenePages') +
                printCheck('overview', t('Overview sheets'), o, 'print.overview') +
                '<div class="sp-field" style="margin-top:0.6rem"><label for="spPrintLabels">' +
                esc(t('Labels on the plan')) +
                why('print.labels') + '</label><select id="spPrintLabels" data-print="labels">' +
                [['name', t('Prop names')], ['custom', t('Written labels only')], ['both', t('Name and label')],
                 ['none', t('No labels')]].map(function (opt) {
                    return '<option value="' + opt[0] + '"' + (o.labels === opt[0] ? ' selected' : '') + '>' +
                        esc(opt[1]) + '</option>';
                }).join('') + '</select></div>' +
                '</div>' +

                '<details class="sp-more"' + (ui.printMore ? ' open' : '') + '>' +
                '<summary>' + esc(t('Everything else')) + '</summary>' +
                '<div class="sp-section" style="padding-left:0;padding-right:0"><h3>' +
                esc(t('What stands on the scene sheet')) + '</h3>' +
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
                (o.showFooter ? footer : '') +
                printCheck('numberOutside', t('Number only, beside the stage'), o, 'print.numberOutside') +
                '</div>' +

                '<div class="sp-section" style="padding-left:0;padding-right:0"><h3>' +
                esc(t('Prop inventory')) + '</h3>' +
                printCheck('inventory', t('Prop inventory'), o, 'print.inventory') + '</div>' +

                '<div class="sp-section" style="padding-left:0;padding-right:0"><h3>' +
                esc(t('Overview sheets')) + '</h3>' +
                printCheck('overviewAuto', t('All the scenes on one sheet'), o, 'print.overviewAuto') +
                '<div class="sp-field"><label for="spOverviewSize">' + esc(t('Scenes to a sheet')) +
                why('print.overviewSize') + '</label><select id="spOverviewSize" data-act="overview-size">' +
                [[2, 2], [3, 2], [3, 3], [4, 3], [4, 4], [5, 5], [6, 4]].map(function (g) {
                    return '<option value="' + g[0] + 'x' + g[1] + '"' +
                        (o.overviewCols === g[0] && o.overviewRows === g[1] ? ' selected' : '') + '>' +
                        esc(SPI18n.plural(g[0] * g[1], '{cols} by {rows}, one scene',
                            '{cols} by {rows}, {n} scenes',
                            { cols: g[0], rows: g[1] })) + '</option>';
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
                '</div></details>';
        }

        $('#spPrintOptions').innerHTML = head + body +
            '<div class="sp-section" style="padding-left:0;padding-right:0">' +
            '<div class="sp-btn-row"><button class="sp-btn is-primary" data-act="do-print">' +
            esc(doc === 'changeover' ? t('Print the Umbauplan') : t('Print the plans')) + '</button></div>' +
            '<p class="sp-page-count" id="spPageCount" style="margin-top:0.5rem"></p>' +
            '<p class="sp-hint">' + esc(t('In the print dialogue: margins to none, background graphics on.')) + '</p></div>';

        var more = $('.sp-more', $('#spPrintOptions'));
        if (more) {
            more.addEventListener('toggle', function () {
                ui.printMore = more.open;
                persistUi();
            });
        }

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
            /* Die Einführung wurde gesetzt, bevor es hier Blätter gab — sie
               suchte sich eine freie Stelle und landete auf dem ×. */
            var open = $('.sp-intro');
            if (open) placeIntro(open, open.dataset.tab);
        }, 120);
    }

    /* Jeder Weg zum Drucker füllt denselben Vorrat: der Knopf im Reiter, aber
       auch Strg+P und das Menü des Browsers. Vorher füllte ihn nur der Knopf,
       und die Druck-CSS blendet alles außer dem Vorrat aus — wer den
       gewohnten Weg nahm, bekam ein weißes Blatt. */
    function fillPrintPortal() {
        var portal = $('#spPrintPortal');
        if (!portal || portal.innerHTML) return false;
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
        return true;
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

        /* Einmal geschrieben, zweimal gebraucht: beim Speichern und beim
           Verlassen über einen der Knöpfe im Rumpf. */
        function readFields(host) {
            change(function () {
                p.name = $('#spProdName', host).value.trim() || t('Untitled production');
                p.subtitle = $('#spProdSub', host).value;
                p.venue = $('#spProdVenue', host).value;
                p.notes = $('#spProdNotes', host).value;
                p.directions = $('#spProdDirections', host).value;
                p.numbering = $('#spNumbering', host).value;
                SP.setDirections(p.directions);
            });
        }

        openModal({
            title: t('Production'),
            /* „Diese duplizieren" führt aus dem Dialog heraus. Wer vorher den
               Namen geändert hatte, bekam die Kopie unter dem alten Namen und
               keine Meldung — das Getippte war weg. */
            onLeave: readFields,
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
                [['continuous', t('Straight through (1, 2, 3 …)')],
                 ['per-act', t('Restart in each act (I.1, I.2, II.1 …)')],
                 ['per-act-roman', t('Restart in each act, roman (I.I, I.II, II.I …)')]].map(function (opt) {
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
                why('store.restore') +
                (db.productions.length > 1
                    ? '<button class="sp-btn is-danger" data-act="delete-production">' + esc(t('Delete this production')) + '</button>' : '') +
                '</div>',
            actions: [{
                label: t('Save'), primary: true,
                onClick: readFields
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
        if (!window.confirm(SPI18n.plural(p.scenes.length,
        'Delete “{name}” with its one scene?',
        'Delete “{name}” with its {n} scenes?', { name: p.name }))) return;
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
            kind: 'linu.li/buehnenbild',
            version: 1,
            exported: new Date().toISOString(),
            data: db
        }, null, 2);
        var name = (production().name || 'scene-plan').replace(/[^\w\d\- ]+/g, '').replace(/\s+/g, '-').toLowerCase();
        downloadBlob(new Blob([payload], { type: 'application/json' }), name + '-scene-plan.json');
        toast(t('Backup saved to your downloads.'), 'success');
    }

    /* Eine Sicherung einzuspielen war die gefährlichste Stelle des Planers.
       Die Rückfrage lief über window.confirm, und dort hieß „Abbrechen":
       alles ersetzen — also löste ausgerechnet die Abbruchgeste, und mit ihr
       Escape, die einzige unumkehrbare Handlung aus. Geprüft wurde außerdem
       nur, ob productions ein Array ist: eine Datei mit leerer Liste hat die
       Oberfläche in einen toten Zustand gebracht, eine mit einem leeren
       Objekt darin hat kommentarlos alles ersetzt und Erfolg gemeldet. */

    var BACKUP_VERSION = 1;

    function readableBackup(parsed) {
        var incoming = parsed && parsed.data ? parsed.data : parsed;
        if (!incoming || !Array.isArray(incoming.productions)) return null;
        var usable = incoming.productions.filter(function (p) {
            return p && typeof p === 'object' && typeof p.id === 'string' && p.id &&
                Array.isArray(p.scenes);
        });
        if (!usable.length) return null;
        incoming.productions = usable;
        incoming.library = Array.isArray(incoming.library) ? incoming.library : [];
        /* Eine Datei aus einer späteren Fassung wird gelesen, aber nicht
           stillschweigend: was diese Fassung nicht kennt, fällt beim
           Einspielen weg, und das soll dabeistehen, bevor jemand „Alles
           ersetzen" drückt. */
        incoming.fromLater = !!(parsed && parsed.version > BACKUP_VERSION);
        return incoming;
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
                var incoming = readableBackup(parsed);
                if (!incoming) {
                    toast(t('That file is not a scene plan.'), 'error');
                    return;
                }
                askHowToRestore(incoming);
            };
            reader.readAsText(file);
        });
        input.click();
    }

    function askHowToRestore(incoming) {
        var count = incoming.productions.length;
        var names = incoming.productions.map(function (p) {
            return p.name || t('Untitled production');
        });
        openModal({
            title: t('Restore from a backup'),
            cancelLabel: t('Do nothing'),
            body: '<p style="margin-bottom:0.6rem">' +
                esc(SPI18n.plural(count, 'The file holds 1 production:', 'The file holds {n} productions:')) +
                '</p><ul class="sp-hint" style="margin:0 0 0.9rem 1.1rem">' +
                names.map(function (name) { return '<li>' + esc(name) + '</li>'; }).join('') +
                '</ul><p class="sp-hint">' +
                esc(SPI18n.plural(db.productions.length,
                    'You have 1 production open. Adding leaves it alone; replacing deletes it.',
                    'You have {n} productions open. Adding leaves them alone; replacing deletes them.')) +
                '</p>' +
                (incoming.fromLater
                    ? '<p class="sp-hint" style="margin-top:0.6rem"><strong>' +
                      esc(t('This file comes from a later version of the planner. Anything it knows that this one does not will be dropped.')) +
                      '</strong></p>'
                    : ''),
            actions: [
                {
                    label: t('Add them alongside'),
                    primary: true,
                    onClick: function (body, close) { restoreBackup(incoming, false); close(); }
                },
                {
                    /* Das Ersetzen steht als eigener Knopf da und ist als
                       gefährlich gekennzeichnet. Vorher war es die Rückseite
                       von „Abbrechen". */
                    label: t('Replace everything'),
                    danger: true,
                    onClick: function (body, close) {
                        if (!window.confirm(t('Delete everything in this browser and put the backup in its place?'))) return false;
                        restoreBackup(incoming, true);
                        close();
                    }
                }
            ]
        });
    }

    function restoreBackup(incoming, replace) {
        change(function () {
            incoming.productions.forEach(migrateProduction);
            (incoming.library || []).forEach(migrateProp);
            var wanted = incoming.activeId &&
                incoming.productions.some(function (p) { return p.id === incoming.activeId; })
                ? incoming.activeId : incoming.productions[0].id;
            if (replace) {
                db.productions = incoming.productions;
                db.library = incoming.library;
            } else {
                incoming.productions.forEach(function (p) {
                    if (db.productions.some(function (x) { return x.id === p.id; })) {
                        var fresh = SP.uid('prod');
                        if (p.id === wanted) wanted = fresh;
                        p.id = fresh;
                    }
                    db.productions.push(p);
                });
                (incoming.library || []).forEach(function (prop) {
                    if (!libraryById(prop.id)) db.library.push(prop);
                });
            }
            /* Offen ist danach die Produktion, die beim Sichern offen war —
               vorher landete man beim Dazunehmen immer auf der ersten der
               Datei und sah auf eine leere Bühne. */
            db.activeId = wanted;
            ui.sceneId = (scenes()[0] || {}).id;
            ui.selection = [];
            ui.view = null;
        });
        toast(t('Backup restored.'), 'success');
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

        /* Kommt das Loslassen nicht an — der Zeiger verlässt das Fenster, ein
           anderes Fenster nimmt den Fokus, das Betriebssystem schluckt das
           Ereignis —, lief der Zug weiter: das Requisit klebte am Zeiger, bis
           irgendwo wieder geklickt wurde. `buttons` sagt, ob überhaupt noch
           eine Taste gedrückt ist. */
        if (drag && e.buttons === 0) {
            onCanvasPointerUp(e);
            return;
        }

        if (!drag) {
            var here = stagePoint(e);
            var stage = stageOf(sc);
            var ref = stage.grid && stage.grid.labels
                ? SP.gridReference(stage, here.x, here.y, SP.num(stage.grid.spacing, 1)) + ' · ' : '';
            readout.textContent = ref + SP.describePosition(stage, here.x, here.y);
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
            var snapped = e.altKey
                ? { x: SP.round(rawX, 3), y: SP.round(rawY, 3) }
                : { x: snap(rawX, e.shiftKey), y: snap(rawY, e.shiftKey) };
            var shiftX = snapped.x - lead.x;
            var shiftY = snapped.y - lead.y;
            drag.items.forEach(function (entry) {
                entry.ref.x = SP.round(entry.x + shiftX, 3);
                entry.ref.y = SP.round(entry.y + shiftY, 3);
                holdSpot(entry.ref);
                setNodeTransform(itemNode(entry.ref.id), entry.ref);
            });
            renderOverlay();
            refreshItemReadouts();
            $('#spPointerReadout').textContent = SP.describePosition(stageOf(sc), lead.ref.x, lead.ref.y);
            setModifierHint('move');
            return;
        }

        if (drag.mode === 'rotate') {
            var target = findPlacement(drag.id);
            if (!target) return;
            var angle = Math.atan2(point.y - target.y, point.x - target.x) * 180 / Math.PI + 90;
            if (!e.altKey) {
                var stepDeg = e.shiftKey ? 5 : 15;
                angle = Math.round(angle / stepDeg) * stepDeg;
            }
            target.rot = SP.normaliseAngle(angle);
            setNodeTransform(itemNode(target.id), target);
            drag.badge = Math.round(target.rot) + '°';
            renderOverlay();
            refreshItemReadouts();
            $('#spPointerReadout').textContent = t('Turned {n}°', { n: Math.round(target.rot) });
            setModifierHint('rotate');
            return;
        }

        if (drag.mode === 'arrow-tip' || drag.mode === 'arrow-tail') {
            var arrow = findPlacement(drag.id);
            if (!arrow) return;
            var fixed = arrowEnds(drag.origin)[drag.mode === 'arrow-tip' ? 'tail' : 'tip'];
            var loose = e.altKey
                ? { x: SP.round(point.x, 3), y: SP.round(point.y, 3) }
                : { x: snap(point.x, e.shiftKey), y: snap(point.y, e.shiftKey) };
            var ax = drag.mode === 'arrow-tip' ? loose.x - fixed.x : fixed.x - loose.x;
            var ay = drag.mode === 'arrow-tip' ? loose.y - fixed.y : fixed.y - loose.y;
            var len = Math.sqrt(ax * ax + ay * ay);
            if (len < 0.05) return;
            arrow.w = SP.round(len, 3);
            arrow.rot = SP.normaliseAngle(Math.atan2(ay, ax) * 180 / Math.PI);
            arrow.x = SP.round((fixed.x + loose.x) / 2, 3);
            arrow.y = SP.round((fixed.y + loose.y) / 2, 3);
            redrawItem(arrow);
            renderOverlay();
            refreshItemReadouts();
            $('#spPointerReadout').textContent = SP.formatLength(arrow.w) + ', ' +
                t('Turned {n}°', { n: Math.round(arrow.rot) });
            setModifierHint('move');
            return;
        }

        if (drag.mode === 'scale' || drag.mode === 'scale-w' || drag.mode === 'scale-h') {
            var item = findPlacement(drag.id);
            if (!item) return;
            var a = -(drag.origin.rot || 0) * Math.PI / 180;
            var dxw = point.x - item.x;
            var dyw = point.y - item.y;
            var localX = Math.abs(dxw * Math.cos(a) - dyw * Math.sin(a));
            var localY = Math.abs(dxw * Math.sin(a) + dyw * Math.cos(a));
            var w = Math.max(0.05, localX * 2);
            var h = Math.max(0.05, localY * 2);
            /* Was ein Requisit auf der Bühne mit sich machen lässt. Alt hebt
               es für einen Zug auf — eine Bequemlichkeit, kein Zaun. Im
               Auswahl-Bereich steht ohnehin jede Zahl frei. */
            var grip = SPPlan.gripOf(resolveProp(item.propId));
            /* Strg hält das Verhältnis fest. Ein Tisch darf jede Kante für
               sich annehmen — wer ihn aber nur größer will und nicht anders
               geschnitten, hält Strg und zieht. */
            if (e.ctrlKey || e.metaKey) grip = 'ratio';
            if (!e.altKey) {
                if (grip === 'derived') {
                    h = SPShapes.naturalDepth(resolveProp(item.propId), w, item.params);
                } else if (grip === 'none') {
                    w = drag.origin.w;
                    h = drag.origin.h;
                } else if (grip === 'width') {
                    h = drag.origin.h;
                } else if (grip === 'depth') {
                    w = drag.origin.w;
                } else if (grip === 'square') {
                    w = h = Math.max(w, h);
                } else if (grip === 'ratio') {
                    var factor = Math.max(w / drag.origin.w, h / drag.origin.h);
                    w = drag.origin.w * factor;
                    h = drag.origin.h * factor;
                }
            }
            /* Ein Kantengriff bewegt seine Kante und lässt die andere in
               Ruhe — es sei denn, die Vorschrift (oder Strg) zieht sie mit. */
            if (drag.mode === 'scale-w' && grip !== 'derived' && grip !== 'ratio' && grip !== 'square') {
                h = drag.origin.h;
            }
            if (drag.mode === 'scale-h' && grip !== 'ratio' && grip !== 'square') {
                w = drag.origin.w;
            }
            drag.grip = drag.mode === 'scale-w' && grip === 'free' ? 'width'
                : drag.mode === 'scale-h' && grip === 'free' ? 'depth' : grip;
            item.w = SP.round(w, 3);
            item.h = SP.round(h, 3);
            holdSize(item);
            redrawItem(item);
            drag.badge = drag.mode === 'scale-w' ? SP.formatLength(item.w)
                : drag.mode === 'scale-h' ? SP.formatLength(item.h)
                : SP.formatLength(item.w) + ' × ' + SP.formatLength(item.h);
            renderOverlay();
            refreshItemReadouts();
            $('#spPointerReadout').textContent = SP.formatLength(item.w) + ' × ' +
                SP.formatLength(item.h);
            setModifierHint('scale');
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
        /* Dasselbe Markup wie beim vollen Aufbau. Vorher wurde hier nur die
           Streckung der Zeichnung nachgestellt — ein gerechnetes Requisit
           blieb dabei stehen, bis man die Ecke losließ. */
        node.innerHTML = SPPlan.propInner(placement, prop, plan.unit, {
            interactive: true,
            selected: node.classList.contains('is-selected')
        });
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
        setModifierHint(null);
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
            /* Anhängen, aber nichts doppelt: ein Shift-Rahmen über bereits
               Ausgewähltes legte jedes Requisit ein zweites Mal in die
               Auswahl. Sichtbar änderte sich nichts — ein Pfeiltastendruck
               schob danach 1,0 statt 0,5 m und Strg+D legte zwei Kopien an. */
            ui.selection = drag.additive ? SP.addToSelection(ui.selection, hits) : hits;
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
        var view = Object.assign({}, SPPlan.build(planSettings(sc)).view);
        /* Der Ausschnitt richtete sich allein nach dem Bühnenumriss. Ein
           Requisit, das neben der Bühne steht, lag damit hinter dem Rand der
           Zeichenfläche — unsichtbar wegen `overflow: hidden`, mit der Maus
           nicht mehr zu fassen, und „Einpassen" holte es nicht zurück. Jetzt
           nimmt der Ausschnitt alles mit, was in der Szene steht. */
        (sc.placements || []).forEach(function (p) {
            var hw = Math.max(p.w, p.h) / 2;
            var x0 = Math.min(view.x, p.x - hw);
            var y0 = Math.min(view.y, p.y - hw);
            view.w = Math.max(view.x + view.w, p.x + hw) - x0;
            view.h = Math.max(view.y + view.h, p.y + hw) - y0;
            view.x = x0;
            view.y = y0;
        });
        ui.view = view;
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
                    resolve: resolveProp,
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
                      drifting.map(function (sc) {
                          return '<button class="sp-btn is-quiet sp-place-jump" data-act="go-to-scene" ' +
                              'data-id="' + esc(sc.id) + '">' + esc(numbers[sc.id].label) + '</button>';
                      }).join('') +
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
                '<button class="sp-tool is-danger" data-act="delete-place" ' +
                'data-id="' + esc(place.id) + '" title="' + esc(t('Delete')) +
                '" aria-label="' + esc(t('Delete')) + '">' + ICON.cross + '</button>' +
                '</div>' +

                '<div class="sp-place-body">' +
                '<div class="sp-place-plan">' + art + '</div>' +
                '<div class="sp-place-side">' +

                (status ? '<div class="sp-place-status">' + status + '</div>' : '') +
                '</div></div></section>';
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
            '<button class="sp-btn" data-act="add-banner">' +
            esc(t('Break the table here…')) + '</button>' + why('trans.banner') + '</div>' +
            (banners.length ? '<ul class="sp-banner-list">' + banners.map(function (b, i) {
                return '<li><b>' + esc(b.text || '—') + '</b>' +
                    (b.sub ? '<span>' + esc(b.sub) + '</span>' : '') +
                    '<button class="sp-btn is-quiet is-danger" data-act="delete-banner" ' +
                    'data-index="' + i + '">' + esc(t('Delete')) + '</button></li>';
            }).join('') + '</ul>' : '') +
            '</div>';
    }

    /* ------------------------------------------------------ Gassenzettel */

    /* ================================================================== *
     * Gassenzettel
     *
     * Ein Zettel ist ein kleines Bild mit Unterschrift, das in der Gasse
     * neben der Bühne aufs Blatt gedruckt wird — für Dinge, die bereitliegen
     * müssen, ohne auf der Bühne zu stehen. Angelegt wurden sie über einen
     * Knopf ganz unten im Szene-Bereich; gefunden hat ihn niemand, und wer
     * sich vertippt hatte, musste löschen und alles neu eingeben, samt
     * Zeichnung aus einer Liste mit neununddreißig Zeilen.
     *
     * Jetzt hängen sie an der Marke in der gezeichneten Gasse: dort, wo sie
     * hingehören, mit der Seite schon gewählt, und die Liste lässt sich
     * ändern, umsortieren und leeren.
     * ================================================================== */

    function wingNotesOf(sc, side) {
        return (sc.wingNotes || []).filter(function (note) {
            return (note.side === 'left' ? 'left' : 'right') === side;
        });
    }

    function wingNotesDialog(side) {
        var sc = scene();
        if (!sc) return;
        side = side === 'left' ? 'left' : 'right';
        if (!sc.wingNotes) sc.wingNotes = [];

        var body = document.createElement('div');
        var picking = null;

        function rows() {
            var mine = wingNotesOf(sc, side);
            if (!mine.length) {
                return '<p class="sp-empty">' + esc(t('Nothing waiting in this wing yet.')) + '</p>';
            }
            return '<ul class="sp-wing-list">' + mine.map(function (note, i) {
                var prop = note.propId ? resolveProp(note.propId) : null;
                return '<li data-note="' + esc(note.id) + '">' +
                    '<button class="sp-wing-pick" data-pick="' + esc(note.id) + '" title="' +
                    esc(t('Choose a drawing')) + '">' +
                    (prop ? artThumb(prop) : '<span class="sp-wing-nopic">+</span>') + '</button>' +
                    '<input type="text" class="sp-wing-text" data-note-text="' + esc(note.id) + '" value="' +
                    esc(note.text || '') + '" placeholder="' + esc(t('Hold ready')) + '">' +
                    /* Pfeile und Kreuz als Zeichnung, nicht als Schriftzeichen:
                       ↑ ↓ × kommen in jeder Schrift anders heraus, sitzen auf
                       der Grundlinie und stehen damit tiefer als der Text
                       daneben. */
                    '<button class="sp-tool" data-move="' + esc(note.id) + '" data-dir="-1"' +
                    (i === 0 ? ' disabled' : '') + ' aria-label="' + esc(t('Move up')) +
                    '" title="' + esc(t('Move up')) + '">' + ICON.up + '</button>' +
                    '<button class="sp-tool" data-move="' + esc(note.id) + '" data-dir="1"' +
                    (i === mine.length - 1 ? ' disabled' : '') + ' aria-label="' + esc(t('Move down')) +
                    '" title="' + esc(t('Move down')) + '">' + ICON.down + '</button>' +
                    '<button class="sp-tool is-danger" data-drop="' + esc(note.id) + '" aria-label="' +
                    esc(t('Delete')) + '" title="' + esc(t('Delete')) + '">' + ICON.cross + '</button>' +
                    (picking === note.id ? picker() : '') + '</li>';
            }).join('') + '</ul>';
        }

        /* Die Zeichnung wird aus Kacheln gewählt, wie auf der Bühne auch —
           vorher aus einer Klappliste mit neununddreißig Textzeilen. */
        function picker() {
            return '<div class="sp-wing-picker"><div class="sp-palette">' +
                '<button class="sp-tile" data-set-prop="">' +
                '<span class="sp-tile-name">' + esc(t('No drawing')) + '</span></button>' +
                allProps().map(function (pr) {
                    return '<button class="sp-tile" data-set-prop="' + esc(pr.id) + '">' +
                        artThumb(pr) + '<span class="sp-tile-name">' + esc(t(pr.name)) + '</span></button>';
                }).join('') + '</div></div>';
        }

        function draw() {
            body.innerHTML =
                '<p class="sp-hint" style="margin-bottom:0.7rem">' +
                esc(SPI18n.explain('scene.wingNotes').body) + '</p>' +
                rows() +
                '<div class="sp-btn-row" style="margin-top:0.7rem">' +
                '<button class="sp-btn is-primary" data-add="1">' + esc(t('Add a wing note')) + '</button></div>';
        }

        function byId(id) {
            return (sc.wingNotes || []).filter(function (x) { return x.id === id; })[0];
        }

        body.addEventListener('click', function (e) {
            var add = e.target.closest('[data-add]');
            if (add) {
                change(function () {
                    sc.wingNotes.push({ id: SP.uid('wn'), text: '', side: side, propId: null });
                });
                picking = null;
                draw();
                var fields = $$('.sp-wing-text', body);
                if (fields.length) fields[fields.length - 1].focus();
                return;
            }
            var drop = e.target.closest('[data-drop]');
            if (drop) {
                change(function () {
                    sc.wingNotes = sc.wingNotes.filter(function (x) { return x.id !== drop.dataset.drop; });
                });
                draw();
                return;
            }
            var move = e.target.closest('[data-move]');
            if (move) {
                change(function () {
                    var mine = wingNotesOf(sc, side);
                    var here = mine.map(function (x) { return x.id; }).indexOf(move.dataset.move);
                    var there = here + Number(move.dataset.dir);
                    if (there < 0 || there >= mine.length) return;
                    /* Umsortiert wird innerhalb der Gasse; die Reihenfolge der
                       anderen Seite bleibt, wie sie war. */
                    var order = sc.wingNotes.map(function (x) { return x.id; });
                    var a = order.indexOf(mine[here].id), b = order.indexOf(mine[there].id);
                    var swap = sc.wingNotes[a];
                    sc.wingNotes[a] = sc.wingNotes[b];
                    sc.wingNotes[b] = swap;
                });
                draw();
                return;
            }
            var pick = e.target.closest('[data-pick]');
            if (pick) {
                picking = picking === pick.dataset.pick ? null : pick.dataset.pick;
                draw();
                return;
            }
            var set = e.target.closest('[data-set-prop]');
            if (set && picking) {
                var id = picking;
                change(function () {
                    var note = byId(id);
                    if (note) note.propId = set.dataset.setProp || null;
                });
                picking = null;
                draw();
            }
        });

        body.addEventListener('input', function (e) {
            var field = e.target.closest('[data-note-text]');
            if (!field) return;
            var note = byId(field.dataset.noteText);
            if (!note) return;
            note.text = field.value;
            persist();
            renderCanvas(true);
        });

        draw();
        openModal({
            title: side === 'left' ? t('Waiting in the left wing') : t('Waiting in the right wing'),
            cancelLabel: t('Close'),
            body: body
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
                '<option value="after">' + esc(t('After this changeover')) + '</option></select></div>',
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
                '<p class="sp-hint">' + esc(t('Every setting has a ? beside it. It says what the setting does on the printed sheet.')) + '</p></div>' +
                '<div class="sp-section" style="padding-left:0;padding-right:0">' +
                '<h3>' + esc(t('Show the introductions again')) + '</h3>' +
                '<p class="sp-hint">' + esc(t('The short panel that appears the first time you open each section.')) + '</p>' +
                '<div class="sp-btn-row"><button class="sp-btn" data-act="intros-on">' +
                esc(t('Show the introductions again')) + '</button></div></div>' +
                '<div class="sp-section" style="padding-left:0;padding-right:0">' +
                '<h3>' + esc(t('Backup')) + why('store.backup') + '</h3>' +
                '<p class="sp-hint">' + esc(t('The planner keeps everything in this browser and uploads nothing. Back-up writes a file with all of it, to bring along or to put back.')) + '</p></div>' +
                '<div class="sp-section" style="padding-left:0;padding-right:0">' +
                '<h3>' + esc(t('Where things live')) + '</h3>' +
                '<p class="sp-hint">' + esc(t('Scene numbering and the direction convention are under Settings, next to the production name. The stage shape, the grid, the wings and the curtains are on the Stage tab.')) + '</p></div>'
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
            /* Erst als gesehen abhaken, wenn jemand geantwortet hat — auch
               „später“ ist eine Antwort. Vorher stand der Haken schon beim
               Öffnen: wer neu lud, bevor er sich entschieden hatte, bekam die
               Frage nie wieder und fand die Einrichtung nur noch über das
               Hilfemenü. */
            onClose: markWelcomed,
            body: '<div class="sp-choice-grid">' +
                '<button type="button" class="sp-choice" data-choose="setup">' +
                '<b>' + esc(t('I am planning a real production')) + '</b>' +
                '<span>' + esc(t('Set the whole thing up step by step: the piece, the stage, the acts, the scenes and the places they play in.')) + '</span>' +
                '</button>' +
                '<button type="button" class="sp-choice" data-choose="example">' +
                '<b>' + esc(t('I am just having a look')) + '</b>' +
                '<span>' + esc(t('Opens a worked example you can pull apart.')) + '</span>' +
                '</button></div>'
        });

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

    /* Eine Produktion, in die noch niemand etwas eingetragen hat. Genau eine
       solche entsteht beim allerersten Öffnen, damit der Planer nicht leer
       dasteht — sie ist zum Überschreiben da und nicht zum Sammeln. */
    function untouchedProduction() {
        var p = production();
        if (!p || db.productions.length !== 1) return null;
        var bare = !p.name || p.name === t('Untitled production');
        var empty = (p.scenes || []).length <= 1 &&
            !(p.scenes || []).some(function (sc) {
                return (sc.placements || []).length || sc.title || sc.notes;
            });
        return bare && empty && !(p.places || []).length && !(p.acts || []).length ? p : null;
    }

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
        var opener = document.activeElement;
        closeIntro();
        document.body.appendChild(backdrop);
        trapFocus(backdrop);

        function close() {
            backdrop.remove();
            restoreFocus(opener);
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
                draft.directions = $('#spWizDirections', body).value;
                $$('[data-dim]', body).forEach(function (input) {
                    var value = parseFloat(input.value);
                    /* `isFinite` allein ließ 300 Neunen durch: der Assistent
                       blieb danach mitten im Zeichnen stehen und legte bei
                       jedem weiteren „Weiter" noch eine Produktion an. */
                    if (isFinite(value)) {
                        draft.dims[input.dataset.dim] =
                            clampSaid(value, SP.STAGE_MIN, SP.STAGE_MAX);
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
                var value = SP.round(draft.dims[field], 2);
                return '<div><label>' + esc(labels[field] || field) +
                    ' (' + esc(SP.unitSuffix()) + ')</label>' +
                    '<input type="number" step="0.1" min="' + SP.STAGE_MIN +
                    '" max="' + SP.STAGE_MAX + '" data-dim="' + field +
                    '" value="' + value + '"></div>';
            }).join('') + '</div>';
        }

        function renderStep() {
            var step = WIZARD_STEPS[draft.step];
            var body = $('#spWizBody', backdrop);
            $('#spWizStep', backdrop).textContent =
                t('Step {n} of {total}', { n: draft.step + 1, total: WIZARD_STEPS.length });

            /* Jeder Schritt heißt nach seiner Sache, die Frage steht am Feld.
               Bei „Gliederung" stand die Frage vorher zweimal untereinander:
               einmal als Überschrift, einmal als Beschriftung des Feldes. */
            var titles = {
                piece: t('The piece'), structure: t('The structure'),
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
                        '<p class="sp-hint">' + esc(t('Empty scenes are created now and you fill them in as you go.')) + '</p>';
                } else {
                    body.innerHTML =
                        '<div class="sp-field"><label for="spWizScenes">' + esc(t('How many scenes are there?')) + '</label>' +
                        '<input type="number" id="spWizScenes" min="1" max="99" value="' + draft.sceneCount + '"></div>' +
                        '<p class="sp-hint">' + esc(t('Empty scenes are created now and you fill them in as you go.')) + '</p>';
                }
            } else {
                body.innerHTML =
                    '<p style="margin-bottom:0.8rem">' + esc(t('From here you drag props onto the stage, scene by scene. The tool works out what has to be carried between them and prints it as an Umbauplan.')) + '</p>' +
                    '<p class="sp-hint">' + esc(t('Nothing is placed for you — the stage starts empty, exactly as you left it.')) + '</p>';
            }

            $('[data-wiz="back"]', backdrop).disabled = draft.step === 0;
            $('[data-wiz="next"]', backdrop).textContent =
                draft.step === WIZARD_STEPS.length - 1 ? t('Take me to the first scene') : t('Next');
            var focus = $('input:not([type="hidden"]), select, textarea', body) ||
                focusableIn(body)[0] || $('[data-wiz="next"]', backdrop);
            if (focus) focus.focus({ preventScroll: true });
        }

        /* Was beim Abbrechen erhalten bleibt. „Später einrichten" hieß bisher
           „alles weg": Titel, Untertitel, Haus und Bühnenmaße waren ohne
           Rückfrage verloren. Jetzt landet in der offenen Produktion, was
           schon dasteht — einrichten kann man später weiter. */
        function keepDraft() {
            var p = untouchedProduction();
            if (!p) return;
            var touched = false;
            if (draft.name) { p.name = draft.name; touched = true; }
            if (draft.subtitle) { p.subtitle = draft.subtitle; touched = true; }
            if (draft.venue) { p.venue = draft.venue; touched = true; }
            if (Object.keys(draft.dims).length || draft.shape !== 'rect') {
                p.stage = Object.assign(defaultStage(), draft.dims, { shape: draft.shape });
                touched = true;
            }
            if (!touched) return;
            saveNow();
            ui.view = null;
            render();
            fitView();
            toast(t('Kept what you had typed. Carry on setting up whenever you like.'), 'info');
        }

        function finish() {
            /* Ist die offene Produktion noch unberührt — kein Name, eine leere
               Szene, nichts darauf —, wird sie eingerichtet statt eine zweite
               danebenzustellen. Sonst bliebe die leere „Unbenannte Produktion"
               vom ersten Öffnen für immer in der Liste. */
            var reuse = untouchedProduction();
            var p = reuse || newProduction('');
            p.name = draft.name || t('Untitled production');
            p.subtitle = draft.subtitle;
            p.venue = draft.venue;
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

            if (!reuse) db.productions.push(p);
            db.activeId = p.id;
            ui.sceneId = p.scenes[0].id;
            ui.tab = 'scenes';
            ui.view = null;
            undoStack = [];
            redoStack = [];
            saveNow();
            render();
            /* Ohne das steht der Plan nach dem Einrichten außerhalb des
               Bildes — bei einer 18-m-Bühne sieht man nur Raster. */
            fitView();
            close();
        }

        backdrop.addEventListener('click', function (e) {
            var why = e.target.closest('[data-explain]');
            if (why) { openExplainer(why); return; }
            var btn = e.target.closest('[data-wiz]');
            if (!btn) return;
            var action = btn.dataset.wiz;
            if (action === 'cancel') {
                readStep();
                keepDraft();
                close();
                return;
            }
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
            if (e.key === 'Escape') {
                /* Steht ein Erklärkasten offen, gilt Escape ihm — von innen
                   nach außen. Vorher schloss es beide auf einmal. */
                if ($('.sp-explainer')) { closeExplainer(); return; }
                /* Und dann dasselbe wie „Später einrichten": beides sind
                   Abbruchgesten. Vorher rettete die eine den Entwurf und die
                   andere warf ihn weg, ohne zu fragen — nach drei Feldern und
                   zwei Schritten stand die Produktion wieder auf
                   „Unbenannte Produktion". */
                readStep();
                keepDraft();
                close();
                return;
            }
            /* Eingabetaste in einem Feld schaltet weiter. In einem Formular
               erwartet das jeder; ohne es muss man zur Maus greifen. */
            if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' &&
                e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
                $('[data-wiz="next"]', backdrop).click();
            }
        });

        renderStep();
    }

    /* ================================================================== *
     * Wiring
     * ================================================================== */

    /* ================================================================== *
     * Handbuch
     *
     * Zu jeder Einstellung steht schon ein Erklärtext hinter ihrem ?. Das
     * nützt nur, wenn man die Einstellung findet. Hier kann man nach dem Wort
     * suchen, das einem einfällt, und wird dann hingebracht: richtiger
     * Reiter, richtiges Panel, das Feld kurz hervorgehoben und die Erklärung
     * gleich offen. Wer nicht sucht, merkt davon nichts.
     * ================================================================== */

    var guideCache = null;

    function guideIndex() {
        if (!guideCache) {
            guideCache = SPGuide.buildIndex(
                Object.keys(SPI18n.EXPLAIN.de), SPI18n.explain);
        }
        return guideCache;
    }

    /* Bringt zur Einstellung hinter diesem Schlüssel. */
    function gotoExplain(entry) {
        if (entry.tab && entry.tab !== ui.tab) setTab(entry.tab);
        if (entry.panel && ui.tab === 'scenes') setInspector(entry.panel);

        /* Nach dem Reiterwechsel ist das Feld erst im nächsten Zeichnen da. */
        window.setTimeout(function () {
            var target = $('[data-explain="' + entry.key + '"]');
            if (!target) {
                toast(entry.open
                    ? t('You will find “{what}” here: {where}', { what: entry.title, where: entry.open })
                    : t('“{what}” could not be found on screen.', { what: entry.title }));
                return;
            }
            if (target.scrollIntoView) {
                target.scrollIntoView({ block: 'center', inline: 'nearest' });
            }
            target.classList.add('sp-why-found');
            window.setTimeout(function () { target.classList.remove('sp-why-found'); }, 2000);
            openExplainer(target);
        }, 60);
    }

    function openGuide() {
        var index = guideIndex();
        var wrap = document.createElement('div');
        wrap.className = 'sp-guide';
        wrap.innerHTML =
            '<input type="search" class="sp-guide-query" id="spGuideQuery" autocomplete="off" ' +
            'placeholder="' + esc(t('What are you looking for?')) + '" ' +
            'aria-label="' + esc(t('What are you looking for?')) + '">' +
            '<div class="sp-guide-hits" id="spGuideHits" role="listbox"></div>';

        var modal = openModal({
            title: t('Handbook'),
            body: wrap,
            modalClass: 'is-guide',
            cancelLabel: t('Close'),
            actions: [{
                label: t('Read the whole manual'),
                onClick: function () { window.open('handbuch.html', '_blank', 'noopener'); return false; }
            }]
        });

        var query = $('#spGuideQuery', wrap);
        var hits = $('#spGuideHits', wrap);
        var shown = [];
        var cursor = 0;

        function draw() {
            var text = query.value.trim();
            /* Ohne Eingabe die Abschnitte zeigen, damit man auch blättern
               kann, wenn einem das Wort gerade nicht einfällt. */
            shown = text ? SPGuide.search(index, text, 14) : index.slice(0, 14);
            cursor = 0;
            if (!shown.length) {
                hits.innerHTML = '<p class="sp-empty">' +
                    esc(t('Nothing under that word.')) + '</p>';
                return;
            }
            hits.innerHTML = shown.map(function (entry, i) {
                return '<button type="button" class="sp-guide-hit' + (i === 0 ? ' is-on' : '') +
                    '" role="option" data-hit="' + i + '" aria-selected="' + (i === 0) + '">' +
                    '<strong>' + esc(entry.title) + '</strong>' +
                    '<span class="sp-guide-where">' + esc(entry.open) + '</span>' +
                    '<span class="sp-guide-body">' + esc(entry.body) + '</span></button>';
            }).join('');
        }

        function mark() {
            $$('.sp-guide-hit', hits).forEach(function (el, i) {
                el.classList.toggle('is-on', i === cursor);
                el.setAttribute('aria-selected', String(i === cursor));
                if (i === cursor && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
            });
        }

        function choose(i) {
            var entry = shown[i];
            if (!entry) return;
            modal.close();
            gotoExplain(entry);
        }

        query.addEventListener('input', draw);
        query.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowDown') { e.preventDefault(); cursor = Math.min(cursor + 1, shown.length - 1); mark(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); cursor = Math.max(cursor - 1, 0); mark(); }
            else if (e.key === 'Enter') { e.preventDefault(); choose(cursor); }
        });
        hits.addEventListener('click', function (e) {
            var hit = e.target.closest('[data-hit]');
            if (hit) choose(Number(hit.dataset.hit));
        });

        draw();
        query.focus();
    }

    function setTab(tab) {
        ui.tab = tab;
        persistUi();
        render();
    }

    function setInspector(name) {
        ui.inspector = name;
        /* Von Hand gewählt heißt: dabei bleiben. Sonst würde der Reiter
           „Auswahl" sofort wieder wegspringen, wenn nichts ausgewählt ist,
           und man käme nie an den Hinweis, was dort stünde. */
        ui.stickyInspector = (name === 'item');
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
            if (ui.view) addProp(data.prop, ui.view.x + ui.view.w / 2, ui.view.y + ui.view.h / 2, true);
            break;
        case 'align': alignSelection(data.axis); break;
        case 'spread': spreadSelection(data.axis); break;
        case 'mirror-selection': mirrorSelection(); break;
        case 'menu-settings': closeBarMenu(); productionDialog(); break;
        case 'menu-backup': closeBarMenu(); exportJson(); break;
        case 'menu-feedback': closeBarMenu(); feedbackDialog('prop', ''); break;
        case 'menu-help': closeBarMenu(); helpDialog(); break;
        case 'place-update': updatePlaceFromScene(); break;
        case 'place-insert': insertPlaceSet(); break;
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
        case 'suggest-prop': feedbackDialog('prop', ui.propSearch || ui.librarySearch || ''); break;
        case 'wing-add': wingNotesDialog(data.wingAdd); break;
        case 'say-something': feedbackDialog(data.kind || 'idea', ''); break;
        case 'do-print': doPrint(); break;
        case 'overview-size': break;
        case 'rename-scene': renameSceneInRow(data.id); break;
        case 'go-to-scene':
            ui.sceneId = data.id;
            ui.selection = [];
            setTab('scenes');
            break;
        case 'add-place': addPlace(); break;
        case 'delete-place': deletePlace(data.id); break;
        case 'suggest-place-props': suggestPlaceProps(data.id); break;
        case 'add-banner': addBannerDialog(); break;
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
        case 'print-doc':
            ui.printDoc = data.doc;
            persistUi();
            renderPrintTab();
            /* Sonst landet man beim Wechsel unterhalb der Tabelle auf leerem
               Papier und hält das Dokument für leer. */
            var paper = $('#spPrintPreview');
            if (paper) paper.scrollTop = 0;
            break;
        default: break;
        }
        void event;
    }

    /* Eine Kante ändern. Zeichnungen mit eigenem Verhältnis ziehen die
       andere Kante mit, sonst passte das Bild nicht mehr in seine Fläche. */
    /* Eine Zahl unter dem kleinsten sinnvollen Maß wurde stillschweigend
       heraufgesetzt: man tippte 0 und bekam wortlos 5 cm. Jetzt steht es
       dabei, warum im Feld etwas anderes steht als das Getippte. */
    function clampSaid(value, least, most) {
        if (value < least) {
            /* Den getippten Wert nennen, nicht null: bei einer Lage ist eine
               negative Zahl richtig, und „0 m ist zu klein — bleibt bei
               −13,5 m" sagt dem Leser das Gegenteil von dem, was geschah. */
            toast(t('{typed} is too small — kept at {least}.', {
                typed: SP.formatLength(value),
                least: SP.formatLength(least)
            }));
            return least;
        }
        /* Und nach oben genauso. Ohne diesen Anschlag nahm der Planer 400 000
           Meter an, rechnete danach vier Sekunden je Seitenaufbau — auch nach
           dem Neuladen — und warf bei ganz großen Zahlen einen Fehler mitten
           in den Aufbau. */
        if (most !== undefined && value > most) {
            toast(t('{typed} is too large — kept at {most}.', {
                typed: SP.formatLength(value),
                most: SP.formatLength(most)
            }));
            return most;
        }
        return value;
    }

    /* Die Grenzen, in denen ein Requisit bleibt: höchstens so groß wie die
       Bühne, und höchstens eine Bühnenbreite quer bzw. eine Bühnentiefe tief
       daneben. Gasse, Lager und Hinterbühne bleiben möglich; ins Nichts
       verschwindet nichts mehr. */
    function propLimits() {
        return SP.propLimits(stageOf(scene()));
    }

    function holdSpot(placement) {
        var limit = propLimits();
        placement.x = SP.round(SP.clamp(placement.x, limit.x[0], limit.x[1]), 3);
        placement.y = SP.round(SP.clamp(placement.y, limit.y[0], limit.y[1]), 3);
    }

    function holdSize(placement) {
        var limit = propLimits();
        /* Beide Kanten mit demselben Faktor zurück: einzeln geklemmt würde aus
           einem Stück, das über die Bühne hinausgezogen wird, ein anderes. */
        var over = Math.max(placement.w / limit.w, placement.h / limit.h, 1);
        placement.w = SP.round(Math.max(0.05, placement.w / over), 3);
        placement.h = SP.round(Math.max(0.05, placement.h / over), 3);
    }

    function resize(placement, axis, next) {
        var limit = propLimits();
        var value = SP.clamp(next, 0.05, axis === 'w' ? limit.w : limit.h);
        var prop = resolveProp(placement.propId);
        if (SPPlan.keepsAspect(prop) && placement[axis] > 0) {
            var other = axis === 'w' ? 'h' : 'w';
            placement[other] = SP.round(SP.clamp(placement[other] * (value / placement[axis]),
                0.05, other === 'w' ? limit.w : limit.h), 3);
        }
        placement[axis] = SP.round(value, 3);
        followNaturalDepth(placement);
    }

    /* Wo die Tiefe aus der Breite folgt, wird sie nachgezogen — beim Ziehen
       auf der Bühne wie beim Eintragen einer Zahl. Sonst stünde bei einer
       breiteren Tür ein Schwenkbogen, der aus seinem Feld läuft. */
    function followNaturalDepth(placement) {
        var natural = SPShapes.naturalDepth(resolveProp(placement.propId), placement.w, placement.params);
        if (natural !== null) placement.h = natural;
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
        case 'prod.numbering': production().numbering = value; break;
        case 'item.label': sel.forEach(function (p) { p.label = value; }); break;
        case 'item.note': sel.forEach(function (p) { p.note = value; }); break;
        case 'item.x': {
            var xLimit = propLimits();
            sel.forEach(function (p) {
                p.x = SP.round(clampSaid(fromField(value, p.x), xLimit.x[0], xLimit.x[1]), 3);
            });
            break;
        }
        case 'item.upstage': {
            var yLimit = propLimits();
            sel.forEach(function (p) {
                p.y = SP.round(clampSaid(out.frontY - fromField(value, out.frontY - p.y),
                    yLimit.y[0], yLimit.y[1]), 3);
            });
            break;
        }
        case 'item.rot': sel.forEach(function (p) { p.rot = SP.normaliseAngle(parseFloat(value) || 0); }); break;
        case 'item.w': {
            var wLimit = propLimits();
            sel.forEach(function (p) {
                resize(p, 'w', clampSaid(fromField(value, p.w), 0.05, wLimit.w));
            });
            break;
        }
        case 'item.h': {
            var hLimit = propLimits();
            sel.forEach(function (p) {
                resize(p, 'h', clampSaid(fromField(value, p.h), 0.05, hLimit.h));
            });
            break;
        }
        default:
            /* Werte, die eine Bauvorschrift selbst nennt. Wie sie zu lesen
               sind, weiß nur die Vorschrift — ob Meter, Anzahl oder Schalter
               steht dort und nicht hier. */
            if (path.indexOf('item.param.') === 0) {
                var key = path.slice(11);
                sel.forEach(function (p) {
                    var def = SPShapes.spec(resolveProp(p.propId)).filter(function (q) {
                        return q.key === key;
                    })[0];
                    if (!def) return;
                    if (!p.params) p.params = {};
                    p.params[key] = readParam(def, value);
                    followNaturalDepth(p);
                });
            }
            break;
        }
    }

    function readParam(def, raw) {
        if (def.type === 'toggle') return raw === true || raw === 'true' || raw === 'on';
        var num = parseFloat(String(raw).replace(',', '.'));
        if (!isFinite(num)) return def.def;
        if (def.unit === 'length') num = SP.toMetres(num);
        if (def.step >= 1) num = Math.round(num);
        if (def.min !== undefined) num = Math.max(def.min, num);
        if (def.max !== undefined) num = Math.min(def.max, num);
        return SP.round(num, 4);
    }

    function wire() {
        var app = $('#spApp');

        /* Jede Klappe mit `data-fold` merkt sich, ob sie offen war. `toggle`
           steigt nicht auf, also wird in der Erfassungsphase zugehört. */
        app.addEventListener('toggle', function (e) {
            var key = e.target.dataset && e.target.dataset.fold;
            if (!key) return;
            ui[key] = e.target.open;
            persistUi();
        }, true);

        /* Doppelklick auf eine Szenenzeile benennt sie um — dieselbe Geste,
           mit der man auf der Bühne eine Beschriftung ändert. */
        app.addEventListener('dblclick', function (e) {
            var row = e.target.closest ? e.target.closest('.sp-scene-row') : null;
            if (!row || e.target.closest('button')) return;
            e.preventDefault();
            renameSceneInRow(row.dataset.id);
        });

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

        /* Text- und Schieberfelder: ein Rückgängig-Schritt je Besuch, nicht
           je Tastendruck und nicht je Pixel, den der Schieber wandert. */
        function livePair(el) {
            return el.matches && el.matches('.sp-slide input');
        }
        function editable(el) {
            return el.matches('[data-bind]') &&
                (el.tagName === 'TEXTAREA' || el.type === 'text' || livePair(el));
        }
        app.addEventListener('focusin', function (e) {
            if (!editable(e.target)) return;
            e.target.dataset.previous = e.target.value;
            beginHistory();
        });
        app.addEventListener('focusout', function (e) {
            if (!editable(e.target)) return;
            if (e.target.dataset.previous !== e.target.value) commitHistory();
            else cancelHistory();
        });
        /* Ein Schieber bekommt den Fokus erst beim Loslassen; ohne das hier
           stünde der erste Zug schon geschrieben, bevor der Ausgangszustand
           gesichert wäre. */
        app.addEventListener('pointerdown', function (e) {
            if (!livePair(e.target) || e.target === document.activeElement) return;
            e.target.dataset.previous = e.target.value;
            beginHistory();
        });

        app.addEventListener('input', function (e) {
            var el = e.target;
            /* Schieber und Zahlenfeld schreiben denselben Wert und zeigen
               ihn einander sofort. Neu gebaut wird dabei nur die Bühne, nicht
               der Bereich — sonst verlöre der Schieber unter dem Finger den
               Halt, und im Zahlenfeld verschwände die halb getippte Zahl. */
            if (livePair(el)) {
                var one = selectedPlacements()[0];
                setBound(el.dataset.bind, el.value);
                syncSlide(el.dataset.bind, parseFloat(el.value.replace(',', '.')), el);
                /* Bei den maßstäblichen Zeichnungen geht die zweite Kante
                   mit; sie steht sonst als alte Zahl neben der neuen. */
                if (one && (el.dataset.bind === 'item.w' || el.dataset.bind === 'item.h')) {
                    syncSlide('item.w', SP.toUnit(one.w), el.dataset.bind === 'item.w' ? el : null);
                    syncSlide('item.h', SP.toUnit(one.h), el.dataset.bind === 'item.h' ? el : null);
                }
                persist();
                renderCanvas(true);
                refreshItemReadouts();
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
            if (el.id === 'spPropSearch') { ui.propSearch = el.value; renderPalette(); return; }
            if (el.id === 'spLibrarySearch') { ui.librarySearch = el.value; renderLibraryTab(); return; }
            if (el.id === 'spPrintFooter') {
                printOptions().footer = el.value;
                persist();
                /* Nur die Vorschau, nicht die Spalte: sonst verschwindet das
                   Feld unter dem Finger und der Fokus mit ihm. */
                renderPrintPreview();
                return;
            }
        });

        app.addEventListener('change', function (e) {
            var el = e.target;

            /* Der Wert steht schon; hier wird nur der Rückgängig-Schritt
               abgeschlossen, damit ein ganzer Zug am Schieber einer ist. */
            if (livePair(el)) {
                if (el.dataset.previous !== el.value) {
                    commitHistory();
                    el.dataset.previous = el.value;
                    beginHistory();
                    /* Der Bereich bleibt stehen, damit der Schieber unter dem
                       Finger nicht verschwindet — aber „Rückgängig" muss
                       trotzdem aufwachen, sonst sieht der Zug aus wie nichts,
                       was man zurücknehmen könnte. */
                    renderTopBar();
                }
                return;
            }
            /* Ein Schalter aus einer Bauvorschrift kann andere Werte ein- und
               ausblenden — „Falten" gibt es nur unter einer Decke. Also wird
               der Bereich hier ganz neu gebaut. */
            if (el.dataset.toggle) {
                change(function () { setBound(el.dataset.toggle, el.checked); });
                return;
            }

            if (el.id === 'spProductionSelect') {
                /* `snapshot()` nimmt die offene Produktion mit; der Wechsel
                   legte aber keinen Schritt an. „Rückgängig" sprang danach
                   ungefragt zurück in die vorige Produktion und nahm dort
                   etwas zurück, das man gar nicht sah. Jetzt ist der Wechsel
                   selbst der Schritt: Strg+Z führt sichtbar zurück. */
                change(function () {
                    db.activeId = el.value;
                    ui.sceneId = (scenes()[0] || {}).id;
                    ui.selection = [];
                    ui.view = null;
                });
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
                    /* Feld und Code sagen dasselbe: die Grenzen stehen einmal
                       in core.js und werden hier wie im Zahlenfeld benutzt. */
                    var bound = SP.stageBound(field, stage);
                    var typed = fromField(el.value,
                        field === 'grid.spacing' ? 1 : SP.num(stage[field], 1));
                    var kept = clampSaid(typed, bound.least, bound.most);
                    if (field === 'grid.spacing') stage.grid.spacing = kept;
                    else stage[field] = kept;
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
                        /* Dieselben Grenzen wie im Zahlenfeld und in der
                           Zeichnung. Vorher hielt nur die Zeichnung sie ein:
                           das Feld zeigte 99 m Einzug, während beide
                           Gassenlinien auf der Mittelachse lagen. */
                        var wb = SP.stageBound(key, stage);
                        stage.wings[key.slice(6)] =
                            clampSaid(fromField(el.value, 1), wb.least, wb.most);
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
                    if (field === 'offset') {
                        var cb = SP.stageBound('curtain.offset', stage);
                        curtain.offset = clampSaid(fromField(el.value, 0), cb.least, cb.most);
                    }
                    else curtain[field] = el.value;
                });
                return;
            }
            if (el.dataset.act === 'set-curtain') {
                change(function () { scene().curtains[el.dataset.id] = el.value; });
                return;
            }
            if (el.matches('[data-bind]')) {
                /* Beim Verlassen des Feldes, nicht beim Tippen: wer 0 einträgt,
                   soll erfahren, dass daraus das kleinste Maß wird. */
                if (el.dataset.bind === 'item.w' || el.dataset.bind === 'item.h') {
                    var typedSize = fromField(el.value, NaN);
                    if (!isNaN(typedSize)) clampSaid(typedSize, 0.05);
                }
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
            /* Das Plus in der Gasse ist ein Knopf, kein Stück Bühne — ohne
               das hier begänne beim Anklicken ein Auswahlrahmen. */
            if (e.target.closest && e.target.closest('.sp-wing-add')) return;
            /* Den Fokus mitnehmen. Sonst bleibt er in dem Feld, das zuletzt
               angefasst wurde, und jede Tastenabfrage steigt bei isTyping()
               aus — die Pfeiltasten, Entf und Kopieren wirken dann einfach
               nicht mehr, ohne dass etwas darauf hindeutet. */
            if (document.activeElement !== svg) svg.focus({ preventScroll: true });
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
        $('#spProductionMenu').addEventListener('click', productionDialog);
        $('#spBarMore').addEventListener('click', function (e) {
            e.stopPropagation();
            toggleBarMenu();
        });
        window.addEventListener('resize', fitBar);
        /* Ein Klick daneben und Escape schließen das Menü — sonst bliebe es
           offen stehen, während man schon woanders arbeitet. */
        document.addEventListener('click', function (e) {
            if (!$('.sp-bar-menu')) return;
            if (e.target.closest('.sp-bar-menu, #spBarMore')) return;
            closeBarMenu();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && $('.sp-bar-menu')) closeBarMenu();
        });
        fitBar();
        $('#spBackup').addEventListener('click', exportJson);
        $('#spGuide').addEventListener('click', openGuide);
        $('#spHelp').addEventListener('click', helpDialog);

        /* Strg+P und das Browsermenü gehen an doPrint vorbei. Hier bekommen
           sie dieselben Blätter. */
        var filledForBrowser = false;
        window.addEventListener('beforeprint', function () {
            filledForBrowser = fillPrintPortal();
        });
        window.addEventListener('afterprint', function () {
            if (!filledForBrowser) return;
            filledForBrowser = false;
            var portal = $('#spPrintPortal');
            portal.hidden = true;
            portal.innerHTML = '';
        });
        if (feedbackAvailable()) {
            $('#spFeedback').hidden = false;
            $('#spFeedback').addEventListener('click', function () { feedbackDialog('prop', ''); });
        }
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
            /* Das Handbuch geht immer auf, auch mitten im Tippen — wer nach
               einer Einstellung sucht, steht meistens gerade in einem Feld. */
            if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && !e.altKey) {
                e.preventDefault();
                if (!$('.sp-modal-backdrop')) openGuide();
                return;
            }
            if (e.key === 'F1') {
                e.preventDefault();
                if (!$('.sp-modal-backdrop')) openGuide();
                return;
            }
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
                if (clipboard.length) toast(SPI18n.plural(clipboard.length, '1 prop copied.', '{n} props copied.'));
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
            if (meta && e.key.toLowerCase() === 'p') {
                /* Strg+P heißt überall drucken, also wird es nicht abgefangen.
                   Damit dahinter etwas steht, füllt beforeprint den Vorrat —
                   vorher kam auf diesem Weg ein weißes Blatt heraus. */
                setTab('print');
                return;
            }
            if (meta) return;

            if (ui.tab !== 'scenes') return;
            var step = ui.snap ? snapStep(e.shiftKey) : (e.shiftKey ? 0.025 : 0.05);

            switch (e.key) {
            case 'Delete':
            case 'Backspace': e.preventDefault(); deleteSelection(); break;
            case 'Escape': ui.selection = []; renderCanvas(true); renderInspector(); break;
            case 'ArrowLeft': e.preventDefault(); nudge(-step, 0); break;
            case 'ArrowRight': e.preventDefault(); nudge(step, 0); break;
            case 'ArrowUp': e.preventDefault(); nudge(0, -step); break;
            case 'ArrowDown': e.preventDefault(); nudge(0, step); break;
            case 'f': case 'F': fitView(); break;
            case 'm': case 'M': mirrorSelection(); break;
            /* Drehen ging nur mit der Maus am Griff. Am Probentisch, wo der
               Plan neben dem Regiebuch liegt, ist das der eine Handgriff, für
               den man sonst jedes Mal zur Maus greift. */
            case 'r': rotateSelection(15); break;
            case 'R': rotateSelection(-15); break;
            default: break;
            }
        });

        document.addEventListener('keyup', function (e) {
            if (e.key === ' ') spaceHeld = false;
        });

        /* Verliert das Fenster den Fokus, kommt kein `keyup` und kein
           `pointerup` mehr. Die Leertaste galt danach als gedrückt — die
           Zeichenfläche schob statt auszuwählen —, und ein laufender Zug lief
           weiter. Beim Fokusverlust wird beides beendet. */
        window.addEventListener('blur', function () {
            spaceHeld = false;
            if (drag) onCanvasPointerUp();
        });

        window.addEventListener('beforeunload', function () {
            if (saveTimer !== null) saveNow();
        });

        /* Der Zuhörer, der ganz fehlte: er meldet sich nur in den *anderen*
           Fenstern derselben Ablage, nie im schreibenden. */
        window.addEventListener('storage', function (e) {
            if (e.key !== STORE_KEY || !e.newValue) return;
            noteOtherWindow();
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

    /* ------------------------------------------------------------------ *
     * Breite der rechten Spalte
     *
     * Dort stehen Requisitenauswahl, Auswahl und Szene. Wie viel Platz die
     * brauchen, hängt an der Arbeit: eine lange Requisitenliste will breit
     * sein, ein Bühnenbild will die Bühne groß. Also zieht man selbst.
     * ------------------------------------------------------------------ */

    var ASIDE_KEY = 'sp.planner.aside.v1';
    var ASIDE_MIN = 240;
    var ASIDE_MAX = 720;

    function asideWidth() {
        var saved = 0;
        try { saved = parseInt(localStorage.getItem(ASIDE_KEY), 10) || 0; } catch (err) { saved = 0; }
        return saved;
    }

    function setAsideWidth(px, save) {
        var app = $('#spApp');
        if (!app) return;
        var limit = Math.min(ASIDE_MAX, Math.max(ASIDE_MIN, Math.round(px)));
        app.style.setProperty('--sp-aside', limit + 'px');
        if (save) { try { localStorage.setItem(ASIDE_KEY, String(limit)); } catch (err) { /* egal */ } }
        return limit;
    }

    function wireAsideGrip() {
        var grip = $('#spAsideGrip');
        var aside = grip && grip.parentNode;
        if (!grip || !aside) return;

        var stored = asideWidth();
        if (stored) setAsideWidth(stored, false);

        grip.addEventListener('pointerdown', function (e) {
            e.preventDefault();
            var startX = e.clientX;
            var startW = aside.getBoundingClientRect().width;
            grip.classList.add('is-dragging');
            grip.setPointerCapture(e.pointerId);

            function move(ev) { setAsideWidth(startW - (ev.clientX - startX), false); }
            function up(ev) {
                grip.classList.remove('is-dragging');
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                setAsideWidth(startW - (ev.clientX - startX), true);
                renderCanvas(true);
            }
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        });

        /* Mit der Tastatur in Zehnerschritten, damit der Griff nicht nur
           für die Maus da ist. */
        grip.addEventListener('keydown', function (e) {
            var step = e.shiftKey ? 40 : 10;
            var now = aside.getBoundingClientRect().width;
            if (e.key === 'ArrowLeft') { setAsideWidth(now + step, true); e.preventDefault(); }
            else if (e.key === 'ArrowRight') { setAsideWidth(now - step, true); e.preventDefault(); }
            else return;
            renderCanvas(true);
        });
    }

    function init() {
        if (!$('#spApp')) return;
        db = load();
        loadUi();
        if (!ui.sceneId || !scene()) ui.sceneId = (scenes()[0] || {}).id;
        if (!ui.print) ui.print = null;
        translateMarkup();
        wire();
        wireAsideGrip();
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
