/*
 * Scene & prop planner — geometry, change lists and printed pagination.
 * Pure Node, no browser: the modules under test never touch the DOM.
 */
const assert = require('assert');
const SP = require('../tools/scene-planner/core.js');
const Props = require('../tools/scene-planner/props.js');
const Plan = require('../tools/scene-planner/plan.js');
const Sheets = require('../tools/scene-planner/sheets.js');
const I18n = require('../tools/scene-planner/i18n.js');
const Draw = require('../tools/scene-planner/draw.js');

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

test('a circular stage is widest across its middle', () => {
    const stage = { shape: 'circle', diameter: 10 };
    assert.deepStrictEqual(SP.spanAt(stage, 5), [-5, 5]);
    assert.strictEqual(SP.spanAt(stage, -1), null);
    const near = SP.spanAt(stage, 1);
    assert.strictEqual(SP.round(near[1], 2), 3);
});

test('points off the floor are recognised as off the floor', () => {
    const stage = { shape: 'circle', diameter: 10 };
    assert.strictEqual(SP.containsPoint(stage, 0, 5), true);
    assert.strictEqual(SP.containsPoint(stage, 4.9, 0.2), false);
});

test('a polygon stage keeps the requested number of sides', () => {
    const stage = { shape: 'polygon', diameter: 10, sides: 5 };
    const out = SP.stageOutline(stage);
    assert.strictEqual(out.polygon.length, 5);
    assert.strictEqual((out.d.match(/L/g) || []).length, 4);
});

/* ---------------------------------------------------------------- units */

test('lengths read the way a crew writes them', () => {
    assert.strictEqual(SP.formatLength(2.4, 'm'), '2,4 m');
    assert.strictEqual(SP.formatLength(12.5, 'm'), '12,5 m');
    assert.strictEqual(SP.formatLength(3.81, 'ft'), '12′–6″');
    assert.strictEqual(SP.formatLength(0.9144, 'ft'), '3′');
});

test('feet convert back to the same metres', () => {
    const there = SP.toUnit(4.5, 'ft');
    assert.strictEqual(SP.round(SP.toMetres(there, 'ft'), 6), 4.5);
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
    const a = { placements: [placement('ill-table', 0, 3, { trackId: 't1' })] };
    const b = { placements: [placement('ill-table', 2.5, 5, { trackId: 't1' })] };
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
    const a = { placements: [placement('bed-double', 0, 3), placement('suitcase', 0, 4)] };
    const b = { placements: [placement('bed-double', 0, 3), placement('rock', -2, 1)] };
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
    const list = [placement('ill-chair', 0, 0), placement('ill-chair', 1, 0), placement('ill-table', 2, 0)];
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
            scene('s1', 'a1', [placement('ill-table', 0, 5), placement('ill-chair', 1, 5)]),
            scene('s2', 'a1', [placement('ill-table', 0, 5)]),
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
        assert.ok(!/NaN|undefined/.test(prop.art), prop.id + ' has NaN in its drawing');
        assert.ok(/^</.test(prop.art), prop.id + ' does not start with an element');
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
    const drawn = {
        id: 'drawn-1', name: 'Gezeichnete Kiste', cat: 'Objects', w: 0.8, h: 0.5,
        art: Draw.markup([{ k: 'rect', x: 10, y: 10, w: 80, h: 80, r: 4, m: 'f' }])
    };
    assert.ok(!drawn.fit, 'a drawn prop must stretch onto its footprint');
    const plan = Plan.build({
        stage: Object.assign({}, SP.DEFAULT_STAGE),
        scene: { placements: [SP.makePlacement(drawn, 0, 4)], curtains: {} },
        resolve: () => drawn
    });
    assert.ok(plan.inner.includes(drawn.art), 'the drawing did not reach the plan');
    assert.ok(!/NaN|undefined/.test(plan.inner));
    const fit = Plan.artTransform(drawn, drawn.w, drawn.h, false);
    assert.strictEqual(SP.round(fit.sx * 100, 3), 0.8, 'the 100 box did not stretch to the footprint');
    assert.strictEqual(SP.round(fit.sy * 100, 3), 0.5);
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
    const sheets = Sheets.buildPlans({ production, resolve, options: { inventory: true } });
    const all = sheets.join('');
    assert.ok(sheets.length >= 8, 'expected a full set, got ' + sheets.length);
    assert.ok(all.includes('Test piece'));
    assert.ok(all.includes('Act one'));
    assert.ok(all.includes('Requisitenliste'));
    assert.ok(all.includes('Seite 1 von ' + sheets.length));
    assert.ok(!all.includes('%%PAGE%%'), 'page numbers were left unfilled');
    assert.ok(!/NaN|undefined/.test(all), 'a sheet has NaN on it');
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
    const dir = path.join(__dirname, '../tools/scene-planner/');
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
        require('path').join(__dirname, '../tools/scene-planner/i18n.js'), 'utf8');
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
    const missing = Props.LIBRARY.filter((p) => I18n.t(p.name) === p.name && /^[A-Za-z ,&.]+$/.test(p.name));
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
                       placement('ill-table', 0, 4)];
    const production = { places: [cafe], scenes: [] };
    const lines = SP.suggestPlaceProps(production, cafe.id, (id) => Props.get(id).name);
    assert.deepStrictEqual(lines, ['2 × School chair', 'Table from above']);
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
                     placement('ill-table', 0, 4)]
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
    assert.deepStrictEqual(rows[0].setup, ['2 × School chair', 'Table from above']);
    assert.deepStrictEqual(rows[1].strike, ['2 × School chair']);
    assert.deepStrictEqual(rows[1].setup, ['Crate']);
    assert.strictEqual(rows[1].move.length, 1, 'the carried table is a move, not a strike and a set-up');
    assert.ok(rows[1].move[0].startsWith('Table from above →'), rows[1].move[0]);
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


console.log('\n' + passed + ' checks passed');
