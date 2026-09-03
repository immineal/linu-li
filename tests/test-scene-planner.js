/*
 * Scene & prop planner — geometry, change lists and printed pagination.
 * Pure Node, no browser: the modules under test never touch the DOM.
 */
const assert = require('assert');
const SP = require('../tools/scene-planner/core.js');
const Props = require('../tools/scene-planner/props.js');
const Plan = require('../tools/scene-planner/plan.js');
const Sheets = require('../tools/scene-planner/sheets.js');

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
    assert.strictEqual(SP.formatLength(2.4, 'm'), '2.4 m');
    assert.strictEqual(SP.formatLength(12.5, 'm'), '12.5 m');
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
    assert.strictEqual(SP.describePosition(stage, 2, 6, 'm'), '2 m stage left, 3 m upstage');
    assert.strictEqual(SP.describePosition(stage, -2, 9, 'm'), '2 m stage right, on the setting line');
    assert.strictEqual(SP.describePosition(stage, 0, 4.5, 'm'), 'on the centre line, 4.5 m upstage');
});

/* -------------------------------------------------------- change lists */

test('a prop that stays put is not reported as a change', () => {
    const a = { placements: [placement('chair', 1, 2, { trackId: 't1' })] };
    const b = { placements: [placement('chair', 1, 2, { trackId: 't1' })] };
    const diff = SP.diffScenes(a, b);
    assert.strictEqual(SP.changeCount(diff), 0);
    assert.strictEqual(diff.unchanged.length, 1);
});

test('a tracked prop that shifts is a move, not a strike and a re-set', () => {
    const a = { placements: [placement('table-round', 0, 3, { trackId: 't1' })] };
    const b = { placements: [placement('table-round', 2.5, 5, { trackId: 't1' })] };
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
        placement('chair', -3, 2, { label: "Anna's" }),
        placement('chair', 3, 2, { label: "Peter's" })
    ] };
    const b = { placements: [
        placement('chair', 3.1, 2, { label: "Anna's" }),
        placement('chair', -3, 2, { label: "Peter's" })
    ] };
    const diff = SP.diffScenes(a, b);
    assert.strictEqual(diff.added.length, 0);
    assert.strictEqual(diff.removed.length, 0);
    assert.strictEqual(diff.moved.length, 2);
});

test('what is genuinely new comes on, what is gone is struck', () => {
    const a = { placements: [placement('sofa-3', 0, 3), placement('rug', 0, 4)] };
    const b = { placements: [placement('sofa-3', 0, 3), placement('tree', -2, 1)] };
    const diff = SP.diffScenes(a, b);
    assert.strictEqual(diff.added.length, 1);
    assert.strictEqual(diff.added[0].propId, 'tree');
    assert.strictEqual(diff.removed.length, 1);
    assert.strictEqual(diff.removed[0].propId, 'rug');
});

test('the first scene has nothing to compare against', () => {
    const diff = SP.diffScenes(null, { placements: [placement('chair', 0, 0)] });
    assert.strictEqual(diff.isFirst, true);
    assert.strictEqual(diff.added.length, 1);
});

test('identical props are grouped for the change list', () => {
    const list = [placement('chair', 0, 0), placement('chair', 1, 0), placement('table-round', 2, 0)];
    const groups = SP.groupByProp(list, (id) => Props.get(id).name);
    assert.strictEqual(groups.length, 2);
    assert.strictEqual(groups[0].count, 2);
    assert.strictEqual(groups[0].name, 'Chair');
});

/* ------------------------------------------------------------ mirroring */

test('mirroring flips positions and rotations across the centre line', () => {
    const stage = { shape: 'rect', width: 12, depth: 9 };
    const mirrored = SP.mirrorPlacements([placement('chair', 2.5, 4, { rot: 30 })], 'horizontal', stage);
    assert.strictEqual(mirrored[0].x, -2.5);
    assert.strictEqual(mirrored[0].y, 4);
    assert.strictEqual(mirrored[0].rot, -30);
    assert.strictEqual(mirrored[0].flip, true);
});

test('mirroring twice returns the layout to where it started', () => {
    const stage = { shape: 'rect', width: 12, depth: 9 };
    const original = [placement('desk', 1.5, 3, { rot: 20 })];
    const back = SP.mirrorPlacements(SP.mirrorPlacements(original, 'horizontal', stage), 'horizontal', stage);
    assert.strictEqual(back[0].x, original[0].x);
    assert.strictEqual(back[0].rot, original[0].rot);
    assert.strictEqual(back[0].flip, original[0].flip);
});

test('copying a layout can keep or break the link to the original props', () => {
    const source = [placement('chair', 0, 0, { trackId: 'keep-me' })];
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
            scene('s1', 'a1', [placement('table-round', 0, 5), placement('chair', 1, 5)]),
            scene('s2', 'a1', [placement('table-round', 0, 5)]),
            scene('s3', 'a2', [placement('tree', -2, 2)]),
            scene('s4', 'a2', [placement('tree', -2, 2), placement('bench', 1, 4)])
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
    production.scenes[0].placements.push(placement('chair', -1, 5));
    const inventory = SP.propInventory(production);
    const chairs = inventory.filter((entry) => entry.propId === 'chair')[0];
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
    assert.ok(open.inner.includes('House curtain, open'));
    assert.ok(open.inner.includes('sp-curtain-track'), 'an open curtain shows its track');
});

/* --------------------------------------------------------------- sheets */

test('the printed set covers cover, acts, scenes, overview and run sheet', () => {
    const production = sampleProduction('per-act');
    const sheets = Sheets.build({ production, resolve, options: { inventory: true } });
    const all = sheets.join('');
    assert.ok(sheets.length >= 9, 'expected a full set, got ' + sheets.length);
    assert.ok(all.includes('Test piece'));
    assert.ok(all.includes('Act one'));
    assert.ok(all.includes('Change-over list'));
    assert.ok(all.includes('Prop inventory'));
    assert.ok(all.includes('Page 1 of ' + sheets.length));
    assert.ok(!all.includes('%%PAGE%%'), 'page numbers were left unfilled');
    assert.ok(!/NaN|undefined/.test(all), 'a sheet has NaN on it');
});

test('turning sheets off leaves only what was asked for', () => {
    const production = sampleProduction();
    const sheets = Sheets.build({
        production, resolve,
        options: {
            cover: false, actPages: false, overview: false, runSheet: false,
            inventory: false, scenePages: true
        }
    });
    assert.strictEqual(sheets.length, production.scenes.length);
});

test('a landscape sheet is laid out on its side', () => {
    const production = sampleProduction();
    const sheets = Sheets.build({ production, resolve, options: { orientation: 'landscape' } });
    assert.ok(sheets[0].includes('is-landscape'));
});

test('a scene sheet spells out what the crew has to do', () => {
    const production = sampleProduction();
    const sheets = Sheets.build({
        production, resolve,
        options: { cover: false, actPages: false, overview: false, runSheet: false }
    });
    const second = sheets[1];
    assert.ok(second.includes('Strike'));
    assert.ok(second.includes('Chair'), 'the struck chair should be named');
});

test('printing one act only leaves the rest at home', () => {
    const production = sampleProduction();
    const sheets = Sheets.build({
        production, resolve,
        options: { scope: 'a2', cover: false, actPages: false, overview: false, runSheet: false }
    });
    assert.strictEqual(sheets.length, 2);
});

console.log('\n' + passed + ' checks passed');
