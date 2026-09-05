/*
 * Bühnenbild-Planer — geometry, change lists and printed pagination.
 * Pure Node, no browser: the modules under test never touch the DOM.
 */
const assert = require('assert');
const SP = require('../tools/buehnenbild/core.js');
const Props = require('../tools/buehnenbild/props.js');
const Plan = require('../tools/buehnenbild/plan.js');
const Sheets = require('../tools/buehnenbild/sheets.js');
const I18n = require('../tools/buehnenbild/i18n.js');
const Draw = require('../tools/buehnenbild/draw.js');
const Guide = require('../tools/buehnenbild/guide.js');
const Shapes = require('../tools/buehnenbild/shapes.js');

let passed = 0;
function test(name, fn) {
    try {
        fn();
        passed += 1;
        console.log('  ok  ' + name);
    } catch (err) {
        console.error('  FAIL  ' + name + '\n        ' + err.message);
        process.exitCode = 1;
    }
}

const resolve = (id) => Props.get(id);

function placement(propId, x, y, extra) {
    const prop = Props.get(propId);
    return Object.assign(SP.makePlacement(prop, x, y), extra || {});
}

/* ------------------------------------------------------------- geometry */

test('a rectangular stage is centred on the centre line', () => {
    const out = SP.stageOutline({ shape: 'rect', width: 12, depth: 9 });
    assert.deepStrictEqual(out.bounds, { x: -6, y: 0, w: 12, h: 9 });
    assert.strictEqual(out.frontY, 9);
    assert.deepStrictEqual(out.audience, ['front']);
});

test('every shape produces a path, sane bounds and a setting line', () => {
    SP.STAGE_SHAPES.forEach((shape) => {
        const stage = Object.assign({}, SP.DEFAULT_STAGE, { shape: shape.id });
        const out = SP.stageOutline(stage);
        assert.ok(out.d.length > 8, shape.id + ' has no path');
        assert.ok(out.bounds.w > 0 && out.bounds.h > 0, shape.id + ' has empty bounds');
        assert.ok(out.frontY > out.bounds.y, shape.id + ' has no setting line');
        assert.ok(!/NaN|undefined/.test(out.d), shape.id + ' path has a hole in it');
    });
});

test('a thrust stage reaches further downstage than its setting line', () => {
    const stage = { shape: 'thrust', width: 12, depth: 8, apronWidth: 7, apronDepth: 2.5 };
    const out = SP.stageOutline(stage);
    assert.strictEqual(out.frontY, 8);
    assert.strictEqual(SP.round(out.bounds.h, 3), 10.5);
    assert.deepStrictEqual(out.audience, ['front', 'left', 'right']);
});

test('the floor narrows towards the front of a trapezoid', () => {
    const stage = { shape: 'trapezoid', width: 12, backWidth: 6, depth: 10 };
    assert.deepStrictEqual(SP.spanAt(stage, 0), [-3, 3]);
    assert.deepStrictEqual(SP.spanAt(stage, 10), [-6, 6]);
    const middle = SP.spanAt(stage, 5);
    assert.strictEqual(SP.round(middle[1], 3), 4.5);
});

test('a half-round stage is widest at the back wall', () => {
    const stage = { shape: 'halfround', diameter: 10 };
    assert.deepStrictEqual(SP.spanAt(stage, 0), [-5, 5], 'the flat wall is the full diameter');
    assert.deepStrictEqual(SP.spanAt(stage, 3), [-4, 4]);
    assert.strictEqual(SP.spanAt(stage, -1), null, 'behind the wall there is no stage');
    assert.strictEqual(SP.spanAt(stage, 6), null, 'past the curve there is no stage');
    const out = SP.stageOutline(stage);
    assert.deepStrictEqual(out.bounds, { x: -5, y: 0, w: 10, h: 5 });
    assert.strictEqual(out.frontY, 5);
});

test('points off the floor are recognised as off the floor', () => {
    const stage = { shape: 'halfround', diameter: 10 };
    assert.strictEqual(SP.containsPoint(stage, 0, 2), true);
    assert.strictEqual(SP.containsPoint(stage, 4.9, 4.5), false, 'the corner is past the curve');
    assert.strictEqual(SP.containsPoint(stage, 0, -0.5), false, 'behind the back wall');
});

test('the three rare shapes are gone and old plans fall back to a rectangle', () => {
    /* Rund, Rundumbühne und Vieleck kamen an echten Häusern kaum vor und
       kosteten jede eine Karte, ein Maßfeld und einen Zweig in der Geometrie.
       Ein Plan, der eine davon trägt, muss trotzdem etwas zeichnen — und darf
       nicht rund bleiben, während in der Auswahl „Rechteckig" markiert steht. */
    const gone = ['circle', 'arena', 'polygon'];
    gone.forEach((id) => {
        assert.ok(!SP.STAGE_SHAPES.some((sh) => sh.id === id), id + ' is still offered');
        assert.strictEqual(SP.shapeById(id).id, 'rect', id + ' does not fall back to a rectangle');
        const out = SP.stageOutline({ shape: id, width: 12, depth: 9 });
        assert.deepStrictEqual(out.bounds, { x: -6, y: 0, w: 12, h: 9 },
            id + ' still draws its old outline');
    });
    assert.deepStrictEqual(SP.STAGE_SHAPES.map((sh) => sh.id),
        ['rect', 'trapezoid', 'thrust', 'halfround', 'traverse']);
});

/* ---------------------------------------------------------------- units */

test('lengths read the way a crew writes them', () => {
    assert.strictEqual(SP.formatLength(2.4), '2,4 m');
    assert.strictEqual(SP.formatLength(12.5), '12,5 m');
    assert.strictEqual(SP.formatLength(0.85), '0,85 m');
    assert.strictEqual(SP.formatLength(-0.5), '-0,5 m');
});

test('the planner measures in metres and in nothing else', () => {
    /* Fuß und Zoll gab es als Umschalter pro Produktion. Er stand unauffindbar
       unten im Bühne-Reiter, kostete an jedem Zahlenfeld eine Umrechnung und
       war die Ursache dafür, dass im Feld „59.06" stand und in der Zeile
       darunter „59′–11″". Wer ihn wieder einbaut, baut den Widerspruch mit
       wieder ein. */
    assert.strictEqual(SP.unitSuffix(), 'm');
    assert.strictEqual(SP.toUnit(4.5), 4.5);
    assert.strictEqual(SP.toMetres(4.5), 4.5);
    assert.ok(SP.formatLength(3.81).indexOf('′') === -1, 'a length is still written in feet');

    const src = require('fs').readFileSync(
        require('path').join(__dirname, '../tools/buehnenbild/app.js'), 'utf8');
    assert.ok(src.indexOf("'Feet and inches'") === -1, 'the feet switch is back in the interface');
});

/* ----------------------------------------------------------------- grid */

test('grid references run left to right and upstage from the setting line', () => {
    const stage = { shape: 'rect', width: 12, depth: 9, grid: { show: true, spacing: 1 } };
    assert.strictEqual(SP.gridReference(stage, -5.5, 8.5, 1), 'A1');
    assert.strictEqual(SP.gridReference(stage, 5.5, 8.5, 1), 'L1');
    assert.strictEqual(SP.gridReference(stage, -5.5, 0.5, 1), 'A9');
});

test('column letters carry past Z', () => {
    assert.strictEqual(SP.columnLetter(0), 'A');
    assert.strictEqual(SP.columnLetter(25), 'Z');
    assert.strictEqual(SP.columnLetter(26), 'AA');
});

test('a position is described in stage directions', () => {
    const stage = { shape: 'rect', width: 12, depth: 9 };
    SP.setDirections('audience');
    assert.strictEqual(SP.describePosition(stage, 2, 6, 'm'), '2 m nach rechts, 3 m nach hinten');
    assert.strictEqual(SP.describePosition(stage, -2, 9, 'm'), '2 m nach links, auf der Bauflucht');
    assert.strictEqual(SP.describePosition(stage, 0, 4.5, 'm'), 'auf der Mittelachse, 4,5 m nach hinten');
});

/* -------------------------------------------------------- change lists */

test('a prop that stays put is not reported as a change', () => {
    const a = { placements: [placement('ill-chair', 1, 2, { trackId: 't1' })] };
    const b = { placements: [placement('ill-chair', 1, 2, { trackId: 't1' })] };
    const diff = SP.diffScenes(a, b);
    assert.strictEqual(SP.changeCount(diff), 0);
    assert.strictEqual(diff.unchanged.length, 1);
});

test('a tracked prop that shifts is a move, not a strike and a re-set', () => {
    const a = { placements: [placement('dining-table', 0, 3, { trackId: 't1' })] };
    const b = { placements: [placement('dining-table', 2.5, 5, { trackId: 't1' })] };
    const diff = SP.diffScenes(a, b);
    assert.strictEqual(diff.added.length, 0);
    assert.strictEqual(diff.removed.length, 0);
    assert.strictEqual(diff.moved.length, 1);
    assert.strictEqual(SP.round(diff.moved[0].distance, 2), 3.2);
});

test('turning a prop on the spot counts as a change', () => {
    const a = { placements: [placement('armchair', 1, 1, { trackId: 't1', rot: 0 })] };
    const b = { placements: [placement('armchair', 1, 1, { trackId: 't1', rot: 45 })] };
    const diff = SP.diffScenes(a, b);
    assert.strictEqual(diff.moved.length, 1);
    assert.strictEqual(diff.moved[0].turned, 45);
});

test('untracked props of the same kind pair up by their written label', () => {
    const a = { placements: [
        placement('ill-chair', -3, 2, { label: "Anna's" }),
        placement('ill-chair', 3, 2, { label: "Peter's" })
    ] };
    const b = { placements: [
        placement('ill-chair', 3.1, 2, { label: "Anna's" }),
        placement('ill-chair', -3, 2, { label: "Peter's" })
    ] };
    const diff = SP.diffScenes(a, b);
    assert.strictEqual(diff.added.length, 0);
    assert.strictEqual(diff.removed.length, 0);
    assert.strictEqual(diff.moved.length, 2);
});

test('what is genuinely new comes on, what is gone is struck', () => {
    const a = { placements: [placement('bed', 0, 3), placement('suitcase', 0, 4)] };
    const b = { placements: [placement('bed', 0, 3), placement('rock', -2, 1)] };
    const diff = SP.diffScenes(a, b);
    assert.strictEqual(diff.added.length, 1);
    assert.strictEqual(diff.added[0].propId, 'rock');
    assert.strictEqual(diff.removed.length, 1);
    assert.strictEqual(diff.removed[0].propId, 'suitcase');
});

test('the first scene has nothing to compare against', () => {
    const diff = SP.diffScenes(null, { placements: [placement('ill-chair', 0, 0)] });
    assert.strictEqual(diff.isFirst, true);
    assert.strictEqual(diff.added.length, 1);
});

test('identical props are grouped for the change list', () => {
    const list = [placement('ill-chair', 0, 0), placement('ill-chair', 1, 0), placement('dining-table', 2, 0)];
    const groups = SP.groupByProp(list, (id) => Props.get(id).name);
    assert.strictEqual(groups.length, 2);
    assert.strictEqual(groups[0].count, 2);
    assert.strictEqual(groups[0].name, 'School chair');
});

/* ------------------------------------------------------------ mirroring */

test('mirroring flips positions and rotations across the centre line', () => {
    const stage = { shape: 'rect', width: 12, depth: 9 };
    const mirrored = SP.mirrorPlacements([placement('ill-chair', 2.5, 4, { rot: 30 })], 'horizontal', stage);
    assert.strictEqual(mirrored[0].x, -2.5);
    assert.strictEqual(mirrored[0].y, 4);
    assert.strictEqual(mirrored[0].rot, -30);
    assert.strictEqual(mirrored[0].flip, true);
});

test('mirroring twice returns the layout to where it started', () => {
    const stage = { shape: 'rect', width: 12, depth: 9 };
    const original = [placement('armchair', 1.5, 3, { rot: 20 })];
    const back = SP.mirrorPlacements(SP.mirrorPlacements(original, 'horizontal', stage), 'horizontal', stage);
    assert.strictEqual(back[0].x, original[0].x);
    assert.strictEqual(back[0].rot, original[0].rot);
    assert.strictEqual(back[0].flip, original[0].flip);
});

test('copying a layout can keep or break the link to the original props', () => {
    const source = [placement('ill-chair', 0, 0, { trackId: 'keep-me' })];
    assert.strictEqual(SP.copyPlacements(source, true)[0].trackId, 'keep-me');
    assert.notStrictEqual(SP.copyPlacements(source, false)[0].trackId, 'keep-me');
    assert.notStrictEqual(SP.copyPlacements(source, true)[0].id, source[0].id);
});

/* ------------------------------------------------ acts, numbers, sheets */

function sampleProduction(numbering) {
    const act1 = { id: 'a1', name: 'Act one' };
    const act2 = { id: 'a2', name: 'Act two' };
    const scene = (id, actId, placements) => ({
        id, actId, title: 'Scene ' + id, placements: placements || [], curtains: {}
    });
    return {
        name: 'Test piece',
        units: 'm',
        numbering: numbering || 'continuous',
        stage: Object.assign({}, SP.DEFAULT_STAGE, {
            curtains: [{ id: 'c1', name: 'House curtain', offset: 0.4, state: 'closed' }]
        }),
        acts: [act1, act2],
        scenes: [
            scene('s1', 'a1', [placement('dining-table', 0, 5), placement('ill-chair', 1, 5)]),
            scene('s2', 'a1', [placement('dining-table', 0, 5)]),
            scene('s3', 'a2', [placement('rock', -2, 2)]),
            scene('s4', 'a2', [placement('rock', -2, 2), placement('ill-bench', 1, 4)])
        ]
    };
}

test('scenes number straight through, or restart inside each act', () => {
    assert.deepStrictEqual(
        SP.numberScenes(sampleProduction('continuous')).map((n) => n.label),
        ['1', '2', '3', '4']);
    assert.deepStrictEqual(
        SP.numberScenes(sampleProduction('per-act')).map((n) => n.label),
        ['I.1', 'I.2', 'II.1', 'II.2']);
});

test('a hand-written scene number wins over the worked-out one', () => {
    const production = sampleProduction();
    production.scenes[1].label = 'Interlude';
    assert.strictEqual(SP.numberScenes(production)[1].label, 'Interlude');
});

test('the running order splits into consecutive runs of the same act', () => {
    const groups = SP.groupScenesByAct(sampleProduction());
    assert.strictEqual(groups.length, 2);
    assert.strictEqual(groups[0].act.name, 'Act one');
    assert.strictEqual(groups[1].scenes.length, 2);
});

test('overview sheets fill up and can break at the interval', () => {
    const production = sampleProduction();
    assert.strictEqual(SP.overviewPages(production, 2, 2, false).length, 1);
    assert.strictEqual(SP.overviewPages(production, 3, 3, true).length, 2);
    assert.strictEqual(SP.overviewPages(production, 1, 1, false).length, 4);
});

test('the inventory reports the most of a prop needed at any one time', () => {
    const production = sampleProduction();
    production.scenes[0].placements.push(placement('ill-chair', -1, 5));
    const inventory = SP.propInventory(production);
    const chairs = inventory.filter((entry) => entry.propId === 'ill-chair')[0];
    assert.strictEqual(chairs.peak, 2);
    assert.strictEqual(chairs.scenes.length, 1);
});

/* ------------------------------------------------------- the drawing */

test('a plan draws the stage, the props and a scale bar', () => {
    const production = sampleProduction();
    const plan = Plan.build({
        stage: production.stage,
        scene: production.scenes[0],
        resolve,
        units: 'm'
    });
    assert.ok(/^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/.test(plan.viewBox), 'bad viewBox: ' + plan.viewBox);
    assert.ok(plan.inner.includes('class="sp-stage"'));
    assert.ok(plan.inner.includes('class="sp-scale"'));
    assert.strictEqual((plan.inner.match(/class="sp-item"/g) || []).length, 2);
    assert.ok(!/NaN|undefined/.test(plan.inner), 'the drawing has NaN in it');
});

test('every built-in prop draws without a hole in it', () => {
    Props.LIBRARY.forEach((prop) => {
        assert.ok(prop.w > 0 && prop.h > 0, prop.id + ' has no footprint');
        assert.ok(Props.CATEGORIES.includes(prop.cat), prop.id + ' is in an unknown category');
        /* Ein Eintrag ist gerechnet oder gezeichnet. Beides nicht zu sein
           hieße, dass er auf dem Plan gar nichts hinterlässt — und geprüft
           wird, was herauskommt, nicht was im Quelltext steht. */
        if (!Shapes.has(prop)) {
            assert.ok(/^</.test(prop.art || ''), prop.id + ' does not start with an element');
            assert.ok(!/NaN|undefined/.test(prop.art), prop.id + ' has NaN in its drawing');
        }
        const drawn = Shapes.draw(prop, prop.w, prop.h, prop.params, 0.01, { text: 'Probe' });
        assert.ok(drawn.length > 8, prop.id + ' draws nothing at all');
        assert.ok(!/NaN|undefined/.test(drawn), prop.id + ' has a hole on the plan');
    });
    const ids = Props.LIBRARY.map((p) => p.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'two props share an id');
});

test('an open curtain is drawn parted, a closed one across the whole stage', () => {
    const production = sampleProduction();
    const closed = Plan.build({ stage: production.stage, scene: { placements: [], curtains: {} }, resolve });
    const open = Plan.build({
        stage: production.stage,
        scene: { placements: [], curtains: { c1: 'open' } },
        resolve
    });
    assert.ok(closed.inner.includes('House curtain<'));
    assert.ok(open.inner.includes('House curtain, offen'),
        'the curtain keeps its own name and gets its state in German');
    assert.ok(open.inner.includes('sp-curtain-track'), 'an open curtain shows its track');
});

/* ------------------------------------------------- the prop creator */

test('a drawn shape comes out as the same markup the built-ins use', () => {
    const art = Draw.markup([
        { k: 'rect', x: 20, y: 20, w: 60, h: 40, r: 4, m: 'f' },
        { k: 'rect', x: 25, y: 25, w: 50, h: 30, r: 0, m: 'o' }
    ]);
    assert.strictEqual(art,
        '<rect class="f" x="20" y="20" width="60" height="40" rx="4"/>' +
        '<rect x="25" y="25" width="50" height="30"/>');
    assert.ok(!/stroke/.test(art), 'the art must not carry its own stroke');
    assert.ok(!/transform/.test(art), 'the art must not carry a transform');
});

test('each paint mode writes its own class, and the plain outline writes none', () => {
    const marks = Draw.MODES.map((mode) =>
        Draw.markup([{ k: 'ellipse', cx: 50, cy: 50, rx: 20, ry: 20, m: mode.id }]));
    assert.deepStrictEqual(marks, [
        '<circle cx="50" cy="50" r="20"/>',
        '<circle class="f" cx="50" cy="50" r="20"/>',
        '<circle class="d" cx="50" cy="50" r="20"/>',
        '<circle class="s" cx="50" cy="50" r="20"/>'
    ]);
});

test('a round ellipse is written as a circle, and a square corner has no rx', () => {
    assert.ok(Draw.markup([{ k: 'ellipse', cx: 50, cy: 50, rx: 30, ry: 30, m: 'o' }]).startsWith('<circle'));
    assert.ok(Draw.markup([{ k: 'ellipse', cx: 50, cy: 50, rx: 30, ry: 12, m: 'o' }]).startsWith('<ellipse'));
    assert.ok(!Draw.markup([{ k: 'rect', x: 0, y: 0, w: 10, h: 10, r: 0, m: 'o' }]).includes('rx='));
});

test('open and closed runs differ by the closing Z', () => {
    const pts = [[10, 10], [90, 10], [50, 80]];
    assert.strictEqual(Draw.markup([{ k: 'polyline', pts, m: 'o' }]),
        '<path d="M10 10 L90 10 L50 80"/>');
    assert.strictEqual(Draw.markup([{ k: 'polygon', pts, m: 'f' }]),
        '<path class="f" d="M10 10 L90 10 L50 80 Z"/>');
    assert.strictEqual(Draw.markup([{ k: 'line', x1: 5, y1: 5, x2: 95, y2: 5, m: 'd' }]),
        '<path class="d" d="M5 5 L95 5"/>');
});

test('coordinates never carry more than one decimal', () => {
    const art = Draw.markup([
        { k: 'rect', x: 1 / 3, y: 2 / 3, w: 10.06, h: 9.94, r: 1.27, m: 'o' },
        { k: 'polygon', pts: [[1.234, 2.345], [3.456, 4.567], [5.678, 6.789]], m: 'o' }
    ]);
    (art.match(/-?\d+\.\d+/g) || []).forEach((number) => {
        assert.ok(/^-?\d+(\.\d)?$/.test(number), number + ' has too many decimals');
    });
    assert.ok(!/NaN|undefined/.test(art), 'the drawing has NaN in it');
});

test('nothing escapes the 100 box, however it was dragged', () => {
    const wild = Draw.normalise({ k: 'rect', x: -40, y: 120, w: -30, h: 500, r: 999, m: 'f' });
    assert.ok(wild.x >= 0 && wild.y >= 0);
    assert.ok(wild.x + wild.w <= Draw.BOX && wild.y + wild.h <= Draw.BOX);
    assert.ok(wild.r <= Math.min(wild.w, wild.h) / 2, 'the corner radius outgrew its own box');
    const run = Draw.normalise({ k: 'polygon', pts: [[-5, 50], [200, 50], [50, -7]], m: 'o' });
    run.pts.forEach(([x, y]) => {
        assert.ok(x >= 0 && x <= Draw.BOX && y >= 0 && y <= Draw.BOX, 'a corner left the box');
    });
});

test('a shape dragged by a handle lands exactly in the new frame', () => {
    [
        { k: 'rect', x: 10, y: 10, w: 20, h: 20, r: 2, m: 'o' },
        { k: 'ellipse', cx: 20, cy: 20, rx: 10, ry: 10, m: 'f' },
        { k: 'line', x1: 10, y1: 10, x2: 30, y2: 30, m: 'o' },
        { k: 'polygon', pts: [[10, 10], [30, 10], [20, 30]], m: 'd' }
    ].forEach((shape) => {
        const box = { x: 40, y: 5, w: 50, h: 25 };
        const moved = Draw.setBounds(shape, box);
        const got = Draw.bounds(moved);
        assert.deepStrictEqual(got, box, shape.k + ' did not fill its new frame');
        assert.strictEqual(moved.m, shape.m, shape.k + ' lost its paint mode');
    });
});

test('moving keeps the size and the paint mode', () => {
    const shape = { k: 'polyline', pts: [[10, 10], [30, 20]], m: 'd' };
    const moved = Draw.moveBy(shape, 15, -5);
    assert.deepStrictEqual(Draw.bounds(moved), { x: 25, y: 5, w: 20, h: 10 });
    assert.strictEqual(Draw.markup([moved]), '<path class="d" d="M25 5 L45 15"/>');
});

test('shapes too small to see are dropped instead of saved', () => {
    const kept = Draw.clean([
        { k: 'rect', x: 10, y: 10, w: 0, h: 40, m: 'o' },
        { k: 'polygon', pts: [[1, 1], [2, 2]], m: 'o' },
        { k: 'line', x1: 5, y1: 5, x2: 5, y2: 5, m: 'o' },
        { k: 'rect', x: 10, y: 10, w: 40, h: 40, r: 0, m: 'f' }
    ]);
    assert.strictEqual(kept.length, 1);
    assert.strictEqual(Draw.markup(kept), '<rect class="f" x="10" y="10" width="40" height="40"/>');
});

test('a drawn prop lands on the plan like any built-in one', () => {
    const shapes = [{ k: 'rect', x: 10, y: 10, w: 80, h: 80, r: 4, m: 'f' }];
    const box = Draw.boundsOf(shapes);
    const drawn = {
        id: 'drawn-1', name: 'Gezeichnete Kiste', cat: 'Objects', w: 0.8, h: 0.8,
        box: [box.x, box.y, box.w, box.h],
        art: Draw.markup(shapes)
    };
    const plan = Plan.build({
        stage: Object.assign({}, SP.DEFAULT_STAGE),
        scene: { placements: [SP.makePlacement(drawn, 0, 4)], curtains: {} },
        resolve: () => drawn
    });
    assert.ok(plan.inner.includes(drawn.art), 'the drawing did not reach the plan');
    assert.ok(!/NaN|undefined/.test(plan.inner));
    /* Eine eigene Zeichnung geht denselben Weg wie jede eingebaute: ein
       Faktor für beide Richtungen, die Mitte ihres gemessenen Feldes auf den
       Nullpunkt. Gezogen würde aus ihrem Kreis eine Ellipse. */
    assert.strictEqual(SP.round(Shapes.extent(drawn, 0.8, 0.8).w, 3), 0.8);
    assert.strictEqual(SP.round(Shapes.extent(drawn, 2, 0.8).w, 3), 0.8,
        'a wider footprint stretched the drawing');
    assert.ok(Plan.keepsAspect(drawn), 'a drawing must keep its shape');
    assert.ok(!Plan.keepsAspect({ shape: 'sofa' }), 'a recipe must stay free');
});

test('a saved drawing can be reopened and comes back the same', () => {
    const shapes = Draw.clean([
        { k: 'rect', x: 12.5, y: 20, w: 75, h: 60, r: 5, m: 'f' },
        { k: 'polyline', pts: [[20, 30], [80, 30]], m: 'd' }
    ]);
    const stored = JSON.parse(JSON.stringify({ draft: shapes, art: Draw.markup(shapes) }));
    assert.strictEqual(Draw.markup(Draw.clean(stored.draft)), stored.art);
});

/* --------------------------------------------------------------- sheets */

test('the plans cover title, acts, scenes, overview and inventory', () => {
    const production = sampleProduction('per-act');
    /* Ab Werk kommen nur die Szenenblätter — wer den ganzen Satz will, hakt
       ihn an. Vorher druckte eine Produktion mit fünf Szenen zehn Blätter,
       auch wenn man nur eine Szene nachdrucken wollte. */
    const sheets = Sheets.buildPlans({
        production, resolve,
        options: { inventory: true, cover: true, actPages: true, overview: true }
    });
    const all = sheets.join('');
    assert.ok(sheets.length >= 8, 'expected a full set, got ' + sheets.length);
    assert.ok(all.includes('Test piece'));
    assert.ok(all.includes('Act one'));
    assert.ok(all.includes('Requisitenliste'));
    assert.ok(all.includes('Seite 1 von ' + sheets.length));
    assert.ok(!all.includes('%%PAGE%%'), 'page numbers were left unfilled');
    assert.ok(!/NaN|undefined/.test(all), 'a sheet has NaN on it');
});

test('nothing but the scene sheets comes out unless it is asked for', () => {
    const production = sampleProduction('per-act');
    const sheets = Sheets.buildPlans({ production, resolve });
    assert.strictEqual(sheets.length, production.scenes.length,
        'the default set is one sheet per scene and nothing else');
    const all = sheets.join('');
    assert.ok(!all.includes('Requisitenliste'), 'the prop list printed itself');
    /* Und auf dem Blatt steht, was die Sache ausmacht — kein Bodenraster,
       keine leere Fußzeile. */
    assert.ok(!all.includes('sp-grid'), 'the floor grid is back on the default sheet');
    assert.ok(all.includes('sp-scale') || all.includes('2 m') || all.includes('sp-audience'),
        'the sheet lost its scale bar and its audience');
});

test('every prop can be found under the word that is printed on it', () => {
    /* Die Kachel sagt „Tür", die Requisite heißt im Quelltext „Doorway", und
       die Suche sah nur den Quelltext. Wer „Tür" tippte, bekam nichts. */
    const notFound = Props.LIBRARY.filter((p) => {
        const shown = I18n.t(p.name).toLowerCase();
        const haystack = [p.name, I18n.t(p.name), p.tags || '', p.cat, I18n.t(p.cat)]
            .join(' ').toLowerCase();
        return haystack.indexOf(shown) === -1;
    });
    assert.deepStrictEqual(notFound.map((p) => p.name), [],
        'these props cannot be found under their own printed name');
});

test('every prop in the catalogue survives a trip through the prop list', () => {
    /* Die Liste las `prop.art`. Was eine Bauvorschrift ist und kein fertiges
       Bild mitbringt, druckte damit das Wort „undefined“ neben seinen Namen —
       der Tisch mit der Decke tat das, und jede künftige Vorschrift auch. */
    const placements = Props.LIBRARY.map((p, i) =>
        SP.makePlacement(p, (i % 6) - 3, 1 + (i % 4)));
    const production = {
        name: 'Alle', stage: SP.DEFAULT_STAGE, acts: [], places: [],
        scenes: [{ id: 's1', title: 'Alles', actId: null, placeId: null,
            placements, curtains: {}, wingNotes: [] }]
    };
    const all = Sheets.buildPlans({
        production, resolve,
        options: { inventory: true, overview: true, scenePages: true, cover: true }
    }).join('');
    assert.ok(!/undefined/.test(all), 'a prop prints the word undefined');
    assert.ok(!/NaN/.test(all), 'a prop prints NaN');
    Props.LIBRARY.forEach((p) => {
        assert.ok(all.indexOf(I18n.t(p.name)) !== -1, p.id + ' never reaches the paper');
    });
});

test('the worked example only places props that exist', () => {
    /* `put` gab bei einem unbekannten Namen still null zurück, und die Zeile
       fiel aus der Szene. Die Schulklasse im Beispiel stand ohne Pult da, das
       Wohnzimmer ohne Tisch — beides monatelang unbemerkt. */
    const src = require('fs').readFileSync(
        require('path').join(__dirname, '../tools/buehnenbild/app.js'), 'utf8');
    const ids = [...src.matchAll(/put\('([^']+)'/g)].map((m) => m[1]);
    assert.ok(ids.length > 10, 'the example places barely anything, did put() get renamed?');
    const gone = [...new Set(ids)].filter((id) => !Props.get(id));
    assert.deepStrictEqual(gone, [], 'the example places props that are no longer in the catalogue');
});

test('a drawing fills the size it is written down as', () => {
    /* `drawArt` setzt gleichmäßig um: passt das Feld der Zeichnung nicht zum
       angeschriebenen Maß, wird das Ding kleiner gezeichnet, als es dasteht.
       Beim Kleiderständer waren das 1,73 m auf dem Papier und 0,98 m in der
       Zahl — auf dem Plan stand er halb so hoch wie im echten Foyer. */
    const off = Props.LIBRARY.filter((p) => p.box).filter((p) => {
        const drawn = p.box[2] / p.box[3];
        return Math.abs(drawn - p.w / p.h) / (p.w / p.h) > 0.04;
    });
    assert.deepStrictEqual(off.map((p) => p.id), [],
        'these drawings do not fill their stated footprint');
});

test('the floor grid on the print tab does not wait for the stage tab', () => {
    /* „Bodenraster zeigen" war stumm, solange das Raster im Bühne-Reiter aus
       war — man hakte an, und auf dem Blatt änderte sich nichts. */
    const production = sampleProduction();
    production.stage.grid = { show: false, spacing: 1, labels: false };
    const on = Sheets.buildPlans({ production, resolve, options: { showGrid: true } }).join('');
    assert.ok(on.includes('sp-grid'), 'the print option still leaves the floor bare');
    const off = Sheets.buildPlans({ production, resolve, options: { showGrid: false } }).join('');
    assert.ok(!off.includes('sp-grid'), 'the floor grid printed although it was switched off');
});

test('the title sheet counts the act it is printed with, not the whole piece', () => {
    const production = sampleProduction('per-act');
    const act = production.acts[0];
    const mine = production.scenes.filter((s) => s.actId === act.id);
    assert.ok(mine.length < production.scenes.length, 'the sample has only one act');
    const cover = Sheets.buildPlans({
        production, resolve,
        options: { cover: true, scenePages: false, scope: act.id }
    })[0];
    assert.ok(cover.includes('>' + mine.length + '<'),
        'the cover counts scenes that are not in this set');
    assert.ok(!cover.includes('>' + production.scenes.length + '<'),
        'the cover still counts the whole production');
});

test('turning sheets off leaves only what was asked for', () => {
    const production = sampleProduction();
    const sheets = Sheets.buildPlans({
        production, resolve,
        options: {
            cover: false, actPages: false, overview: false,
            inventory: false, scenePages: true
        }
    });
    assert.strictEqual(sheets.length, production.scenes.length);
});

test('the overview puts the whole evening on one sheet', () => {
    /* Ein Überblick auf zwei Blättern ist keiner. Und gesucht ist nicht das
       Raster mit den wenigsten leeren Zellen, sondern das, in dem der
       Grundriss am größten herauskommt — eine fast quadratische Zelle nützt
       einem querformatigen Plan nichts. */
    const evening = (n) => {
        const scenes = [];
        for (let i = 0; i < n; i++) {
            scenes.push({ id: 's' + i, title: 'Szene ' + i, placeId: null, actId: null,
                curtains: {}, placements: [] });
        }
        return { id: 'p', name: 'Probe', numbering: 'continuous',
            stage: Object.assign({}, SP.DEFAULT_STAGE), acts: [], places: [], scenes: scenes,
            transitions: {} };
    };
    const grid = (n) => {
        const sheets = Sheets.buildPlans({
            production: evening(n), resolve,
            options: { scenePages: false, overview: true }
        });
        const all = sheets.join('');
        return {
            sheets: sheets.length,
            cols: Number(/grid-template-columns: repeat\((\d+)/.exec(all)[1]),
            rows: Number(/grid-template-rows: repeat\((\d+)/.exec(all)[1]),
            all: all
        };
    };
    [3, 8, 12, 25, 40].forEach((n) => {
        const g = grid(n);
        assert.strictEqual(g.sheets, 1, n + ' scenes spilled onto ' + g.sheets + ' sheets');
        assert.ok(g.cols * g.rows >= n, n + ' scenes do not fit in ' + g.cols + '×' + g.rows);
        /* Die Zelle liegt quer, wie der Grundriss darin. */
        const cell = (269 / g.cols) / (160 / g.rows);
        assert.ok(cell > 1, n + ' scenes give upright cells (' + cell.toFixed(2) + ')');
    });
    /* Fünfundzwanzig Bühnenbilder werden nicht briefmarkengroß. */
    const big = grid(25);
    assert.ok(269 / big.cols >= 45, 'a cell is only ' + Math.round(269 / big.cols) + ' mm wide');
    /* Und in der Zelle steht die Nummer, nicht der Titel. */
    assert.ok(big.all.indexOf('Szene 7') === -1, 'the overview still prints scene titles');
});

test('a landscape sheet is laid out on its side', () => {
    const production = sampleProduction();
    const sheets = Sheets.buildPlans({ production, resolve, options: { orientation: 'landscape' } });
    assert.ok(sheets[0].includes('is-landscape'));
});

test('a plan sheet carries the drawing, the number and nothing to read', () => {
    const production = sampleProduction();
    const sheets = Sheets.buildPlans({
        production, resolve,
        options: { cover: false, actPages: false, overview: false }
    });
    const second = sheets[1];
    assert.ok(second.includes('sp-plan-sheet'), 'a scene is printed as a plan sheet');
    assert.ok(second.includes('<svg'), 'the drawing is on the sheet');
    assert.ok(!second.includes('Abbau'), 'the change list belongs in the Umbauplan, not here');
    assert.ok(!second.includes('Auf der B'), 'no prop list on a plan sheet');
    assert.ok(!/\d+,\d+ m nach/.test(second), 'no positions in words on a plan sheet');
});

test('printing one act only leaves the rest at home', () => {
    const production = sampleProduction();
    const sheets = Sheets.buildPlans({
        production, resolve,
        options: { scope: 'a2', cover: false, actPages: false, overview: false }
    });
    assert.strictEqual(sheets.length, 2);
});


/* ------------------------------------------------------------- language */

test('lengths and directions come out in German', () => {
    assert.strictEqual(SP.formatLength(2.4, 'm'), '2,4 m', 'German uses a decimal comma');
    SP.setDirections('audience');
    const stage = { shape: 'rect', width: 12, depth: 9 };
    assert.strictEqual(SP.zoneName(stage, 4, 1), 'hinten rechts');
    assert.strictEqual(SP.zoneName(stage, -4, 8), 'vorne links');
    assert.strictEqual(SP.zoneName(stage, 0, 6), 'Bühnenmitte', 'mid depth, on the centre line');
    assert.strictEqual(SP.zoneName(stage, 0, 4.5), 'hinten Mitte', 'past the middle is upstage');
    assert.ok(SP.describePosition(stage, 2.4, 5.9, 'm').includes('nach rechts'));
});

test('the cast see left and right the other way round', () => {
    const stage = { shape: 'rect', width: 12, depth: 9 };
    SP.setDirections('audience');
    const fromHouse = SP.zoneName(stage, 4, 1);
    SP.setDirections('cast');
    const fromStage = SP.zoneName(stage, 4, 1);
    SP.setDirections('audience');
    assert.strictEqual(fromHouse, 'hinten rechts');
    assert.strictEqual(fromStage, 'hinten links', 'the same spot is the cast’s other hand');
});

test('an unknown key falls through to its own text', () => {
    assert.strictEqual(I18n.t('Bring on'), 'Aufbau');
    assert.strictEqual(I18n.t('Kleiderständer aus dem Fundus'), 'Kleiderständer aus dem Fundus');
});

test('every translated string in the source exists in the dictionary', () => {
    /*
     * Fängt die Sorte Fehler, die beim Aufräumen des Wörterbuchs entsteht:
     * ein Schlüssel wird als unbenutzt gestrichen, obwohl ihn jemand aufruft.
     * Dann fällt t() stillschweigend auf den englischen Schlüssel zurück und
     * niemand merkt es, bis ein Anwender englischen Text sieht.
     */
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '../tools/buehnenbild/');
    const missing = [];

    const record = (raw, where) => {
        let key;
        try { key = JSON.parse('"' + raw.replace(/\\'/g, "'").replace(/"/g, '\\"') + '"'); }
        catch (e) { return; }
        if (I18n.DE[key] === undefined) missing.push(key + '  (' + where + ')');
    };

    ['app.js', 'core.js', 'plan.js', 'sheets.js', 'draw.js'].forEach((file) => {
        const src = fs.readFileSync(dir + file, 'utf8');
        // t('…') — aber nicht t('… ' + variable), wo der Schlüssel erst zur
        // Laufzeit entsteht
        const call = /(?:^|[^\w$.])t\(\s*'((?:[^'\\]|\\.)*)'\s*([),])/g;
        let m;
        while ((m = call.exec(src))) record(m[1], file);
        const plural = /plural\(\s*[^,]+,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'/g;
        while ((m = plural.exec(src))) { record(m[1], file); record(m[2], file); }
    });

    // data-i18n im Markup: der sichtbare Text ist selbst der Schlüssel
    const html = fs.readFileSync(dir + 'index.html', 'utf8');
    const tag = /<(\w+)[^>]*\sdata-i18n(?=[\s>])[^>]*>([^<]*)</g;
    let h;
    while ((h = tag.exec(html))) {
        const key = h[2].replace(/\s+/g, ' ').trim();
        if (key && I18n.DE[key] === undefined) missing.push(key + '  (index.html)');
    }

    assert.deepStrictEqual(missing, [], 'these keys fall back to English');
});

test('no dictionary entry is an accidental English passthrough', () => {
    /* Einzelne Wörter dürfen gleich sein — Name, Position, Park und Umbauplan
       heißen in beiden Sprachen so. Ein ganzer Satz, der sich nicht ändert,
       ist dagegen eine vergessene Übersetzung. */
    const same = Object.keys(I18n.DE)
        .filter((k) => I18n.DE[k] === k && k.indexOf(' ') > -1);
    assert.deepStrictEqual(same, [], 'these phrases translate to themselves');
});


test('no dictionary key is defined twice', () => {
    /* Zwei Einträge mit demselben Schlüssel: der zweite gewinnt stillschweigend.
       So wurde aus dem Knopf „Spiegeln“ einmal das Requisit „Spiegel“. */
    const src = require('fs').readFileSync(
        require('path').join(__dirname, '../tools/buehnenbild/i18n.js'), 'utf8');
    const table = src.slice(src.indexOf('var DE = {'), src.indexOf('var EXPLAIN_DE'));
    const keys = table.match(/^ {8}'(?:[^'\\]|\\.)*':/gm) || [];
    const seen = new Set();
    const twice = [];
    keys.forEach((k) => {
        if (seen.has(k)) twice.push(k.trim());
        seen.add(k);
    });
    assert.deepStrictEqual(twice, [], 'these keys are defined more than once');
    assert.ok(keys.length > 500, 'expected a full dictionary, found ' + keys.length);
});

test('every prop name resolves to a German word', () => {
    /* Geprüft wird, ob ein Eintrag im Wörterbuch steht — nicht, ob er anders
       aussieht als der englische Name. „Sofa" heißt in beiden Sprachen Sofa;
       das ist ein Eintrag und keine Lücke. Ganze Sätze, die sich nicht ändern,
       fängt die Prüfung darunter. */
    const missing = Props.LIBRARY.filter(
        (p) => /^[A-Za-z ,&.]+$/.test(p.name) && I18n.DE[p.name] === undefined);
    assert.deepStrictEqual(missing.map((p) => p.id), [], 'untranslated prop names');
    const cats = Props.CATEGORIES.filter((c) => I18n.t(c) === c);
    assert.deepStrictEqual(cats, [], 'untranslated categories');
});

test('every explainer has a title and a body', () => {
    const keys = Object.keys(I18n.EXPLAIN.de);
    assert.ok(keys.length > 40, 'expected an explainer on most settings');
    keys.forEach((key) => {
        const info = I18n.explain(key);
        assert.ok(info.title && info.title.length > 2, key + ' has no title');
        assert.ok(info.body && info.body.length > 30, key + ' has no real explanation');
    });
});

/* --------------------------------------------------------------- places */

test('the reference box lists the places a scene actually plays in', () => {
    const kitchen = SP.newPlace('Küche');
    kitchen.props = ['Tisch', '2 Stühle'];
    const unused = SP.newPlace('Dachboden');
    const production = {
        places: [kitchen, unused],
        scenes: [{ id: 's1', placeId: kitchen.id, placements: [] }]
    };
    const rows = SP.referenceRows(production);
    assert.strictEqual(rows.length, 1, 'a place nobody plays in and that holds nothing is left out');
    assert.strictEqual(rows[0].name, 'Küche');
    assert.deepStrictEqual(rows[0].items, ['Tisch', '2 Stühle']);

    unused.props = ['Kiste'];
    assert.strictEqual(SP.referenceRows(production).length, 2,
        'a place with a standing list is printed even when unused');
});

test('a place can read its standing list back from its own set', () => {
    const cafe = SP.newPlace('Café');
    cafe.placements = [placement('ill-chair', -1, 3), placement('ill-chair', 1, 3),
                       placement('dining-table', 0, 4)];
    const production = { places: [cafe], scenes: [] };
    const lines = SP.suggestPlaceProps(production, cafe.id, (id) => Props.get(id).name);
    assert.deepStrictEqual(lines, ['2 × School chair', 'Dining table']);
    assert.strictEqual(cafe.props.length, 0, 'nothing is written into the place behind the user’s back');
});

test('a place carries its set, and old presets fold into places', () => {
    const cafe = SP.newPlace('Café');
    const production = {
        places: [cafe],
        presets: [
            { id: 'p1', name: 'Café', placements: [placement('ill-mug', 0, 3)] },
            { id: 'p2', name: 'Markt', placements: [placement('ill-crate', 1, 2)] }
        ],
        scenes: []
    };
    SP.foldPresetsIntoPlaces(production);
    assert.strictEqual(production.presets.length, 0, 'presets are gone once folded in');
    assert.strictEqual(production.places.length, 2, 'a preset without a place becomes one');
    assert.strictEqual(cafe.placements.length, 1, 'a preset merges into the place of the same name');
    assert.strictEqual(production.places[1].name, 'Markt');
});

test('folding twice does not duplicate a place', () => {
    const production = { places: [], presets: [{ id: 'p1', name: 'Park', placements: [] }], scenes: [] };
    SP.foldPresetsIntoPlaces(production);
    SP.foldPresetsIntoPlaces(production);
    assert.strictEqual(production.places.length, 1);
});

test('the standing list is read from the set unless it is written by hand', () => {
    const nameOf = (id) => Props.get(id).name;
    const place = SP.newPlace('Café');
    place.placements = [placement('ill-mug', 0, 3), placement('ill-mug', 1, 3), placement('ill-pot', 2, 3)];
    assert.deepStrictEqual(SP.placeItems(place, nameOf), ['2 × Mug', 'Coffee pot']);
    place.props = ['Kaffeetasse mit einem Schluck Wasser'];
    assert.deepStrictEqual(SP.placeItems(place, nameOf), ['Kaffeetasse mit einem Schluck Wasser'],
        'a written list wins, because only it knows the detail');
});

test('a scene that drifts from its place is reported, never corrected', () => {
    const place = SP.newPlace('Café');
    place.placements = [placement('ill-mug', 0, 3), placement('ill-cafechair', 1, 3)];
    const scene = {
        id: 's1', placeId: place.id, curtains: {},
        placements: SP.copyPlacements(place.placements, true)
    };
    const production = { places: [place], scenes: [scene], presets: [] };
    assert.strictEqual(SP.placeDrift(production, scene).count, 0);

    scene.placements[0].x = 3;
    const drift = SP.placeDrift(production, scene);
    assert.strictEqual(drift.count, 1, 'the moved mug is the one difference');
    assert.strictEqual(place.placements[0].x, 0, 'the place is left exactly as it was');
    assert.deepStrictEqual(SP.scenesDriftingFrom(production, place.id).map((s) => s.id), ['s1']);
});

test('a place with no set has nothing to drift from', () => {
    const place = SP.newPlace('Park');
    const scene = { id: 's1', placeId: place.id, placements: [placement('ill-bench', 0, 3)], curtains: {} };
    const production = { places: [place], scenes: [scene], presets: [] };
    assert.strictEqual(SP.placeDrift(production, scene), null);
});

/* ---------------------------------------------------------- transitions */

test('a note follows its pair of scenes, not their position', () => {
    const a = { id: 'a', placements: [] };
    const b = { id: 'b', placements: [] };
    const production = { scenes: [a, b], transitions: {} };
    SP.ensureTransition(production, a, b).note = 'Glas bereitstellen';
    assert.strictEqual(SP.getTransition(production, a, b).note, 'Glas bereitstellen');
    assert.strictEqual(SP.getTransition(production, b, a), null);
});

test('reordering the running order drops a note that no longer applies', () => {
    const a = { id: 'a', placements: [] };
    const b = { id: 'b', placements: [] };
    const c = { id: 'c', placements: [] };
    const production = { scenes: [a, b, c], transitions: {} };
    SP.ensureTransition(production, a, b).note = 'gilt noch';
    SP.ensureTransition(production, b, c).note = 'fällt weg';
    production.scenes = [a, b];
    SP.pruneTransitions(production);
    assert.ok(SP.getTransition(production, a, b), 'the surviving pair keeps its note');
    assert.strictEqual(SP.getTransition(production, b, c), null, 'the broken pair is dropped');
});

test('an empty transition is not kept around', () => {
    const a = { id: 'a', placements: [] };
    const b = { id: 'b', placements: [] };
    const production = { scenes: [a, b], transitions: {} };
    SP.ensureTransition(production, a, b);
    SP.pruneTransitions(production);
    assert.strictEqual(Object.keys(production.transitions).length, 0);
});

/* ------------------------------------------------------------ Umbauplan */

function changeoverProduction() {
    const school = SP.newPlace('Schule');
    school.props = ['4 Stühle', 'Tafel'];
    const market = SP.newPlace('Markt');
    market.props = ['Händlerstand', 'Kiste'];

    const s1 = {
        id: 's1', title: 'Schule', placeId: school.id, actId: null, curtains: {},
        placements: [placement('ill-chair', -2, 3), placement('ill-chair', -1, 3),
                     placement('dining-table', 0, 4)]
    };
    const s2 = {
        id: 's2', title: 'Markt', placeId: market.id, actId: null, curtains: {},
        placements: [SP.copyPlacements([s1.placements[2]], true)[0], placement('ill-crate', -3, 2)]
    };
    s2.placements[0].x = 3;      // the table is carried across the stage
    return {
        id: 'p', name: 'Der Handel mit der Wahrheit', units: 'm', numbering: 'continuous',
        stage: Object.assign({}, SP.DEFAULT_STAGE), acts: [], places: [school, market],
        scenes: [s1, s2], transitions: {}
    };
}

test('the change-over rows open with the preset, then one row per change', () => {
    const production = changeoverProduction();
    const rows = SP.changeoverRows(production, { nameOf: (id) => Props.get(id).name });
    assert.strictEqual(rows.length, 2);
    assert.ok(rows[0].isPreset, 'the first row is what stands before the house opens');
    assert.deepStrictEqual(rows[0].strike, [], 'nothing is struck before the show');
    assert.deepStrictEqual(rows[0].setup, ['2 × School chair', 'Dining table']);
    assert.deepStrictEqual(rows[1].strike, ['2 × School chair']);
    assert.deepStrictEqual(rows[1].setup, ['Crate']);
    assert.strictEqual(rows[1].move.length, 1, 'the carried table is a move, not a strike and a set-up');
    assert.ok(rows[1].move[0].startsWith('Dining table →'), rows[1].move[0]);
});

test('a banner becomes a row of its own, before or after the change', () => {
    const production = changeoverProduction();
    const [s1, s2] = production.scenes;
    const trans = SP.ensureTransition(production, s1, s2);
    trans.banners.push({ text: 'PAUSE', sub: 'Vorhang zu.', where: 'before' });
    trans.banners.push({ text: 'VORHANG AUF', where: 'after' });
    const rows = SP.changeoverRows(production, { nameOf: (id) => Props.get(id).name });
    assert.deepStrictEqual(rows.map((r) => r.type), ['row', 'banner', 'row', 'banner']);
    assert.strictEqual(rows[1].text, 'PAUSE');
    assert.strictEqual(rows[1].sub, 'Vorhang zu.');
    assert.strictEqual(rows[3].text, 'VORHANG AUF');
});

test('a move names the grid square when the grid is lettered', () => {
    const production = changeoverProduction();
    production.stage.grid = { show: true, spacing: 1, labels: true };
    const rows = SP.changeoverRows(production, { nameOf: (id) => Props.get(id).name });
    assert.ok(/→ [A-Z]\d+$/.test(rows[1].move[0]), 'expected a grid reference, got ' + rows[1].move[0]);

    production.stage.grid.labels = false;
    const words = SP.changeoverRows(production, { nameOf: (id) => Props.get(id).name });
    assert.ok(/→ (vorne|hinten|nach) /.test(words[1].move[0]),
        'without letters it says where in words, got ' + words[1].move[0]);
});

test('positions can be spelled out in full on request', () => {
    const production = changeoverProduction();
    const plain = SP.changeoverRows(production, { nameOf: (id) => Props.get(id).name });
    const full = SP.changeoverRows(production,
        { nameOf: (id) => Props.get(id).name, positions: true });
    assert.ok(!plain[1].move[0].includes('('));
    assert.ok(/\(.*m .*\)/.test(full[1].move[0]), 'expected metres, got ' + full[1].move[0]);
});

test('the Umbauplan is set the way the reference document is', () => {
    const production = changeoverProduction();
    const pages = Sheets.buildChangeover({ production, resolve, options: {} });
    const first = pages[0];
    assert.strictEqual(pages.length, 1);
    assert.ok(first.includes('Umbauplan — Der Handel mit der Wahrheit'));
    assert.ok(first.includes('Zur Referenz'), 'the boxed reference block is there');
    assert.ok(first.includes('Schule') && first.includes('Händlerstand'));
    ['Übergang', 'Abbau', 'Aufbau', 'Umstellen'].forEach((head) => {
        assert.ok(first.includes(head), 'missing column ' + head);
    });
    assert.ok(first.includes('2 × Stuhl'), 'prop names are printed in German');
    assert.ok(!/School chair|Crate/.test(first), 'no English leaked onto the sheet');
    assert.ok(!/NaN|undefined/.test(first));
});

test('the reference box can be left off', () => {
    const production = changeoverProduction();
    const withBox = Sheets.buildChangeover({ production, resolve, options: {} })[0];
    const without = Sheets.buildChangeover({
        production, resolve, options: { referenceBox: false }
    })[0];
    assert.ok(withBox.includes('Zur Referenz'));
    assert.ok(!without.includes('Zur Referenz'));
});

test('a written note prints in italics under the derived list', () => {
    const production = changeoverProduction();
    const [s1, s2] = production.scenes;
    SP.ensureTransition(production, s1, s2).note = 'Tasse mit einem Schluck Wasser bereithalten';
    const page = Sheets.buildChangeover({ production, resolve, options: {} })[0];
    assert.ok(page.includes('sp-uv-note'));
    assert.ok(page.includes('Tasse mit einem Schluck Wasser bereithalten'));
});

test('a critical change is printed bold', () => {
    const production = changeoverProduction();
    const [s1, s2] = production.scenes;
    SP.ensureTransition(production, s1, s2).critical = true;
    const page = Sheets.buildChangeover({ production, resolve, options: {} })[0];
    assert.ok(page.includes('is-critical'));
});

test('the table breaks onto a second sheet when it runs long', () => {
    const production = changeoverProduction();
    const base = production.scenes[1];
    for (let i = 0; i < 30; i++) {
        production.scenes.push({
            id: 'x' + i, title: 'Szene ' + i, actId: null, curtains: {},
            placements: SP.copyPlacements(base.placements, i % 2 === 0)
        });
    }
    const pages = Sheets.buildChangeover({ production, resolve, options: {} });
    assert.ok(pages.length > 1, 'a long evening needs more than one sheet');
    pages.forEach((page, i) => {
        assert.ok(page.includes('Übergang'), 'sheet ' + (i + 1) + ' repeats the column heads');
    });
    assert.ok(pages[0].includes('Zur Referenz'), 'the reference box is only on the first sheet');
    assert.ok(!pages[1].includes('Zur Referenz'));
});

test('a long changeover note is never printed off the sheet', () => {
    /* Die Notizhöhe wurde mit ceil(länge/60) geschätzt, die Spalte bricht
       aber bei etwa dreißig Zeichen um. Bei rund 1000 Zeichen endete die
       Tabelle 105 px hinter der Papierkante: ein Balken und ein ganzer Umbau
       standen außerhalb des Blattes und fehlten im Ausdruck. */
    const withNote = (chars) => Sheets.rowHeight({
        type: 'row', strike: [], setup: ['Sofa'], move: [], note: 'x'.repeat(chars)
    });
    assert.ok(withNote(690) > withNote(0) * 6, 'a long note is still estimated as short');
    assert.ok(withNote(1030) > withNote(690), 'a longer note is not taller');
    /* Zwei Zeilen Text sind zwei Zeilen hoch, auch wenn sie kurz sind. */
    const twoLines = Sheets.rowHeight({
        type: 'row', strike: [], setup: ['Sofa'], move: [], note: 'kurz\nkurz'
    });
    const oneLine = Sheets.rowHeight({
        type: 'row', strike: [], setup: ['Sofa'], move: [], note: 'kurz'
    });
    assert.ok(twoLines > oneLine, 'a line break is not counted');

    /* Und der Umbruch muss die Blattgrenze halten. */
    const production = changeoverProduction();
    production.scenes.forEach((sc, i) => {
        if (i) SP.ensureTransition(production, production.scenes[i - 1], sc).note = 'y'.repeat(900);
    });
    const sheets = Sheets.buildChangeover({
        production: production,
        resolve: (id) => Props.get(id),
        nameOf: (id) => (Props.get(id) || { name: id }).name
    });
    const printed = [].concat(sheets).join('');
    /* Jede Szene, die im Plan steht, steht auch auf einem Blatt. */
    const numbers = SP.sceneNumbers(production);
    production.scenes.slice(1).forEach((sc) => {
        assert.ok(printed.indexOf(numbers[sc.id].label) !== -1,
            'changeover into ' + numbers[sc.id].label + ' never reached the paper');
    });
});

test('a banner keeps the row under it on the same sheet', () => {
    const rows = [];
    for (let i = 0; i < 40; i++) {
        rows.push({ type: 'row', strike: ['a'], setup: ['b'], move: [], note: '' });
    }
    rows.splice(20, 0, { type: 'banner', text: 'PAUSE', sub: '' });
    const pages = Sheets.paginateChangeover(rows, 0);
    pages.forEach((page) => {
        const last = page[page.length - 1];
        assert.ok(!(last && last.type === 'banner'),
            'a banner was left stranded at the foot of a sheet');
    });
});

test('an empty row still gets a line, so the crew can tick it off', () => {
    const a = { id: 'a', title: 'A', placements: [], curtains: {} };
    const b = { id: 'b', title: 'B', placements: [], curtains: {} };
    const production = {
        name: 'Leer', units: 'm', stage: Object.assign({}, SP.DEFAULT_STAGE),
        acts: [], places: [], scenes: [a, b], transitions: {}
    };
    const rows = SP.changeoverRows(production, { nameOf: (id) => id });
    assert.strictEqual(rows.length, 2);
    assert.ok(SP.changeoverIsEmpty(rows[1]));
    const page = Sheets.buildChangeover({ production, resolve, options: {} })[0];
    assert.ok(page.includes('—'), 'an empty cell prints an em dash');
});

test('scenes can be numbered I.I, I.II inside an act', () => {
    const production = {
        numbering: 'per-act-roman',
        acts: [{ id: 'a1' }, { id: 'a2' }],
        scenes: [{ id: 's1', actId: 'a1' }, { id: 's2', actId: 'a1' }, { id: 's3', actId: 'a2' }]
    };
    const numbers = SP.sceneNumbers(production);
    assert.strictEqual(numbers.s1.label, 'I.I');
    assert.strictEqual(numbers.s2.label, 'I.II');
    assert.strictEqual(numbers.s3.label, 'II.I');
});


/* ------------------------------------------------------------ edge cases */

test('an empty production still prints without falling over', () => {
    const production = {
        name: '', units: 'm', stage: Object.assign({}, SP.DEFAULT_STAGE),
        acts: [], places: [], scenes: [], transitions: {}
    };
    assert.ok(Array.isArray(Sheets.buildPlans({ production, resolve, options: {} })));
    assert.ok(Array.isArray(Sheets.buildChangeover({ production, resolve, options: {} })));
});

test('a prop id that no longer exists does not print as undefined', () => {
    /* Passiert nach jedem Aufräumen im Fundus: gespeicherte Pläne zeigen auf
       Requisiten, die es nicht mehr gibt. */
    const scene = {
        id: 's', title: 'x', curtains: {},
        placements: [{ id: 'p', trackId: 't', propId: 'weg', x: 0, y: 0, rot: 0, w: 1, h: 1 }]
    };
    const production = {
        name: 'x', units: 'm', stage: Object.assign({}, SP.DEFAULT_STAGE),
        acts: [], places: [], scenes: [scene], transitions: {}
    };
    const out = Sheets.buildPlans({ production, resolve, options: {} }).join('') +
        Sheets.buildChangeover({ production, resolve, options: {} }).join('');
    assert.ok(!/undefined|NaN/.test(out), 'a missing prop leaked undefined onto the sheet');
});

test('extreme stage measurements still give a usable outline', () => {
    [{ width: 0.1, depth: 0.1 }, { width: 1000, depth: 1000 }, { width: 0, depth: 0 }]
        .forEach((dim) => {
            const out = SP.stageOutline(Object.assign({}, SP.DEFAULT_STAGE, dim));
            assert.ok(isFinite(out.bounds.w) && isFinite(out.bounds.h), JSON.stringify(dim));
            assert.ok(out.bounds.w > 0 && out.bounds.h > 0, 'zero area at ' + JSON.stringify(dim));
        });
});

test('wings wider than the stage are clamped, not drawn off it', () => {
    const stage = Object.assign({}, SP.DEFAULT_STAGE,
        { width: 0.5, depth: 0.5, wings: { show: true, inset: 99, depth: 99 } });
    const lines = SP.wingLines(stage);
    assert.strictEqual(lines.length, 2);
    lines.forEach((line) => line.forEach((pt) => {
        assert.ok(isFinite(pt[0]) && isFinite(pt[1]), 'NaN in a wing line');
    }));
});

/* Gassen sind die seitliche Abdeckung einer Guckkastenbühne. Sie setzen
   voraus, dass es überhaupt eine verdeckte Seite gibt und dass die Seitenkante
   gerade verläuft. Bei Arena und Traverse sitzt dort Publikum, bei den runden
   Formen ist die Kante gebogen. Erwartet wird deshalb: nur Rechteck, Trapez
   und Vorbühne bieten Gassen an, und ein Formwechsel blendet sie aus, ohne
   die eingestellten Maße wegzuwerfen. */

test('only the three shapes with a straight side edge have wings', () => {
    const withWings = SP.STAGE_SHAPES
        .filter((shape) => SP.hasWings({ shape: shape.id }))
        .map((shape) => shape.id);
    assert.deepStrictEqual(withWings, ['rect', 'trapezoid', 'thrust']);
});

test('a shape without wings draws none, however they are set', () => {
    const wings = { show: true, inset: 1.2, depth: 4 };
    /* Nur die drei Formen mit gerader Seitenkante haben Gassen. Eine
       Gassenlinie an einer runden Vorderkante gäbe es im Haus nicht. */
    ['traverse', 'halfround'].forEach((shape) => {
        const stage = Object.assign({}, SP.DEFAULT_STAGE, { shape: shape, wings: wings });
        assert.strictEqual(SP.wingLines(stage).length, 0, shape + ' still drew wings');
        assert.strictEqual(SP.inWing(stage, 999, 0), false, shape + ' still has a wing to stand in');
    });
});

test('switching the shape away and back keeps the wing measurements', () => {
    const stage = Object.assign({}, SP.DEFAULT_STAGE,
        { shape: 'rect', width: 12, depth: 9, wings: { show: true, inset: 1.2, depth: 4 } });
    const before = SP.wingLines(stage);
    assert.strictEqual(before.length, 2);

    stage.shape = 'traverse';
    assert.strictEqual(SP.wingLines(stage).length, 0, 'the traverse drew wings');
    assert.strictEqual(stage.wings.show, true, 'the tick was thrown away');
    assert.strictEqual(stage.wings.inset, 1.2, 'the inset was thrown away');
    assert.strictEqual(stage.wings.depth, 4, 'the depth was thrown away');

    stage.shape = 'rect';
    assert.deepStrictEqual(SP.wingLines(stage), before, 'the wings came back different');
});

test('a grid reference stays well formed anywhere, even off the stage', () => {
    const stage = Object.assign({}, SP.DEFAULT_STAGE);
    const out = SP.stageOutline(stage);
    [[out.bounds.x, out.bounds.y], [out.bounds.x + out.bounds.w, out.frontY], [-9999, -9999]]
        .forEach((pt) => {
            const ref = SP.gridReference(stage, pt[0], pt[1], 1);
            assert.ok(/^[A-Z]+\d+$/.test(ref), 'malformed reference ' + ref + ' at ' + pt);
        });
});

test('a long evening paginates and repeats the column heads', () => {
    const scenes = [];
    for (let i = 0; i < 200; i++) {
        scenes.push({
            id: 's' + i, title: 'S' + i, curtains: {},
            placements: [placement('ill-chair', i % 5, 3)]
        });
    }
    const production = {
        name: 'lang', units: 'm', stage: Object.assign({}, SP.DEFAULT_STAGE),
        acts: [], places: [], scenes, transitions: {}
    };
    const pages = Sheets.buildChangeover({ production, resolve, options: {} });
    assert.ok(pages.length > 5, 'expected many sheets, got ' + pages.length);
    pages.forEach((page, i) => {
        assert.ok(page.includes('Übergang'), 'sheet ' + (i + 1) + ' lost its column heads');
    });
});



test('crowded labels step out of each other’s way', () => {
    /* Vier Tassen auf einem Tisch druckten ihre Namen übereinander — auf dem
       Blatt ein schwarzer Klumpen statt einer Liste. Jetzt rutschen sie
       untereinander. Geprüft wird, was am Ende im SVG steht. */
    const stage = Object.assign({}, SP.DEFAULT_STAGE, { shape: 'rect', width: 10, depth: 8 });
    const mug = Props.get('ill-mug');
    const scene = {
        placements: [
            SP.makePlacement(mug, 0, 4),
            SP.makePlacement(mug, 0.1, 4.05),
            SP.makePlacement(mug, -0.1, 4.02),
            SP.makePlacement(mug, 0.05, 3.98)
        ]
    };
    const svg = Plan.svg({ stage, scene, resolve, units: 'm', labels: 'name' });
    const ys = [...svg.matchAll(/<text class="sp-item-label"[^>]*\by="(-?[\d.]+)"/g)]
        .map((m) => Number(m[1])).sort((a, b) => a - b);

    assert.strictEqual(ys.length, 4, 'alle vier bekommen eine Beschriftung');
    for (let i = 1; i < ys.length; i++) {
        assert.ok(ys[i] - ys[i - 1] > 0.01,
            `Zeile ${i} liegt auf der vorigen (${ys[i - 1]} / ${ys[i]})`);
    }
});


test('a name never lands on somebody else’s prop', () => {
    /* Vorher wich eine Beschriftung nur anderen Beschriftungen aus, und immer
       nach unten. Stand dort ein zweites Requisit, wurde der Name quer über
       dessen Zeichnung geschrieben — und dessen eigener Name so weit
       geschoben, dass er bei einem dritten stand. */
    const sofa = Props.get('sofa'), bench = Props.get('ill-bench'), bin = Props.get('ill-bin');
    const stack = [
        Object.assign(SP.makePlacement(sofa, 0, 2.0), { label: 'Sofa' }),
        Object.assign(SP.makePlacement(bench, 0, 2.9), { label: 'Bank' }),
        Object.assign(SP.makePlacement(bin, 0, 3.6), { label: 'Eimer' })
    ];
    const plan = Plan.build({
        stage: Object.assign({}, SP.DEFAULT_STAGE),
        scene: { placements: stack, curtains: {} },
        resolve: (id) => Props.get(id),
        labels: 'custom'
    });
    const spots = [];
    const re = /<text class="sp-item-label" x="(-?[\d.]+)" y="(-?[\d.]+)"/g;
    let m;
    while ((m = re.exec(plan.inner))) spots.push({ x: +m[1], y: +m[2] });
    assert.strictEqual(spots.length, 3, 'not every name reached the plan');

    /* Kein Name steht innerhalb der Standfläche eines Requisits. */
    spots.forEach((spot) => {
        stack.forEach((pl) => {
            const inside = Math.abs(spot.x - pl.x) < pl.w / 2 &&
                Math.abs(spot.y - pl.y) < pl.h / 2;
            assert.ok(!inside, 'a name sits on top of ' + pl.propId);
        });
    });
    /* Und zwei Namen liegen nicht aufeinander. */
    spots.forEach((a, i) => spots.slice(i + 1).forEach((b) => {
        assert.ok(Math.abs(a.x - b.x) > 0.05 || Math.abs(a.y - b.y) > 0.05,
            'two names share a spot');
    }));

    /* Der schwere Fall: fünf Kleinigkeiten dicht auf einem Tisch. Sind alle
       Ausweichplätze rundherum besetzt, fiel vorher alles auf denselben Fleck
       zurück — drei Namen übereinander und einer davon zweimal. */
    const crowd = ['ill-pot', 'ill-mug', 'ill-mug', 'ill-menu', 'glass-wine']
        .map((id, i) => Object.assign(
            SP.makePlacement(Props.get(id), -0.3 + i * 0.15, 2.4 + (i % 2) * 0.12),
            { label: 'Nr ' + i }));
    crowd.unshift(Object.assign(SP.makePlacement(Props.get('dining-table'), 0, 2.5),
        { label: 'Esstisch' }));
    const dense = Plan.build({
        stage: Object.assign({}, SP.DEFAULT_STAGE),
        scene: { placements: crowd, curtains: {} },
        resolve: (id) => Props.get(id),
        labels: 'custom'
    }).inner;
    const many = [];
    const re2 = /<text class="sp-item-label" x="(-?[\d.]+)" y="(-?[\d.]+)"/g;
    let d;
    while ((d = re2.exec(dense))) many.push({ x: +d[1], y: +d[2] });
    assert.strictEqual(many.length, crowd.length, 'not every name reached the crowded plan');
    many.forEach((a, i) => many.slice(i + 1).forEach((b) => {
        assert.ok(Math.abs(a.x - b.x) > 0.05 || Math.abs(a.y - b.y) > 0.05,
            'two names share a spot when it gets crowded');
    }));
});

test('wing notes stop at the edge of the wing and say so', () => {
    /* Der Stapel zählte einfach weiter: der vierte Zettel lag auf der
       Bauflucht, der fünfte unterhalb des Blattes — und sheets.js reichte
       dieselbe Liste an den Drucker weiter. Jetzt endet er an der Gassentiefe
       und sagt, wie viele nicht mehr hineinpassten. */
    const notes = [1, 2, 3, 4, 5, 6].map((i) => ({ side: 'left', text: 'Zettel ' + i, propId: 'ill-mug' }));
    const drawnIn = (depth) => {
        const stage = Object.assign({}, SP.DEFAULT_STAGE, {
            shape: 'rect', width: 12, depth: 9, wings: { show: true, inset: 1.2, depth: depth }
        });
        const out = Plan.build({
            stage: stage,
            scene: { placements: [], curtains: {}, wingNotes: notes },
            resolve: (id) => Props.get(id),
            wingNotes: notes
        }).inner;
        return { count: (out.match(/sp-wing-note"/g) || []).length, told: /kein Platz mehr/.test(out) };
    };
    const flat = drawnIn(2.5), normal = drawnIn(5), deep = drawnIn(7);
    assert.ok(flat.count >= 1, 'even a shallow wing holds one');
    assert.ok(normal.count > flat.count, 'a deeper wing holds no more');
    assert.ok(deep.count > normal.count, 'a still deeper wing holds no more');
    assert.ok(deep.count < notes.length, 'six notes cannot all fit');
    [flat, normal, deep].forEach((r) => assert.ok(r.told, 'the ones that did not fit are passed over in silence'));
});

test('the marker to add a wing note sits where the notes appear', () => {
    /* Es saß am Rampenende, der Stapel beginnt aber hinten — Knopf und
       Ergebnis lagen an entgegengesetzten Enden derselben Gasse. */
    const stage = Object.assign({}, SP.DEFAULT_STAGE, {
        shape: 'rect', width: 12, depth: 9, wings: { show: true, inset: 1.2, depth: 5 }
    });
    const note = [{ side: 'left', text: 'Tasse', propId: 'ill-mug' }];
    const out = Plan.build({
        stage: stage,
        scene: { placements: [], curtains: {}, wingNotes: note },
        resolve: (id) => Props.get(id),
        wingNotes: note,
        interactive: true
    }).inner;
    const mark = /<g class="sp-wing-add"[\s\S]*?cy="(-?[\d.]+)"/.exec(out);
    const first = /<g class="sp-wing-note" transform="translate\(-?[\d.]+ (-?[\d.]+)\)"/.exec(out);
    assert.ok(mark && first, 'no marker or no note drawn');
    const gap = Math.abs(Number(first[1]) - Number(mark[1]));
    assert.ok(gap < 1.5, 'marker and first note are ' + gap.toFixed(2) + ' m apart');
    /* Der Zettel im Bild ist keine Aufstellung auf der Bühne. */
    assert.ok(out.indexOf('data-id=""') === -1 && out.indexOf('data-id="undefined"') === -1,
        'a wing note pretends to be a placement');
});

test('every explainer has a route into the programme', () => {
    /* Eine Suche, die einen zum falschen Reiter schickt, ist schlimmer als
       gar keine. Ein neuer Schlüssel ohne Wegbeschreibung fällt hier auf. */
    const keys = Object.keys(I18n.EXPLAIN.de);
    assert.deepStrictEqual(Guide.audit(keys), [], 'diese Schlüssel führen ins Nichts');
    Guide.buildIndex(keys, I18n.explain).forEach((entry) => {
        assert.ok(entry.open && entry.open.length > 3,
            entry.key + ' sagt nicht, wo die Einstellung wohnt');
    });
});

test('the manual is found however you spell the umlaut', () => {
    /* bühne / buehne / buhne müssen dasselbe finden — sonst tippt man im
       Deutschen dauernd an der Suche vorbei. */
    const index = Guide.buildIndex(Object.keys(I18n.EXPLAIN.de), I18n.explain);
    const titles = (q) => Guide.search(index, q, 5).map((e) => e.key).join();
    assert.ok(titles('bühne').length > 0, 'mit Umlaut wird etwas gefunden');
    assert.strictEqual(titles('buehne'), titles('bühne'));
    assert.strictEqual(titles('buhne'), titles('bühne'));
    assert.strictEqual(Guide.fold('Maßstab'), Guide.fold('massstab'));
});

test('search narrows with each further word', () => {
    /* Zwei Wörter dürfen die Liste nicht verlängern. Genau das passiert,
       wenn man die Treffer vereinigt statt schneidet. */
    const index = Guide.buildIndex(Object.keys(I18n.EXPLAIN.de), I18n.explain);
    const one = Guide.search(index, 'raster', 50).length;
    const two = Guide.search(index, 'raster drucken', 50).length;
    assert.ok(one > 0, 'ein Wort findet etwas');
    assert.ok(two <= one, `zwei Wörter fanden mehr (${one} -> ${two})`);
    assert.deepStrictEqual(Guide.search(index, '   ', 5), [], 'leere Anfrage findet nichts');
});

test('an exact title wins over a mere mention', () => {
    const index = Guide.buildIndex(Object.keys(I18n.EXPLAIN.de), I18n.explain);
    const first = Guide.search(index, 'Gassen', 5)[0];
    assert.strictEqual(first.key, 'stage.wings');
});


test('every explainer is attached to a control', () => {
    /* Erklärtexte, die niemand erreicht, sind teurer als keine: sie sehen
       im Wörterbuch nach Dokumentation aus und stehen im Programm nirgends.
       Vier lagen so herum — Tiefe, Vorbühne, Vorhangabstand und
       Wiederherstellen. Wer eine neue Erklärung schreibt, muss sie auch
       aufhängen, sonst fällt das hier auf. */
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '../tools/buehnenbild/');
    const src = fs.readFileSync(dir + 'app.js', 'utf8') +
        fs.readFileSync(dir + 'index.html', 'utf8');
    const loose = Object.keys(I18n.EXPLAIN.de).filter(
        (key) => src.indexOf("'" + key + "'") === -1 && src.indexOf('"' + key + '"') === -1);
    assert.deepStrictEqual(loose, [], 'diese Erklärungen hängen an nichts');
});


/* ------------------------------------------------------- Bauvorschriften
 *
 * Ein Requisit mit Bauvorschrift wird bei jeder Größe neu gerechnet, in
 * Bühnenmetern. Was hier geprüft wird, ist genau das: dass die Zeichnung
 * das Maß einhält, das danebensteht, und dass mitwächst, was mitwachsen
 * soll — die Zahl der Sprossen, nicht die Sprosse.
 */

/* Das äußerste Rechteck einer Zeichnung. Es ist bei allen Möbelvorschriften
   der Umriss, also muss es die Standfläche sein. */
function outerRect(markup) {
    const m = /<rect[^>]*\bx="(-?[\d.]+)"\s+y="(-?[\d.]+)"\s+width="([\d.]+)"\s+height="([\d.]+)"/.exec(markup);
    if (!m) return null;
    return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
}

function allRects(markup) {
    const out = [];
    const re = /<rect[^>]*\bx="(-?[\d.]+)"\s+y="(-?[\d.]+)"\s+width="([\d.]+)"\s+height="([\d.]+)"/g;
    let m;
    while ((m = re.exec(markup))) out.push({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] });
    return out;
}

const FOOTPRINT = ['sofa', 'armchair', 'table', 'bed'];

test('a recipe draws its own footprint, whatever the proportions are', () => {
    [[2.4, 0.8], [0.6, 1.9], [1, 1], [0.09, 0.09]].forEach(([w, h]) => {
        FOOTPRINT.forEach((name) => {
            const box = outerRect(Shapes.draw({ shape: name }, w, h, null, 0.01));
            assert.ok(box, name + ' draws no outline');
            assert.strictEqual(SP.round(box.w, 3), SP.round(w, 3), name + ' is not ' + w + ' across');
            assert.strictEqual(SP.round(box.h, 3), SP.round(h, 3), name + ' is not ' + h + ' deep');
            assert.strictEqual(SP.round(box.x, 3), SP.round(-w / 2, 3), name + ' is off centre');
        });
    });
});

test('a bench is built the way the one on the borrowed plan is', () => {
    /* Eine Bank hat im Grundriss keinen Umriss — sie ist ihre Latten. Die
       Lehne steht dahinter und ragt an beiden Enden heraus, die Beine schauen
       vorne durch. So ist sie auf der übernommenen Zeichnung, und so soll sie
       bei jeder Länge bleiben. */
    [[1.93, 0.64], [3.2, 0.4], [0.8, 0.9]].forEach(([w, h]) => {
        const out = Shapes.draw({ shape: 'bench' }, w, h, null, 0.01);
        const splay = Math.min(0.12, w / 4);
        const boards = allRects(out);
        assert.strictEqual(boards.length, 2, 'a bench is two boards at ' + w + '×' + h);
        boards.forEach((r) => assert.strictEqual(SP.round(r.w, 3), SP.round(w - 2 * splay, 3),
            'a board is not the width of the seat'));
        /* Die Lehne trägt die ganze Länge und sitzt auf der Hinterkante. */
        assert.ok(out.indexOf('M' + SP.round(-w / 2, 3) + ' ' + SP.round(-h / 2, 3) +
            'H' + SP.round(w / 2, 3)) !== -1, 'the backrest does not span the bench');
        /* Vorne enden die Beine genau auf der Kante, nicht davor. */
        const foot = Math.min(0.05, h * 0.09);
        assert.ok(out.indexOf(' ' + SP.round(h / 2 - foot, 3) + 'v' + SP.round(foot, 3)) !== -1,
            'the legs do not reach the front edge');
    });
});

test('a recipe writes markup a strict parser would take', () => {
    /* Ein Browser verzeiht ein doppeltes Anführungszeichen und zeichnet
       trotzdem — ein Wandler nach PDF tut das nicht. Genau so ein Zeichen
       stand in jedem Rechteck ohne Rundung, also in fast jedem Möbelstück. */
    Object.keys(Shapes.SHAPES).forEach((name) => {
        const out = Shapes.draw({ shape: name }, 1.4, 0.8, null, 0.01, { text: 'Probe' });
        assert.ok(out.indexOf('""') === -1, name + ' writes a doubled quotation mark');
        assert.ok(!/=\s/.test(out), name + ' writes an attribute without a value');
        const quotes = (out.match(/"/g) || []).length;
        assert.strictEqual(quotes % 2, 0, name + ' leaves a quotation mark open');
    });
    Props.LIBRARY.forEach((prop) => {
        const out = Shapes.draw(prop, prop.w, prop.h, null, 0.01, { text: 'Probe' });
        assert.ok(out.indexOf('""') === -1, prop.id + ' writes a doubled quotation mark');
    });
});

test('every recipe survives sizes nobody would choose', () => {
    Object.keys(Shapes.SHAPES).forEach((name) => {
        [[0.02, 0.02], [40, 0.05], [0.05, 40], [12, 9]].forEach(([w, h]) => {
            const out = Shapes.draw({ shape: name }, w, h, null, 0.01, { text: 'Kaffeetasse\nmit Wasser' });
            assert.ok(out.length > 8, name + ' draws nothing at ' + w + '×' + h);
            assert.ok(!/NaN|undefined|Infinity/.test(out), name + ' has a hole at ' + w + '×' + h);
        });
    });
});

test('every value a recipe offers has a German word', () => {
    /* Die Beschriftungen der Bauvorschriften stehen englisch im Quelltext,
       weil sie dort neben der Rechnung stehen, die sie steuern. Übersetzt
       werden sie erst beim Bauen des Bedienelements — und shapes.js steht
       nicht in der Dateiliste des Wörterbuch-Tests. Genau dort ist schon eine
       Umbenennung durchgerutscht: im Wörterbuch stand der neue Name, im
       Quelltext noch der alte, und auf dem Schirm stand Englisch. */
    const missing = [];
    Object.keys(Shapes.SHAPES).forEach((name) => {
        Shapes.SHAPES[name].params.forEach((p) => {
            if (I18n.DE[p.label] === undefined) missing.push(name + '.' + p.key + ': ' + p.label);
        });
    });
    assert.deepStrictEqual(missing, [], 'diese Werte stehen auf dem Schirm englisch da');
});

test('every value a recipe offers can be built into a control', () => {
    Object.keys(Shapes.SHAPES).forEach((name) => {
        Shapes.SHAPES[name].params.forEach((p) => {
            assert.ok(p.key && p.label, name + ' has a value without a name');
            if (p.type === 'toggle') {
                assert.strictEqual(typeof p.def, 'boolean', name + '.' + p.key + ' is no switch');
                return;
            }
            ['min', 'max', 'step', 'def'].forEach((field) => {
                assert.strictEqual(typeof p[field], 'number', name + '.' + p.key + ' has no ' + field);
            });
            assert.ok(p.min < p.max, name + '.' + p.key + ' has an empty range');
            assert.ok(p.def >= p.min && p.def <= p.max, name + '.' + p.key + ' starts outside its range');
            assert.ok(p.step <= p.max - p.min, name + '.' + p.key + ' steps past its own range');
        });
    });
});

test('a value that depends on a switch only shows while the switch is on', () => {
    const cloth = Shapes.SHAPES.table.params.filter((p) => p.key === 'check')[0];
    assert.ok(!Shapes.applies(cloth, { cloth: false }));
    assert.ok(Shapes.applies(cloth, { cloth: true }));

    /* Fransen gibt es nur am eckigen Teppich — am ovalen wäre das Feld da
       und ohne Wirkung, und das ist schlimmer als ein fehlendes Feld. */
    const fringe = Shapes.SHAPES.rug.params.filter((p) => p.key === 'fringe')[0];
    assert.ok(Shapes.applies(fringe, { oval: false }));
    assert.ok(!Shapes.applies(fringe, { oval: true }));

    const live = Shapes.live({ shape: 'rug' }, { oval: true }).map((p) => p.key);
    assert.deepStrictEqual(live, ['oval', 'border']);

    /* Ein Bedienelement ohne Wirkung ist schlimmer als keines: man stellt
       daran herum und sucht dann den Fehler bei sich. Unter einer Tischdecke
       sieht man keine Beine, und ein Tisch auf einem Mittelfuß hat keine. */
    /* Der Schalter steht zuoberst und bleibt dort. Stand er in der Mitte,
       rutschte er beim Umlegen eine Zeile nach oben, weil der Wert darüber
       verschwand — und man traf beim zweiten Klick das Falsche. */
    assert.deepStrictEqual(Shapes.live({ shape: 'table' }, { cloth: true }).map((p) => p.key),
        ['cloth', 'check', 'leg', 'round']);
    assert.deepStrictEqual(Shapes.live({ shape: 'table' }, { cloth: false }).map((p) => p.key),
        ['cloth', 'leg', 'round']);
    assert.strictEqual(Shapes.live({ shape: 'table' }, { cloth: true })[0].key, 'cloth');
    assert.strictEqual(Shapes.live({ shape: 'table' }, { cloth: false })[0].key, 'cloth');
    assert.deepStrictEqual(Shapes.live({ shape: 'table-round' }, { pedestal: true }).map((p) => p.key),
        ['pedestal']);
});

test('the check on a tablecloth lies across the corner, clear of the legs', () => {
    /* Gerade Linien sähen aus wie eine Fuge, nicht wie Stoff, und auf einer
       langen Tafel wurde aus dem Quadrat ein liegendes Rechteck. Über Eck
       liegt es also — aber nicht auf 45 Grad: dort laufen die vier Beinmarken,
       und je eine Karolinie verschluckte je ein Bein. */
    const side = 0.3;
    [[0.9, 0.9], [1.6, 0.9], [2.4, 0.8], [3.0, 1.2]].forEach(([w, h]) => {
        const out = Shapes.draw({ shape: 'table' }, w, h, { cloth: true, check: side }, 0.01);
        const segs = [];
        const re = /M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)/g;
        let m;
        while ((m = re.exec(out))) segs.push([+m[1], +m[2], +m[3], +m[4]]);
        assert.ok(segs.length >= 6, w + '×' + h + ' has no check at all');

        /* Ganz kurze Züge in einer Ecke tragen ihren Winkel nur auf ein
           halbes Grad genau — sie werden nach Länge aussortiert, nicht nach
           Winkel, sonst zählte das Runden als dritte Richtung. */
        const long = segs.filter((g) => Math.hypot(g[2] - g[0], g[3] - g[1]) > 0.05);
        const angles = long.map((g) => {
            const deg = Math.atan2(g[3] - g[1], g[2] - g[0]) * 180 / Math.PI;
            return ((deg % 180) + 180) % 180;
        });
        /* Zwei Richtungen, senkrecht zueinander, und keine davon auf 45 oder
           135 Grad, wo die Beinmarken liegen. */
        const families = [];
        angles.forEach((a) => {
            if (!families.some((f) => Math.abs(f - a) < 2)) families.push(a);
        });
        assert.strictEqual(families.length, 2,
            w + '×' + h + ' draws the check in ' + families.length + ' directions: ' + families);
        assert.ok(Math.abs(Math.abs(families[0] - families[1]) - 90) < 0.2,
            w + '×' + h + ' the two families are not square to each other');
        families.forEach((a) => {
            assert.ok(Math.abs(a - 45) > 5 && Math.abs(a - 135) > 5,
                w + '×' + h + ' a check line runs along the leg marks at ' + a + '°');
            assert.ok(a > 2 && Math.abs(a - 90) > 2 && a < 178,
                w + '×' + h + ' the check is square to the table at ' + a + '°, that reads as a grid');
        });

        /* Der Abstand steht in Metern, senkrecht zur Linie gemessen, und ist
           in beiden Richtungen gleich. */
        families.forEach((a) => {
            const rad = a * Math.PI / 180;
            const nx = -Math.sin(rad), ny = Math.cos(rad);
            const offsets = long
                .filter((g, i) => Math.abs(angles[i] - a) < 2)
                .map((g) => g[0] * nx + g[1] * ny)
                .sort((p, q) => p - q);
            for (let i = 1; i < offsets.length; i++) {
                assert.ok(Math.abs((offsets[i] - offsets[i - 1]) - side) < 0.02,
                    w + '×' + h + ' spaces the check at ' +
                    (offsets[i] - offsets[i - 1]).toFixed(3) + ' m');
            }
        });
    });
});

test('a table keeps its feet, cloth or no cloth', () => {
    /* Unter der Decke fielen die Beinmarken weg — ein Tisch, der auf nichts
       steht. */
    const legs = (cloth) => (Shapes.draw({ shape: 'table' }, 1.6, 0.9, { cloth: cloth }, 0.01)
        .match(/l-?[\d.]+ -?[\d.]+/g) || []).length;
    assert.strictEqual(legs(false), 4);
    assert.strictEqual(legs(true), 4);
});

test('a pedestal foot stays round under an oval top', () => {
    /* Als Anteil beider Halbachsen gerechnet wurde der Mittelfuß mit der
       Platte mitgequetscht: aus dem runden Fuß wurde eine Ellipse. */
    const out = Shapes.draw({ shape: 'table-round' }, 1.6, 0.8, { pedestal: true }, 0.01);
    const feet = [];
    const re = /<ellipse[^>]*rx="([\d.]+)" ry="([\d.]+)"/g;
    let m;
    while ((m = re.exec(out))) feet.push([+m[1], +m[2]]);
    assert.strictEqual(feet.length, 2, 'top and foot');
    assert.strictEqual(feet[1][0], feet[1][1], 'the foot is an ellipse: ' + feet[1].join(' × '));
});

test('what a prop lets you do on the stage is written down, once', () => {
    /* Die Griffe auf der Bühne sind eine Bequemlichkeit, kein Zaun: was hier
       gebunden ist, steht im Auswahl-Bereich weiter frei. Geprüft wird nur,
       dass jeder Eintrag eine gültige Regel hat und die Vorgabe stimmt. */
    Props.LIBRARY.forEach((prop) => {
        const grip = Plan.gripOf(prop);
        assert.ok(Plan.GRIPS.indexOf(grip) !== -1, prop.id + ' has an unknown grip: ' + grip);
        if (!prop.grip) {
            const derived = Shapes.naturalDepth(prop, 1, null) !== null;
            assert.strictEqual(grip, derived ? 'derived' : (Shapes.has(prop) ? 'free' : 'ratio'),
                prop.id + ' falls back to the wrong grip');
        }
    });
    /* Was der Auftraggeber ausdrücklich benannt hat. */
    assert.strictEqual(Plan.gripOf(Props.get('ill-bench')), 'width', 'the bench must only pull long');
    assert.strictEqual(Plan.gripOf(Props.get('bed')), 'width', 'the bed must only pull wide');
    assert.strictEqual(Plan.gripOf(Props.get('mark-spike')), 'square', 'a spike mark is square');
    ['ill-mug', 'ill-pot', 'ill-menu', 'ill-bottle', 'ill-book', 'clock'].forEach((id) => {
        assert.strictEqual(Plan.gripOf(Props.get(id)), 'none', id + ' comes in one size');
    });
    /* Ein gerechnetes Möbelstück bleibt frei — dort steckt die Form in der
       Vorschrift und nicht im Seitenverhältnis. */
    assert.strictEqual(Plan.gripOf(Props.get('sofa')), 'free');
    assert.strictEqual(Plan.gripOf(Props.get('dining-table')), 'free');

    /* Die Tiefe einer Tür ist der Schwenkbereich des Flügels. Sie wird nicht
       eingestellt, sondern folgt aus der Breite und der Zargenbreite —
       gezogen wurde die Tür sonst zu einem langen hohen Ding mit einer Tür
       ganz unten drin. */
    assert.strictEqual(Plan.gripOf(Props.get('door-frame')), 'derived');
    const door = Props.get('door-frame');
    assert.strictEqual(Shapes.naturalDepth(door, door.w, null), SP.round(door.h, 3),
        'the catalogue depth is not the leaf');
    assert.strictEqual(Shapes.naturalDepth(door, 1.6, null), 1.36);
    assert.strictEqual(Shapes.naturalDepth(door, 1.6, { jamb: 0.2 }), 1.2);
    assert.strictEqual(Shapes.naturalDepth(Props.get('sofa'), 2, null), null,
        'a sofa has no derived depth');
});

test('the catalogue holds each thing once', () => {
    /* Zwei Sofas waren dasselbe Sofa, zwei Betten dasselbe Bett, und „Tisch
       von oben" war der Esstisch noch einmal als Zeichnung. Wer dieselbe
       Vorschrift zweimal in den Fundus legt, hat zwei Einträge, die
       auseinanderlaufen, sobald einer gepflegt wird. */
    const byRecipe = {};
    Props.LIBRARY.forEach((prop) => {
        if (!prop.shape) return;
        const key = prop.shape + ':' + JSON.stringify(prop.params || {});
        (byRecipe[key] = byRecipe[key] || []).push(prop.id);
    });
    Object.keys(byRecipe).forEach((key) => {
        assert.strictEqual(byRecipe[key].length, 1,
            'the same recipe twice: ' + byRecipe[key].join(', '));
    });
    ['sofa-short', 'sofa-long', 'bed-single', 'bed-double', 'ill-table', 'ill-tablecloth', 'ill-sponge']
        .forEach((id) => assert.strictEqual(Props.get(id), null, id + ' is still in the catalogue'));
});

test('the ladder grows rungs, not longer rungs', () => {
    const rungs = (h) => (Shapes.draw({ shape: 'ladder' }, 0.42, h, { pitch: 0.28 }, 0.01)
        .match(/M-?[\d.]+ -?[\d.]+H/g) || []).length;
    assert.strictEqual(rungs(1.4), 4);
    assert.strictEqual(rungs(2.8), 9);
    /* Bei doppelter Länge doppelt so viele Zwischenräume — das ist der ganze
       Punkt des Umbaus. */
    assert.strictEqual(rungs(2.8) + 1, (rungs(1.4) + 1) * 2);
});

test('the folding screen takes another fold when it gets longer', () => {
    const folds = (w) => (Shapes.draw({ shape: 'screen' }, w, 0.45, { panel: 0.5 }, 0.01)
        .match(/L/g) || []).length;
    assert.strictEqual(folds(1.0), 2);
    assert.strictEqual(folds(3.0), 6);
});

test('a bed wide enough gets a second pillow', () => {
    const pillows = (w) => (Shapes.draw({ shape: 'bed' }, w, 2.0, { twin: 1.3, fold: false }, 0.01)
        .match(/<rect/g) || []).length - 1;
    assert.strictEqual(pillows(1.0), 1);
    assert.strictEqual(pillows(1.3), 2);
    assert.strictEqual(pillows(1.8), 2);
});

test('a rug keeps its stated depth, fringe and all', () => {
    const fringe = 0.07;
    const body = outerRect(Shapes.draw({ shape: 'rug' }, 2, 3, { fringe: fringe, border: false }, 0.01));
    assert.strictEqual(SP.round(body.h + 2 * fringe, 3), 3);
    assert.strictEqual(SP.round(body.w, 3), 2);
    /* Die Fransen selbst hängen an einem Abstand in Metern, also werden es
       am breiteren Teppich mehr und nicht längere. */
    const threads = (w) => (Shapes.draw({ shape: 'rug' }, w, 3, { fringe: fringe, pitch: 0.09 }, 0.01)
        .match(/v0\.07/g) || []).length;
    assert.ok(threads(4) > threads(2));
});

test('the table keeps its leg mark when the top is pulled long', () => {
    /* Der Fehler, den die Bauvorschriften abstellen: eine Zeichnung, die auf
       2,40 × 0,80 gezogen wird, bekommt in der einen Richtung dreimal so
       lange Beine wie in der anderen. */
    const legs = (w, h) => Shapes.draw({ shape: 'table' }, w, h, { leg: 0.14, round: 0 }, 0.01)
        .match(/l(-?[\d.]+) (-?[\d.]+)/)[0];
    assert.strictEqual(legs(2.4, 0.8), legs(0.9, 0.9));
});

test('the door swings from the side it is hinged on', () => {
    const left = Shapes.draw({ shape: 'door' }, 1.1, 0.86, { angle: 90, right: false, jamb: 0.12 }, 0.01);
    const right = Shapes.draw({ shape: 'door' }, 1.1, 0.86, { angle: 90, right: true, jamb: 0.12 }, 0.01);
    assert.ok(left.indexOf('M-0.43 0.43') !== -1, 'the left leaf is not on its hinge');
    assert.ok(right.indexOf('M0.43 0.43') !== -1, 'the right leaf is not on its hinge');
    /* Bei 0° liegt der Flügel zu und es gibt keinen Bogen zu zeigen. */
    assert.ok(Shapes.draw({ shape: 'door' }, 1.1, 0.86, { angle: 0 }, 0.01).indexOf('sp-swing') === -1);
    assert.ok(left.indexOf('sp-swing') !== -1);
});

test('the arrow head follows the arrow, not the zoom', () => {
    /* Vorher hing der Kopf an der Haarlinie: derselbe Pfeil bekam beim
       Hineinzoomen und auf dem Papier verschieden große Köpfe, und die Höhe
       des Pfeils tat überhaupt nichts. */
    const head = (w, h, u) => {
        const m = /M(-?[\d.]+) (-?[\d.]+)L/.exec(Shapes.draw({ mark: 'arrow' }, w, h, null, u));
        return { back: Number(m[1]), half: Math.abs(Number(m[2])) };
    };
    assert.deepStrictEqual(head(1, 0.4, 0.01), head(1, 0.4, 0.004), 'the head still follows the zoom');
    assert.strictEqual(head(1, 0.4, 0.01).half, 0.2, 'the height is not the width of the head');
    assert.ok(head(1, 0.6, 0.01).half > head(1, 0.4, 0.01).half, 'a taller arrow gets no bigger head');
    /* Ein langer Pfeil wird länger und nicht dicker. */
    assert.strictEqual(head(3, 0.4, 0.01).half, head(1, 0.4, 0.01).half);
});

test('a text field sets one line per line and shrinks to fit', () => {
    const one = Shapes.draw({ mark: 'label' }, 0.9, 0.3, null, 0.005, { text: 'Vorhang' });
    const three = Shapes.draw({ mark: 'label' }, 0.9, 0.3, null, 0.005, { text: 'Vorhang\nauf\njetzt' });
    assert.strictEqual((one.match(/<text/g) || []).length, 1);
    assert.strictEqual((three.match(/<text/g) || []).length, 3);
    const size = (out) => Number(/font-size="([\d.]+)"/.exec(out)[1]);
    assert.ok(size(three) < size(one), 'three lines are set no smaller than one');

    /* Ein leeres Feld druckt leer. Der blasse Hinweis steht nur da, wo man
       ihn anfassen kann, und ist nie Inhalt. */
    assert.strictEqual((Shapes.draw({ mark: 'label' }, 0.9, 0.3, null, 0.005, { text: '  ' })
        .match(/<text/g) || []).length, 0);
    assert.ok(Shapes.draw({ mark: 'label' }, 0.9, 0.3, null, 0.005, { hint: 'Textfeld' })
        .indexOf('sp-mark-hint') !== -1);

    /* Der Rand ist abschaltbar, der Text bleibt. */
    const bare = Shapes.draw({ mark: 'label' }, 0.9, 0.3, { border: false }, 0.005, { text: 'Vorhang' });
    assert.strictEqual((bare.match(/<rect/g) || []).length, 0);
    assert.strictEqual((bare.match(/<text/g) || []).length, 1);
});

test('a label never sets its letters larger than it was told to', () => {
    const out = Shapes.draw({ mark: 'label' }, 4, 2, { cap: 0.2 }, 0.005, { text: 'Ab' });
    assert.ok(Number(/font-size="([\d.]+)"/.exec(out)[1]) <= 0.2);
});

test('a multi-line label reads as one line in a list', () => {
    assert.strictEqual(SP.oneLine('Kaffeetasse\nmit Wasser'), 'Kaffeetasse · mit Wasser');
    assert.strictEqual(SP.oneLine('  einzeilig '), 'einzeilig');
    assert.strictEqual(SP.oneLine(null), '');
});

test('the quick redraw draws exactly what the full one does', () => {
    /* Beim Ziehen an einer Ecke wird nur das eine Requisit neu gesetzt, nicht
       der ganze Plan. Liefen die beiden Wege auseinander, sähe das Requisit
       während des Ziehens anders aus als danach — und genau das war der Fall:
       das schnelle Nachziehen stellte nur die Streckung einer Zeichnung nach
       und ließ alles Gerechnete stehen, bis man losließ. */
    ['ill-bench', 'dining-table', 'ladder', 'ill-typewriter', 'mark-label'].forEach((id) => {
        const prop = Props.get(id);
        const pl = Object.assign(SP.makePlacement(prop, 0, 3), { w: prop.w * 1.4, h: prop.h * 0.8 });
        const built = Plan.build({
            stage: Object.assign({}, SP.DEFAULT_STAGE),
            scene: { placements: [pl], curtains: {} },
            resolve: () => prop,
            interactive: true
        });
        const inner = Plan.propInner(pl, prop, built.unit, { interactive: true });
        const whole = built.inner;
        assert.ok(inner.length > 10, id + ' redraws to nothing');
        assert.ok(whole.indexOf(inner) !== -1, id + ' redraws differently than it is drawn');
        assert.ok(!/NaN|undefined/.test(inner), id + ' has a hole in the quick redraw');
    });
});

test('every prop that names a recipe has one, and asks for nothing else', () => {
    Props.LIBRARY.forEach((prop) => {
        if (!prop.shape && !prop.mark) return;
        assert.ok(Shapes.has(prop), prop.id + ' names a recipe that does not exist');
        /* fit heißt „behalte dein Seitenverhältnis" und gilt für gezeichnete
           Vorlagen. Eine Bauvorschrift rechnet in Metern und braucht es
           nicht; beides zusammen widerspräche sich. */
        assert.ok(!prop.fit, prop.id + ' has both a recipe and a fixed ratio');
    });
});

test('the props that were drawn off their stated size are rebuilt', () => {
    /* Fünfzehn Requisiten zeichneten mehr als 10 % neben ihrem Maß. Die hier
       sind auf eine Bauvorschrift umgestellt und rechnen seitdem in Metern,
       also stimmt das Maß von selbst. */
    ['ladder', 'bed', 'door-frame', 'armchair'].forEach((id) => {
        assert.ok(Shapes.has(Props.get(id)), id + ' still hangs on a stretched drawing');
    });
    /* Der Rest behält sein Seitenverhältnis, statt auf die Standfläche gezogen
       zu werden. Ein Kreis wird sonst zur Ellipse, sobald jemand am Rand zieht
       — bei der Uhr war er 2,7-mal so breit wie hoch. */
    ['suitcase', 'rock', 'speaker', 'music-stand', 'clock'].forEach((id) => {
        assert.ok(Props.get(id).box, id + ' has no measured drawing');
    });
    /* fit war die alte Auskunft „behalte dein Verhältnis". Sie ist überflüssig
       geworden: jede Zeichnung behält es, und wie weit sie in ihrem eigenen
       Feld reicht, steht jetzt als box da. */
    Props.LIBRARY.forEach((prop) => {
        assert.ok(!prop.fit, prop.id + ' still carries the old fit');
        if (prop.art && !Shapes.has(prop)) {
            assert.ok(prop.box && prop.box.length === 4, prop.id + ' has no measured drawing');
            const seen = Shapes.extent(prop, prop.w, prop.h);
            assert.ok(Math.abs(seen.w - prop.w) < 0.02 && Math.abs(seen.h - prop.h) < 0.02,
                prop.id + ' does not fill what it says it measures');
        }
    });
    /* Die Holme der Leiter sind zwei Striche auf der angeschriebenen Breite,
       und zwischen ihnen liegen die Sprossen — nicht auf Kopf und Fuß. Als
       gezeichnete Kästen wurden im Kleinen vier Linien daraus. */
    const ladder = Props.get('ladder');
    const drawn = Shapes.draw(ladder, ladder.w, ladder.h, null, 0.01);
    const hw = SP.round(ladder.w / 2, 3), hh = SP.round(ladder.h / 2, 3);
    assert.ok(drawn.indexOf('M' + -hw + ' ' + -hh + 'V' + hh) !== -1, 'the left stile is off the edge');
    assert.ok(drawn.indexOf('M' + hw + ' ' + -hh + 'V' + hh) !== -1, 'the right stile is off the edge');
    assert.strictEqual(allRects(drawn).length, 0, 'the stiles are drawn as boxes again');
    assert.ok(drawn.indexOf(' ' + -hh + 'H') === -1, 'there is a rung sitting on the head');
});

console.log('\n' + passed + ' checks passed');

