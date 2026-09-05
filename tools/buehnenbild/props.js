/*
 * Scene & Prop Planner — the built-in prop drawings.
 *
 * Zwei Sorten Zeichnung, und das mit Absicht. Was zählt, ist nicht eine
 * einheitliche Projektion, sondern dass die Mannschaft auf einen Blick sieht,
 * was das Ding darstellen soll — darauf ist diese Truppe nach mehreren
 * Produktionen gekommen.
 *
 *   view: 'plan' (Vorgabe)   Draufsicht. Für alles Größere, auf dem etwas
 *                            stehen kann: Tische, Sofas, Betten, Teppiche.
 *                            Dort ist die Standfläche die Auskunft, und man
 *                            muss sehen, was noch daraufpasst.
 *                            w × h ist die Standfläche in Metern, w quer zur
 *                            Bühne, h von hinten nach vorn.
 *
 *   view: 'front'            Ansicht oder Schrägbild. Für alles, was von oben
 *                            nur ein Fleck wäre: eine Tasse, eine Flasche, ein
 *                            Buch. Die muss wie eine Tasse aussehen.
 *                            w × h ist dann die Ausdehnung des Bildes, h also
 *                            die Höhe und nicht die Tiefe. Das steht im
 *                            Auswahl-Bereich auch dran — sonst weiß niemand,
 *                            welche der beiden Zahlen er vor sich hat.
 *
 * Gezeichnet wird in derselben Strichführung wie auf einem Grundriss von
 * Hand: nur Konturen, ein blasser Ton für Massives, gestrichelt für alles,
 * was schwingt oder gar nicht wirklich da ist.
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
        'Seating',
        'Tables',
        'Furniture',
        'Storage',
        'Set pieces',
        'Tableware',
        'Small props',
        'Technical',
        'Marks & notes'
    ];

    var LIBRARY = [
        /* ---------------------------------------------------------- Seating */
        { id: 'sofa', shape: 'sofa', name: 'Sofa', cat: 'Seating', w: 2.0, h: 0.85, tags: 'sofa couch sitzen zweisitzer dreisitzer',
          art: '<rect x="0" y="0" width="100" height="100" rx="3.5" ry="8.24"/><path d="M0 25.88H100"/><path d="M9 25.88V100"/><path d="M91 25.88V100"/>' },
        { id: 'armchair', shape: 'armchair', name: 'Armchair', cat: 'Seating', w: 0.9, h: 0.85, tags: 'easy chair seat lounge',
          art: '<rect x="16" y="24" width="68" height="56" rx="10"/><rect x="28" y="38" width="44" height="42" rx="5"/>' },

        /* --------------------------------------------------- Tables & desks */
        { id: 'dining-table', shape: 'table', name: 'Dining table', cat: 'Tables', w: 1.6, h: 0.9, tags: 'esstisch tisch esstafel',
          art: '<rect x="0" y="0" width="100" height="100"/><path d="M0 0L13 13"/><path d="M0 100L13 87"/><path d="M100 100L87 87"/><path d="M100 0L87 13"/>' },
        { id: 'round-table', shape: 'table-round', name: 'Round table', cat: 'Tables', w: 0.8, h: 0.8, tags: 'runder tisch bistro bankett',
          art: '<circle cx="50" cy="50" r="50"/><path d="M14.6 14.6L23.5 23.5"/><path d="M14.6 85.4L23.5 76.5"/><path d="M85.4 85.4L76.5 76.5"/><path d="M85.4 14.6L76.5 23.5"/>' },

        /* --------------------------------------------------------- Storage */
        { id: 'suitcase', view: 'front', name: 'Suitcase', cat: 'Storage', box: [16, 22, 68, 52], w: 0.7, h: 0.54, tags: 'luggage bag travel',
          art: '<rect x="16" y="30" width="68" height="44" rx="5"/><path d="M40 30 V22 h20 v8"/><path d="M16 52 H84"/>' },

        /* -------------------------------------------- Beds & soft furnishing */
        { id: 'rug', shape: 'rug', name: 'Rug', cat: 'Set pieces', w: 2.0, h: 3.0, tags: 'teppich laeufer boden',
          art: '<rect x="0" y="7" width="100" height="86"/><path d="M0.0 0V7"/><path d="M8.33 0V7"/><path d="M16.67 0V7"/><path d="M25.0 0V7"/><path d="M33.33 0V7"/><path d="M41.67 0V7"/><path d="M50.0 0V7"/><path d="M58.33 0V7"/><path d="M66.67 0V7"/><path d="M75.0 0V7"/><path d="M83.33 0V7"/><path d="M91.67 0V7"/><path d="M100.0 0V7"/><path d="M0.0 93V100"/><path d="M8.33 93V100"/><path d="M16.67 93V100"/><path d="M25.0 93V100"/><path d="M33.33 93V100"/><path d="M41.67 93V100"/><path d="M50.0 93V100"/><path d="M58.33 93V100"/><path d="M66.67 93V100"/><path d="M75.0 93V100"/><path d="M83.33 93V100"/><path d="M91.67 93V100"/><path d="M100.0 93V100"/>' },
        { id: 'bed', shape: 'bed', grip: 'width', name: 'Bed', cat: 'Furniture', w: 1.0, h: 2.0, tags: 'bett sleep bedroom cot doppelbett einzelbett',
          art: '<rect x="22" y="6" width="56" height="88" rx="4"/><rect x="28" y="12" width="44" height="22" rx="3"/><path d="M22 42 H78"/>' },

        /* -------------------------------------------------------- Structure */
        { id: 'folding-screen', shape: 'screen', name: 'Folding screen', cat: 'Set pieces', w: 1.2, h: 0.45, tags: 'paravent wandschirm spanische wand',
          art: '<path d="M0 100L33 0L67 100L100 0"/>' },
        { id: 'door-frame', shape: 'door', name: 'Doorway', cat: 'Set pieces', w: 1.1, h: 0.86, tags: 'door entrance exit swing',
          art: '<path d="M2 62 H26 M74 62 H98"/><path d="M26 62 V16"/><path class="d" d="M26 16 A46 46 0 0 1 72 62"/>' },
        { id: 'ladder', grip: 'depth', shape: 'ladder', name: 'Ladder', cat: 'Set pieces', w: 0.42, h: 1.5, tags: 'steps climb rungs',
          art: '<path d="M34 6 V94 M66 6 V94"/><path d="M34 20 H66 M34 38 H66 M34 56 H66 M34 74 H66 M34 90 H66"/>' },

        /* ---------------------------------------------- Planting & landscape */
        { id: 'rock', name: 'Rock', cat: 'Set pieces', box: [6.6, 5.2, 88.4, 86.2], w: 1.2, h: 1.17, tags: 'stone boulder cliff',
          art: '<path d="' + angular(50, 50, 40, 7, 0.35, 91) + '"/><path d="M38 34 L52 52 L40 68 M52 52 L74 46"/>' },

        /* --------------------------------------------------- Light & sound */
        { id: 'piano-upright', shape: 'piano', grip: 'none', name: 'Upright piano', cat: 'Furniture', w: 1.5, h: 0.6, tags: 'klavier pianino tasten',
          art: '<rect x="0" y="0" width="100" height="100"/><path d="M0 58H100"/><path d="M7.14 58V100"/><path d="M14.29 58V100"/><path d="M21.43 58V100"/><path d="M28.57 58V100"/><path d="M35.71 58V100"/><path d="M42.86 58V100"/><path d="M50.0 58V100"/><path d="M57.14 58V100"/><path d="M64.29 58V100"/><path d="M71.43 58V100"/><path d="M78.57 58V100"/><path d="M85.71 58V100"/><path d="M92.86 58V100"/><rect class="s" x="5.21" y="58" width="3.86" height="24.36"/><rect class="s" x="12.36" y="58" width="3.86" height="24.36"/><rect class="s" x="26.64" y="58" width="3.86" height="24.36"/><rect class="s" x="33.78" y="58" width="3.86" height="24.36"/><rect class="s" x="40.93" y="58" width="3.86" height="24.36"/><rect class="s" x="55.21" y="58" width="3.86" height="24.36"/><rect class="s" x="62.36" y="58" width="3.86" height="24.36"/><rect class="s" x="76.64" y="58" width="3.86" height="24.36"/><rect class="s" x="83.78" y="58" width="3.86" height="24.36"/><rect class="s" x="90.93" y="58" width="3.86" height="24.36"/>' },
        { id: 'piano-grand', name: 'Grand piano', cat: 'Furniture', box: [0, 0, 92.4, 100], w: 1.5, h: 1.62, tags: 'fluegel klavier tasten konzert',
          art: '<path d="M 0,100 V 13.797206 C 0,5.6242178 7.4342804,0 14.846993,0 H 25.397989 C 50.125474,0 52.649259,17.948769 55.866145,36.03304 59.083031,54.117312 92.364793,50.700668 92.364793,77.697631 92.364793,91.697631 92,100 92,100 Z"/><path d="M0 86H92"/><path d="M4.6 86V100"/><path d="M9.2 86V100"/><path d="M13.8 86V100"/><path d="M18.4 86V100"/><path d="M23.0 86V100"/><path d="M27.6 86V100"/><path d="M32.2 86V100"/><path d="M36.8 86V100"/><path d="M41.4 86V100"/><path d="M46.0 86V100"/><path d="M50.6 86V100"/><path d="M55.2 86V100"/><path d="M59.8 86V100"/><path d="M64.4 86V100"/><path d="M69.0 86V100"/><path d="M73.6 86V100"/><path d="M78.2 86V100"/><path d="M82.8 86V100"/><path d="M87.4 86V100"/><rect class="s" x="3.36" y="86" width="2.48" height="8.12"/><rect class="s" x="7.96" y="86" width="2.48" height="8.12"/><rect class="s" x="17.16" y="86" width="2.48" height="8.12"/><rect class="s" x="21.76" y="86" width="2.48" height="8.12"/><rect class="s" x="26.36" y="86" width="2.48" height="8.12"/><rect class="s" x="35.56" y="86" width="2.48" height="8.12"/><rect class="s" x="40.16" y="86" width="2.48" height="8.12"/><rect class="s" x="49.36" y="86" width="2.48" height="8.12"/><rect class="s" x="53.96" y="86" width="2.48" height="8.12"/><rect class="s" x="58.56" y="86" width="2.48" height="8.12"/><rect class="s" x="67.76" y="86" width="2.48" height="8.12"/><rect class="s" x="72.36" y="86" width="2.48" height="8.12"/><rect class="s" x="81.56" y="86" width="2.48" height="8.12"/><rect class="s" x="86.16" y="86" width="2.48" height="8.12"/>' },
        { id: 'speaker', view: 'front', grip: 'ratio', name: 'Speaker', cat: 'Technical', box: [24, 18, 52, 64], w: 0.4, h: 0.49, tags: 'sound pa monitor wedge',
          art: '<rect x="24" y="18" width="52" height="64" rx="4"/><circle cx="50" cy="40" r="12"/><circle cx="50" cy="66" r="7"/>' },
        { id: 'music-stand', view: 'front', grip: 'none', name: 'Music stand', cat: 'Technical', box: [24, 14, 52, 72], w: 0.5, h: 0.69, tags: 'score orchestra band',
          art: '<rect x="24" y="14" width="52" height="22" rx="2"/>' +
               '<path d="M50 36 V64"/>' +
               '<path d="M50 64 L26 82 M50 64 L74 82 M50 64 V86"/>' },

        /* ---------------------------------------------------------- Objects */
        { id: 'clock', view: 'front', grip: 'none', name: 'Clock', cat: 'Small props', box: [16, 16, 68, 68], w: 0.4, h: 0.4, tags: 'uhr wanduhr zeit clock',
          art: '<circle cx="50" cy="50" r="34"/><path d="M50 50 V26 M50 50 L66 60"/>' },

        /* ----------------------------------------------------- Marks & notes */
        { id: 'mark-spike', grip: 'square', name: 'Spike mark', cat: 'Marks & notes', mark: 'spike', w: 0.25, h: 0.25, tags: 'tape floor position mark',
          art: '<path d="M50 12 V88 M12 50 H88"/>' },
        { id: 'mark-arrow', name: 'Move arrow', cat: 'Marks & notes', mark: 'arrow', w: 1.0, h: 0.22, tags: 'direction shift travel',
          art: '<path d="M6 50 H86 M66 30 L88 50 L66 70"/>' },
        { id: 'mark-zone', name: 'Zone outline', cat: 'Marks & notes', mark: 'zone', w: 1.5, h: 1.0, tags: 'area region box keep clear',
          art: '<rect class="d" x="6" y="6" width="88" height="88" rx="3"/>' },
        { id: 'mark-label', name: 'Label plate', cat: 'Marks & notes', mark: 'label', w: 0.9, h: 0.3, tags: 'text caption note title',
          art: '<rect x="4" y="30" width="92" height="40" rx="4"/><path d="M18 46 H70 M18 58 H54"/>' },

        /* ------------------------------------------------------------------ *
         * Illustrationen
         *
         * Aus den Umbauplänen einer Aufführung übernommen: schräg gezeichnet,
         * nicht als Draufsicht. Zusammengesetztes ist getrennt — die Tischplatte
         * ist ein Stück, was darauf liegt je ein eigenes.
         *
         * Klasse "s" heißt: diese Fläche war in der Vorlage gefüllt und bleibt
         * gefüllt. Als Kontur gezeichnet würde aus jedem gefüllten Strich eine
         * Doppellinie, und das Bild liefe zu.
         *
         * w und h sind die Ausdehnung der Zeichnung auf dem Plan, nicht die
         * reine Standfläche — bei einer Schrägansicht steckt die Höhe mit drin.
         * ------------------------------------------------------------------ */
        { id: 'ill-blackboard', view: 'front', grip: 'ratio', name: 'Blackboard', cat: 'Set pieces', box: [4, 19.6, 92, 60.8], w: 1.5, h: 0.98, tags: 'tafel schule kreide',
          art: '<path d="M32.7 57.6C34.9 57.8 34.8 57.5 37.1 57.8C38.7 58 45.3 55.7 46 56.2C48.3 57.7 51.3 55.6 62 56.7C64.3 56.9 64.3 55.9 66.6 56.6C70.2 57.9 73.5 55 82.3 55.7"/><path d="M17.6 49.4C23.4 49.6 23.9 48.5 25.6 50.8C27.7 49.2 27.6 47.8 29.6 49.4C31.5 50.9 31.7 47.4 33.9 48.7C37 50.7 37.5 48.1 41.1 49.2C41.4 49.2 44.7 50.2 45.7 48.6C46.2 48 56.1 49.9 58 48C58.2 47.7 60.6 51.6 61.3 49.7C61.7 48.2 62.5 48.7 62.7 48.7C63.5 49.2 67.5 49.5 70.4 48.9"/><path d="M33 64.1L14.8 80.3"/><path d="M69.3 64.2L92.1 80.4"/><path d="M50 41.7L50 19.6"/><path d="M11.6 64.2L4 41.7L96 41.7L90.4 64.2ZM11.6 64.2"/>' },
        { id: 'ill-chair', view: 'front', grip: 'none', name: 'School chair', cat: 'Seating', box: [20.6, 4, 58.8, 91.9], w: 0.45, h: 0.7, tags: 'stuhl sitzen schule',
          art: '<path d="M27.8 7.4L20.6 4"/><path d="M72.1 7.4L79.4 4"/><path d="M72.6 8.2C74.4 18.8 74 51.6 66.5 55.5C59 59.3 39.2 59.1 33.3 55.5C27.4 51.9 25.6 18.9 27.4 8.2C27.8 5.7 72.1 5.5 72.6 8.2ZM72.6 8.2"/><path d="M43.5 58.3L37 94.9"/><path d="M55.8 58.3L61.5 95"/><path d="M67 55.1L77.6 91.4C77.6 91.4 64.7 95.8 49.8 95.9C35.3 96 22.3 91.4 22.3 91.4L32.8 55.1"/>' },
        { id: 'ill-crate', view: 'front', name: 'Crate', cat: 'Storage', box: [4, 12, 92, 76], w: 0.45, h: 0.37, tags: 'kiste box holz',
          art: '<path d="M4 24H76V88H4Z"/><path d="M4 24L24 12H96L76 24"/><path d="M76 88L96 76V12"/><path d="M4 45H76"/><path d="M4 66H76"/><path d="M76 45L96 33"/><path d="M76 66L96 54"/>' },
        { id: 'ill-coatstand', view: 'front', grip: 'none', name: 'Coat stand', cat: 'Furniture', box: [29.7, 4, 40.6, 92], w: 0.43, h: 0.98, tags: 'kleiderständer garderobe',
          art: '<path d="M50 12.9L39.9 7.5"/><path d="M50 26.6L39.1 21.1"/><path d="M50 20.1L60.9 12.9"/><path d="M50 35.8L60.9 29"/><path d="M50 74.7C61.2 74.7 70.3 79.5 70.3 85.4C70.3 91.2 61.2 96 50 96C38.8 96 29.7 91.2 29.7 85.4C29.7 79.5 38.8 74.7 50 74.7ZM50 74.7"/><path d="M50 85.4L50 4"/>' },
        { id: 'ill-typewriter', view: 'front', grip: 'none', name: 'Typewriter', cat: 'Small props', box: [11, 4, 78, 60], w: 0.36, h: 0.28, tags: 'schreibmaschine büro',
          art: '<path d="M30 4H70V17H30Z"/><path d="M20 17H80"/><circle cx="16" cy="21" r="5"/><circle cx="84" cy="21" r="5"/><path d="M20 17H80V26H20Z"/><path d="M24 26H76L88 58H12Z"/><path d="M28 36H72"/><path d="M25 44H75"/><path d="M22 52H78"/><path d="M12 58H88V64H12Z"/>' },
        { id: 'ill-bottle', view: 'front', grip: 'none', name: 'Wine bottle', cat: 'Tableware', box: [35, 6, 30, 87], w: 0.18, h: 0.51, tags: 'weinflasche flasche wein',
          art: '<path d="M44 6V28C44 36 35 38 35 48V88A5 5 0 0 0 40 93H60A5 5 0 0 0 65 88V48C65 38 56 36 56 28V6Z"/><path d="M44 13H56"/><path d="M35 56H65"/><path d="M35 78H65"/>' },
        { id: 'ill-bench', grip: 'width', shape: 'bench', name: 'Bench', cat: 'Seating', w: 1.93, h: 0.64, tags: 'bank sitzen park',
          art: '<path d="M17.3 64.2L18.2 66.3"/><path d="M 13.318625,37.096039 11.9,35.814846"/><path d="M17.2 53.7L17.3 56.6"/><path d="M17.2 43.2L17.2 46.1L19.1 45.2"/><path d="M83.9 64.2L83.1 66.3"/><path d="M 86.825137,37.021054 88.1,35.714846"/><path d="M83.9 53.7L83.9 56.6"/><path d="M83.9 43.2L83.9 46.1L82.5 45.2"/><path d="M 95.99947,37.004241 90.2,43.2 9.8,43.3 4.0005302,37.136797 Z"/><path d="M90.2 56.5L90.2 64.2L9.8 64.2L9.8 56.6ZM90.2 56.5"/><path d="M90.2 46.1L90.2 53.7L9.8 53.7L9.8 46.1ZM90.2 46.1"/>' },
        { id: 'ill-bin', view: 'front', grip: 'none', name: 'Bin', cat: 'Furniture', box: [16, 0, 68, 96], w: 0.35, h: 0.49, tags: 'mülleimer abfall eimer',
          art: '<path d="M16 4H84V13H16Z"/><path d="M45 4V0"/><path d="M55 4V0"/><path d="M20.2 14V96H79.8V14"/><path d="M36.2 26V84"/><path d="M50 26V84"/><path d="M63.8 26V84"/>' },
        { id: 'ill-cafechair', view: 'front', grip: 'none', name: 'Café chair', cat: 'Seating', box: [17.7, 5.5, 65.1, 90.3], w: 0.51, h: 0.71, tags: 'caféstuhl stuhl café',
          art: '<g transform="rotate(-90 50 50)"><path d="M91.1 28.4L94.5 17.7"/><path d="M91.1 72L94.5 82.8"/><path d="M90.3 72.4C80 74.2 47.7 73.8 43.9 66.4C40.1 59 40.4 39.6 43.9 33.8C47.5 28 79.8 26.3 90.3 28C96 29 95.7 71.5 90.3 72.4ZM90.3 72.4"/><path d="M41.2 43.9L4.9 38.2"/><path d="M41.2 55.9L4.9 61.7"/><path d="M44.3 67C22.5 80.9 4.4 86 4.2 50C4 14 25.1 20.7 44.3 33.4"/></g>' },
        { id: 'ill-mug', view: 'front', grip: 'none', name: 'Mug', cat: 'Tableware', box: [7.9, 4, 77.5, 86.4], w: 0.12, h: 0.13, tags: 'kaffeetasse tasse becher',
          art: '<path d="M66.8 26.7C91.2 26.7 92.1 66.8 66.8 66.8"/><path d="M7.9 16.8L7.9 73.9C7.9 95.9 66.8 96 66.8 73.9L66.8 16.8"/><path d="M37.4 4C53.6 4 66.8 9.7 66.8 16.8C66.8 23.9 53.6 29.6 37.4 29.6C21.1 29.6 7.9 23.9 7.9 16.8C7.9 9.7 21.1 4 37.4 4ZM37.4 4"/>' },
        { id: 'ill-book', view: 'front', grip: 'none', name: 'Book', cat: 'Small props', box: [17, 4, 66, 92], w: 0.22, h: 0.31, tags: 'märchenbuch buch lesen',
          art: '<path d="M66.1 19.4L66.1 58.4M66.1 19.4L50 33.1L33.9 19.4L33.9 58.4"/><path d="M17 85.8L17 20.4C17 14.6 17 11.8 17.9 9.6C18.7 7.7 19.9 6.1 21.5 5.1C23.2 4 25.6 4 30.2 4L69.8 4C74.4 4 76.8 4 78.5 5.1C80.1 6.1 81.3 7.7 82.1 9.6C83 11.8 83 14.6 83 20.4L83 75.6L25.2 75.6C20.7 75.6 17 80.1 17 85.8ZM17 85.8C17 91.4 20.7 96 25.2 96L83 96M78.9 75.6L78.9 96"/>' },
        { id: 'table-cloth', shape: 'table', name: 'Table with a cloth', cat: 'Tables', w: 0.9, h: 0.9,
          params: { cloth: true }, tags: 'tisch tischdecke karo decke gedeckt' },
        { id: 'ill-chalk', grip: 'width', shape: 'stick', name: 'Chalk', cat: 'Small props', w: 0.11, h: 0.018, tags: 'stift kreide schreiben',
          art: '<path d="M72.3 29.2L80.6 43.9M4 78L4.6 76.7C6.6 72.1 7.6 69.8 9 67.8C10.2 66 11.7 64.4 13.3 63C15.2 61.4 17.4 60.2 21.7 57.7L82.2 23.6C86.3 21.4 91.4 22.8 93.7 26.8C96 30.9 94.6 36 90.5 38.3L28.9 73C24.9 75.3 23 76.4 20.9 77.1C19 77.8 17.1 78.2 15.1 78.4C12.9 78.6 10.6 78.5 6.1 78.2ZM4 78"/>' },
        { id: 'ill-menu', view: 'front', grip: 'none', name: 'Menu card', cat: 'Small props', box: [21.4, 4.9, 57.2, 91.1], w: 0.22, h: 0.35, tags: 'karte speisekarte menü',
          art: '<path d="M21.4 24.4L75.1 24.4C77.2 24.4 78.6 25.8 78.6 28L78.6 92.4C78.6 94.6 77.2 96 75.1 96L24.9 96C22.8 96 21.4 94.6 21.4 92.4L21.4 24.4L62.9 5.4C65 4 67.9 5.8 67.9 8.7L67.9 24.4"/><path d="M40.7 35.1L59.7 35.1L63.6 44.8C65.7 50.5 64.3 57 59.7 61.3C54.3 66.3 46.1 66.3 40.7 61.3C36 57.3 34.6 50.5 36.8 44.8ZM40.7 35.1"/><path d="M50 74.9C50 79.9 46.8 84.2 41.8 85.3L58.2 85.3"/><path d="M50 65L50 75.2C50 80.3 53.2 84.2 58.2 85.3"/>' },
        { id: 'glass-water', view: 'front', grip: 'none', name: 'Water glass', cat: 'Tableware', box: [28, 26, 42, 66], w: 0.07, h: 0.11, tags: 'wasserglas glas trinken becher',
          /* Voll oder leer steht auf dem Blatt: die Requisite muss vor der
             Vorstellung gefüllt werden oder eben nicht. Der Spiegel ist eine
             Welle, weil ein gerader Strich im Glas wie eine Naht aussieht. */
          paramSpec: [{ key: 'full', label: 'Filled', type: 'toggle', def: false }],
          art: '<path d="M28 26L33 87A5 5 0 0 0 38 92H62A5 5 0 0 0 67 87L72 26Z"/>',
          artWhen: { full: '<path d="M30 50q5 -3.4 10 0t10 0t10 0t10 0"/>' } },
        { id: 'glass-wine', view: 'front', grip: 'none', name: 'Wine glass', cat: 'Tableware', box: [31.6, 12, 36.7, 78], w: 0.085, h: 0.18, tags: 'weinglas glas wein stiel',
          /* Der Kelch lief unten spitz auf den Stiel zu wie ein Cocktailglas.
             Er baucht jetzt und rundet sich zum Stiel hin ab; der Rand ist
             ein wenig eingezogen, wie bei einem Tulpenglas. */
          paramSpec: [{ key: 'full', label: 'Filled', type: 'toggle', def: false }],
          art: '<path d="M36 12C29 26 30 44 42 53C46 56 54 56 58 53C70 44 71 26 64 12Z"/><path d="M50 56V84"/><ellipse cx="50" cy="86" rx="15" ry="4"/>',
          artWhen: { full: '<path d="M31 38q4.75 -3 9.5 0t9.5 0t9.5 0t9.5 0"/>' } },
        { id: 'ill-pot', view: 'front', grip: 'none', name: 'Coffee pot', cat: 'Tableware', box: [4, 8.9, 86.1, 77.5], w: 0.2, h: 0.18, tags: 'kännchen kanne kaffee',
          art: '<path d="M4 20.9C18.6 22.2 23.6 40.7 21 71.7C21 91.3 73.5 91.4 73.5 71.7L73.5 20.9"/><path d="M42.1 8.9C61.3 8.6 73.5 14.3 73.5 20.9C73.5 27.5 61.3 33.1 42.1 32.8C24.2 32.5 21.7 23.2 4 20.9C20.9 16.6 23.7 9.2 42.1 8.9ZM42.1 8.9"/><path d="M73.5 29.6C95.2 29.6 96 65.4 73.5 65.4"/>' }
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
