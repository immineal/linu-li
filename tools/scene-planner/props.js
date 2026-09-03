/*
 * Scene & Prop Planner — the built-in prop drawings.
 *
 * Every symbol is drawn as a plan view (looking straight down at the stage)
 * inside a 100 × 100 box, in the same weight and idiom as a hand-drawn
 * ground plan: outlines only, a light tint for anything solid, dashes for
 * things that swing or are not really there.
 *
 * w and h are the real footprint in metres — w across the stage, h upstage
 * to downstage — so a chair drops onto the plan at the size of a chair.
 */
(function (root, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory();
    } else {
        root.SPProps = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* A closed blob with soft bumps — used for planting and rockwork, where
       a perfect circle would read as furniture. Deterministic, so the same
       tree looks the same on screen and on paper. */
    function blob(cx, cy, radius, bumps, wobble, seed) {
        var pts = [];
        var s = seed || 1;
        for (var i = 0; i < bumps; i++) {
            s = (s * 9301 + 49297) % 233280;
            var jitter = 1 + ((s / 233280) - 0.5) * wobble;
            var a = (2 * Math.PI * i / bumps) - Math.PI / 2;
            pts.push([
                Math.round((cx + Math.cos(a) * radius * jitter) * 10) / 10,
                Math.round((cy + Math.sin(a) * radius * jitter) * 10) / 10
            ]);
        }
        var d = 'M' + pts[0][0] + ' ' + pts[0][1];
        for (var k = 0; k < pts.length; k++) {
            var cur = pts[k];
            var next = pts[(k + 1) % pts.length];
            var mx = (cur[0] + next[0]) / 2;
            var my = (cur[1] + next[1]) / 2;
            d += ' Q' + cur[0] + ' ' + cur[1] + ' ' + Math.round(mx * 10) / 10 + ' ' + Math.round(my * 10) / 10;
        }
        return d + ' Z';
    }

    function angular(cx, cy, radius, corners, wobble, seed) {
        var s = seed || 7;
        var pts = [];
        for (var i = 0; i < corners; i++) {
            s = (s * 9301 + 49297) % 233280;
            var jitter = 1 + ((s / 233280) - 0.5) * wobble;
            var a = (2 * Math.PI * i / corners) - Math.PI / 2;
            pts.push(
                Math.round((cx + Math.cos(a) * radius * jitter) * 10) / 10 + ' ' +
                Math.round((cy + Math.sin(a) * radius * jitter) * 10) / 10
            );
        }
        return 'M' + pts.join(' L') + ' Z';
    }

    function radial(cx, cy, inner, outer, spokes, offset) {
        var d = '';
        for (var i = 0; i < spokes; i++) {
            var a = (2 * Math.PI * i / spokes) + (offset || 0);
            d += ' M' + Math.round((cx + Math.cos(a) * inner) * 10) / 10 + ' ' +
                 Math.round((cy + Math.sin(a) * inner) * 10) / 10 +
                 ' L' + Math.round((cx + Math.cos(a) * outer) * 10) / 10 + ' ' +
                 Math.round((cy + Math.sin(a) * outer) * 10) / 10;
        }
        return d.trim();
    }

    var CATEGORIES = [
        'Seating', 'Tables & desks', 'Storage', 'Beds & soft furnishing',
        'Structure', 'Planting & landscape', 'Light & sound', 'Objects', 'Marks & notes'
    ];

    var LIBRARY = [
        /* ---------------------------------------------------------- Seating */
        { id: 'chair', name: 'Chair', cat: 'Seating', w: 0.5, h: 0.5, tags: 'dining kitchen seat',
          art: '<rect class="f" x="28" y="34" width="44" height="42" rx="4"/><path d="M24 30 H76"/>' },
        { id: 'armchair', name: 'Armchair', cat: 'Seating', w: 0.9, h: 0.85, tags: 'easy chair seat lounge',
          art: '<rect class="f" x="16" y="24" width="68" height="56" rx="10"/><rect x="28" y="38" width="44" height="42" rx="5"/>' },
        { id: 'stool', name: 'Stool', cat: 'Seating', w: 0.4, h: 0.4, tags: 'bar seat perch',
          art: '<circle class="f" cx="50" cy="50" r="26"/><circle cx="50" cy="50" r="9"/>' },
        { id: 'bench', name: 'Bench', cat: 'Seating', w: 1.6, h: 0.45, tags: 'pew seat park',
          art: '<rect class="f" x="8" y="34" width="84" height="32" rx="3"/><path d="M8 45 H92 M8 55 H92"/>' },
        { id: 'sofa-2', name: 'Sofa, two seats', cat: 'Seating', w: 1.6, h: 0.9, tags: 'couch settee',
          art: '<rect class="f" x="10" y="26" width="80" height="50" rx="8"/><path d="M10 38 H90 M50 38 V76"/>' },
        { id: 'sofa-3', name: 'Sofa, three seats', cat: 'Seating', w: 2.1, h: 0.9, tags: 'couch settee',
          art: '<rect class="f" x="6" y="26" width="88" height="50" rx="8"/><path d="M6 38 H94 M35 38 V76 M65 38 V76"/>' },
        { id: 'throne', name: 'Throne', cat: 'Seating', w: 0.8, h: 0.8, tags: 'chair royal king queen',
          art: '<rect class="f" x="28" y="36" width="44" height="42" rx="3"/><path d="M22 32 H78"/><path d="M50 32 V16"/><circle cx="50" cy="12" r="7"/>' },

        /* --------------------------------------------------- Tables & desks */
        { id: 'table-round', name: 'Round table', cat: 'Tables & desks', w: 1.2, h: 1.2, tags: 'dining cafe',
          art: '<circle class="f" cx="50" cy="50" r="42"/>' },
        { id: 'table-oval', name: 'Oval table', cat: 'Tables & desks', w: 1.8, h: 1.0, tags: 'dining banquet',
          art: '<ellipse class="f" cx="50" cy="50" rx="46" ry="30"/>' },
        { id: 'table-rect', name: 'Rectangular table', cat: 'Tables & desks', w: 1.6, h: 0.9, tags: 'dining trestle',
          art: '<rect class="f" x="6" y="24" width="88" height="52" rx="3"/>' },
        { id: 'table-square', name: 'Square table', cat: 'Tables & desks', w: 1.0, h: 1.0, tags: 'card cafe',
          art: '<rect class="f" x="14" y="14" width="72" height="72" rx="3"/>' },
        { id: 'side-table', name: 'Side table', cat: 'Tables & desks', w: 0.5, h: 0.5, tags: 'occasional small nest',
          art: '<circle class="f" cx="50" cy="50" r="30"/><circle cx="50" cy="50" r="11"/>' },
        { id: 'desk', name: 'Desk', cat: 'Tables & desks', w: 1.4, h: 0.7, tags: 'writing bureau office',
          art: '<rect class="f" x="6" y="26" width="88" height="48" rx="3"/><rect x="62" y="34" width="26" height="32" rx="2"/>' },
        { id: 'bar-counter', name: 'Bar counter', cat: 'Tables & desks', w: 2.4, h: 0.6, tags: 'pub inn serving',
          art: '<rect class="f" x="4" y="34" width="92" height="32" rx="16"/><path d="M14 50 H86"/>' },

        /* --------------------------------------------------------- Storage */
        { id: 'cabinet', name: 'Cabinet', cat: 'Storage', w: 1.2, h: 0.5, tags: 'sideboard dresser cupboard',
          art: '<rect class="f" x="8" y="34" width="84" height="32" rx="2"/><path d="M50 34 V66"/><path d="M30 50 h4 M66 50 h4"/>' },
        { id: 'bookshelf', name: 'Bookshelf', cat: 'Storage', w: 1.6, h: 0.35, tags: 'shelves library books',
          art: '<rect class="f" x="4" y="38" width="92" height="24" rx="2"/><path d="M27 38 V62 M50 38 V62 M73 38 V62"/>' },
        { id: 'wardrobe', name: 'Wardrobe', cat: 'Storage', w: 1.2, h: 0.6, tags: 'closet armoire',
          art: '<rect class="f" x="16" y="30" width="68" height="30" rx="2"/><path class="d" d="M16 60 A68 68 0 0 0 84 60"/>' },
        { id: 'chest', name: 'Chest, trunk', cat: 'Storage', w: 1.0, h: 0.55, tags: 'travelling case box',
          art: '<rect class="f" x="14" y="32" width="72" height="38" rx="4"/><path d="M14 51 H86"/><rect x="43" y="45" width="14" height="12" rx="2"/>' },
        { id: 'crate', name: 'Crate', cat: 'Storage', w: 0.6, h: 0.6, tags: 'box packing case',
          art: '<rect class="f" x="18" y="18" width="64" height="64" rx="2"/><path d="M18 18 L82 82 M82 18 L18 82"/>' },
        { id: 'barrel', name: 'Barrel', cat: 'Storage', w: 0.6, h: 0.6, tags: 'cask keg tavern',
          art: '<circle class="f" cx="50" cy="50" r="34"/><circle cx="50" cy="50" r="22"/><circle cx="50" cy="50" r="10"/>' },
        { id: 'basket', name: 'Basket', cat: 'Storage', w: 0.5, h: 0.5, tags: 'wicker laundry',
          art: '<circle class="f" cx="50" cy="50" r="32"/><path d="M26 33 H74 M20 50 H80 M26 67 H74"/>' },
        { id: 'costume-rail', name: 'Costume rail', cat: 'Storage', w: 1.5, h: 0.6, tags: 'clothes rack hanging',
          art: '<path d="M10 40 H90"/><circle cx="10" cy="40" r="6"/><circle cx="90" cy="40" r="6"/><path d="M24 40 v16 M38 40 v16 M52 40 v16 M66 40 v16 M80 40 v16"/>' },
        { id: 'suitcase', name: 'Suitcase', cat: 'Storage', w: 0.7, h: 0.45, tags: 'luggage bag travel',
          art: '<rect class="f" x="16" y="30" width="68" height="44" rx="5"/><path d="M40 30 V22 h20 v8"/><path d="M16 52 H84"/>' },

        /* -------------------------------------------- Beds & soft furnishing */
        { id: 'bed-single', name: 'Single bed', cat: 'Beds & soft furnishing', w: 1.0, h: 2.0, tags: 'sleep bedroom cot',
          art: '<rect class="f" x="22" y="6" width="56" height="88" rx="4"/><rect x="28" y="12" width="44" height="22" rx="3"/><path d="M22 42 H78"/>' },
        { id: 'bed-double', name: 'Double bed', cat: 'Beds & soft furnishing', w: 1.6, h: 2.0, tags: 'sleep bedroom',
          art: '<rect class="f" x="8" y="6" width="84" height="88" rx="4"/><rect x="14" y="12" width="34" height="20" rx="3"/><rect x="52" y="12" width="34" height="20" rx="3"/><path d="M8 40 H92"/>' },
        { id: 'rug', name: 'Rug', cat: 'Beds & soft furnishing', w: 2.0, h: 1.4, tags: 'carpet mat floor',
          art: '<rect class="f" x="6" y="20" width="88" height="60" rx="2"/><rect x="14" y="28" width="72" height="44" rx="2"/><path d="M6 20 l8 8 M94 20 l-8 8 M6 80 l8-8 M94 80 l-8-8"/>' },

        /* -------------------------------------------------------- Structure */
        { id: 'rostrum', name: 'Rostrum, platform', cat: 'Structure', w: 2.0, h: 1.0, tags: 'riser deck block level',
          art: '<rect class="f" x="4" y="10" width="92" height="80" rx="2"/><rect class="d" x="16" y="22" width="68" height="56" rx="2"/>' },
        { id: 'steps', name: 'Steps', cat: 'Structure', w: 1.2, h: 0.9, tags: 'treads riser access',
          art: '<rect class="f" x="6" y="58" width="88" height="28" rx="2"/><rect x="22" y="34" width="56" height="24" rx="2"/><rect x="38" y="12" width="24" height="22" rx="2"/>' },
        { id: 'staircase', name: 'Staircase', cat: 'Structure', w: 1.2, h: 3.0, tags: 'stairs flight steps',
          art: '<rect class="f" x="18" y="4" width="64" height="92" rx="2"/><path d="M18 19 H82 M18 34 H82 M18 49 H82 M18 64 H82 M18 79 H82"/><path d="M50 88 V22 M42 30 L50 20 L58 30"/>' },
        { id: 'ramp', name: 'Ramp', cat: 'Structure', w: 1.2, h: 2.4, tags: 'slope access incline',
          art: '<rect class="f" x="18" y="8" width="64" height="84" rx="2"/><path class="d" d="M18 34 H82 M18 58 H82"/><path d="M50 84 V26 M42 34 L50 24 L58 34"/>' },
        { id: 'door-frame', name: 'Doorway', cat: 'Structure', w: 1.1, h: 0.25, tags: 'door entrance exit swing',
          art: '<path d="M2 62 H26 M74 62 H98"/><path d="M26 62 V16"/><path class="d" d="M26 16 A46 46 0 0 1 72 62"/>' },
        { id: 'double-door', name: 'Double doors', cat: 'Structure', w: 1.8, h: 0.25, tags: 'french doors entrance',
          art: '<path d="M2 62 H14 M86 62 H98"/><path d="M14 62 V26 M86 62 V26"/><path class="d" d="M14 26 A36 36 0 0 1 50 62 M86 26 A36 36 0 0 0 50 62"/>' },
        { id: 'window-frame', name: 'Window', cat: 'Structure', w: 1.4, h: 0.2, tags: 'casement glazing',
          art: '<rect class="f" x="0" y="41" width="22" height="18"/><rect class="f" x="78" y="41" width="22" height="18"/><path d="M22 45 H78 M22 55 H78"/>' },
        { id: 'flat', name: 'Flat, wall', cat: 'Structure', w: 2.4, h: 0.15, tags: 'scenery wall panel',
          art: '<rect class="f" x="2" y="42" width="96" height="16"/><path d="M2 58 L14 42 M18 58 L30 42 M34 58 L46 42 M50 58 L62 42 M66 58 L78 42 M82 58 L94 42"/>' },
        { id: 'column', name: 'Column', cat: 'Structure', w: 0.5, h: 0.5, tags: 'pillar post classical',
          art: '<circle class="f" cx="50" cy="50" r="34"/><circle cx="50" cy="50" r="20"/>' },
        { id: 'arch', name: 'Arch', cat: 'Structure', w: 1.8, h: 0.3, tags: 'opening portal',
          art: '<path class="f" d="M8 82 V44 A42 42 0 0 1 92 44 V82 H76 V44 A26 26 0 0 0 24 44 V82 Z"/>' },
        { id: 'screen', name: 'Folding screen', cat: 'Structure', w: 1.6, h: 0.4, tags: 'divider room panel',
          art: '<path d="M6 74 L30 30 L54 74 L78 30 L94 58"/>' },
        { id: 'railing', name: 'Railing', cat: 'Structure', w: 2.0, h: 0.12, tags: 'balustrade fence banister',
          art: '<path d="M4 50 H96"/><circle class="f" cx="10" cy="50" r="6"/><circle class="f" cx="36" cy="50" r="6"/><circle class="f" cx="64" cy="50" r="6"/><circle class="f" cx="90" cy="50" r="6"/>' },
        { id: 'ladder', name: 'Ladder', cat: 'Structure', w: 0.5, h: 0.6, tags: 'steps climb rungs',
          art: '<path d="M28 6 V94 M72 6 V94"/><path d="M28 22 H72 M28 40 H72 M28 58 H72 M28 76 H72"/>' },
        { id: 'plinth', name: 'Plinth, pedestal', cat: 'Structure', w: 0.6, h: 0.6, tags: 'base statue display',
          art: '<rect class="f" x="16" y="16" width="68" height="68" rx="2"/><rect x="32" y="32" width="36" height="36" rx="2"/>' },
        { id: 'fireplace', name: 'Fireplace', cat: 'Structure', w: 1.5, h: 0.4, tags: 'hearth mantel chimney',
          art: '<rect class="f" x="6" y="30" width="88" height="30" rx="2"/><path d="M30 60 V46 a20 20 0 0 1 40 0 v14"/>' },
        { id: 'curtain-panel', name: 'Curtain panel', cat: 'Structure', w: 1.5, h: 0.15, tags: 'drape leg tab hanging',
          art: '<path d="M6 44 q8 12 16 0 q8-12 16 0 q8 12 16 0 q8-12 16 0 q8 12 16 0"/>' },

        /* ---------------------------------------------- Planting & landscape */
        { id: 'tree', name: 'Tree', cat: 'Planting & landscape', w: 2.0, h: 2.0, tags: 'forest wood park foliage',
          art: '<path class="f" d="' + blob(50, 50, 42, 11, 0.22, 11) + '"/><circle cx="50" cy="50" r="7"/>' },
        { id: 'bush', name: 'Bush', cat: 'Planting & landscape', w: 1.0, h: 0.9, tags: 'shrub hedge foliage',
          art: '<path class="f" d="' + blob(50, 50, 40, 9, 0.28, 43) + '"/>' },
        { id: 'rock', name: 'Rock', cat: 'Planting & landscape', w: 1.2, h: 0.9, tags: 'stone boulder cliff',
          art: '<path class="f" d="' + angular(50, 50, 40, 7, 0.35, 91) + '"/><path d="M38 34 L52 52 L40 68 M52 52 L74 46"/>' },
        { id: 'potted-plant', name: 'Potted plant', cat: 'Planting & landscape', w: 0.6, h: 0.6, tags: 'palm fern pot houseplant',
          art: '<circle class="f" cx="50" cy="50" r="30"/><path d="' + radial(50, 50, 8, 28, 7, 0.3) + '"/>' },

        /* --------------------------------------------------- Light & sound */
        { id: 'floor-lamp', name: 'Floor lamp', cat: 'Light & sound', w: 0.45, h: 0.45, tags: 'standard practical light',
          art: '<circle class="f" cx="50" cy="50" r="28"/><path d="M30 30 L70 70 M70 30 L30 70"/>' },
        { id: 'table-lamp', name: 'Table lamp', cat: 'Light & sound', w: 0.3, h: 0.3, tags: 'practical light shade',
          art: '<circle class="f" cx="50" cy="50" r="22"/><path d="M34 34 L66 66 M66 34 L34 66"/>' },
        { id: 'candelabra', name: 'Candelabra', cat: 'Light & sound', w: 0.4, h: 0.4, tags: 'candles light period',
          art: '<circle class="f" cx="50" cy="50" r="12"/><circle cx="50" cy="22" r="9"/><circle cx="74" cy="64" r="9"/><circle cx="26" cy="64" r="9"/>' },
        { id: 'speaker', name: 'Speaker', cat: 'Light & sound', w: 0.4, h: 0.4, tags: 'sound pa monitor wedge',
          art: '<rect class="f" x="24" y="18" width="52" height="64" rx="4"/><circle cx="50" cy="40" r="12"/><circle cx="50" cy="66" r="7"/>' },
        { id: 'mic-stand', name: 'Microphone stand', cat: 'Light & sound', w: 0.5, h: 0.5, tags: 'sound vocal boom',
          art: '<circle class="f" cx="50" cy="50" r="10"/><path d="' + radial(50, 50, 10, 34, 3, -1.57) + '"/>' },
        { id: 'music-stand', name: 'Music stand', cat: 'Light & sound', w: 0.5, h: 0.5, tags: 'score orchestra band',
          art: '<rect class="f" x="24" y="14" width="52" height="22" rx="2"/><path d="M50 36 V56"/><path d="' + radial(50, 56, 4, 30, 3, 0.5) + '"/>' },
        { id: 'projector-screen', name: 'Projection screen', cat: 'Light & sound', w: 2.4, h: 0.15, tags: 'video film cinema',
          art: '<path d="M12 50 H88"/><circle class="f" cx="10" cy="50" r="8"/><circle class="f" cx="90" cy="50" r="8"/>' },

        /* ---------------------------------------------------------- Objects */
        { id: 'piano-grand', name: 'Grand piano', cat: 'Objects', w: 1.5, h: 2.0, tags: 'music keyboard concert',
          art: '<path class="f" d="M18 88 V34 c0-11 9-20 20-20 h16 c26 0 42 18 42 38 c0 22-18 36-40 36 z"/><rect x="18" y="72" width="42" height="16"/>' },
        { id: 'piano-upright', name: 'Upright piano', cat: 'Objects', w: 1.5, h: 0.6, tags: 'music keyboard saloon',
          art: '<rect class="f" x="8" y="38" width="84" height="30" rx="2"/><rect x="18" y="26" width="64" height="12" rx="2"/>' },
        { id: 'mirror', name: 'Mirror', cat: 'Objects', w: 1.0, h: 0.15, tags: 'glass reflection dressing',
          art: '<rect class="f" x="8" y="42" width="84" height="14" rx="2"/><path d="M14 56 L26 42 M34 56 L46 42 M54 56 L66 42 M74 56 L86 42"/>' },
        { id: 'clock', name: 'Clock', cat: 'Objects', w: 0.4, h: 0.15, tags: 'time grandfather wall',
          art: '<circle class="f" cx="50" cy="50" r="34"/><path d="M50 50 V26 M50 50 L66 60"/>' },
        { id: 'sign', name: 'Sign, board', cat: 'Objects', w: 0.8, h: 0.2, tags: 'placard notice poster',
          art: '<rect class="f" x="12" y="20" width="76" height="38" rx="2"/><path d="M50 58 V86 M34 86 H66"/>' },
        { id: 'hat-stand', name: 'Hat & coat stand', cat: 'Objects', w: 0.5, h: 0.5, tags: 'hall coats pegs',
          art: '<circle class="f" cx="50" cy="50" r="11"/><path d="' + radial(50, 50, 11, 32, 6, 0) + '"/>' },
        { id: 'bicycle', name: 'Bicycle', cat: 'Objects', w: 1.7, h: 0.5, tags: 'bike cycle wheels',
          art: '<circle cx="22" cy="50" r="20"/><circle cx="78" cy="50" r="20"/><path d="M22 50 H78 M40 50 L52 30 H64 M52 30 L36 30"/>' },
        { id: 'cart', name: 'Cart, trolley', cat: 'Objects', w: 1.0, h: 0.7, tags: 'wagon barrow handcart',
          art: '<rect class="f" x="20" y="18" width="60" height="64" rx="3"/><circle cx="10" cy="32" r="9"/><circle cx="10" cy="72" r="9"/><circle cx="90" cy="32" r="9"/><circle cx="90" cy="72" r="9"/>' },
        { id: 'easel', name: 'Easel', cat: 'Objects', w: 0.7, h: 0.7, tags: 'painting canvas artist',
          art: '<path d="M50 10 L20 90 M50 10 L80 90 M50 10 V80"/><path d="M28 66 H72"/>' },

        /* ----------------------------------------------------- Marks & notes */
        { id: 'mark-spike', name: 'Spike mark', cat: 'Marks & notes', w: 0.25, h: 0.25, tags: 'tape floor position mark',
          art: '<path d="M50 12 V88 M12 50 H88"/>' },
        { id: 'mark-disc', name: 'Position disc', cat: 'Marks & notes', w: 0.35, h: 0.35, tags: 'dot point spot mark',
          art: '<circle class="f" cx="50" cy="50" r="36"/><circle cx="50" cy="50" r="12"/>' },
        { id: 'mark-arrow', name: 'Move arrow', cat: 'Marks & notes', w: 1.0, h: 0.4, tags: 'direction shift travel',
          art: '<path d="M6 50 H86 M66 30 L88 50 L66 70"/>' },
        { id: 'mark-zone', name: 'Zone outline', cat: 'Marks & notes', w: 1.5, h: 1.0, tags: 'area region box keep clear',
          art: '<rect class="d" x="6" y="6" width="88" height="88" rx="3"/>' },
        { id: 'mark-label', name: 'Label plate', cat: 'Marks & notes', w: 0.9, h: 0.3, tags: 'text caption note title',
          art: '<rect class="f" x="4" y="30" width="92" height="40" rx="4"/><path d="M18 46 H70 M18 58 H54"/>' }
    ];

    var byId = {};
    LIBRARY.forEach(function (p) {
        p.builtin = true;
        byId[p.id] = p;
    });

    function get(id) {
        return byId[id] || null;
    }

    return {
        CATEGORIES: CATEGORIES,
        LIBRARY: LIBRARY,
        get: get,
        blob: blob,
        angular: angular,
        radial: radial
    };
}));
