/*
 * Das Handbuch.
 *
 * Der Planer hat 74 Erklärungen, je eine pro Einstellung, und die stehen
 * schon im Wörterbuch. Was fehlte, war ein Weg, sie zu durchsuchen, ohne zu
 * wissen, in welchem Reiter die Einstellung wohnt. Dieses Modul hält den
 * Index, die Suche und die Wegbeschreibung: zu jedem Schlüssel steht hier,
 * wo im Programm die zugehörige Einstellung sitzt.
 *
 * Die Wegbeschreibung ist von Hand gepflegt und nicht aus dem Präfix
 * geraten. Geraten wäre es meistens richtig und gelegentlich falsch, und
 * eine Suche, die einen zum falschen Reiter schickt, ist schlimmer als
 * keine. audit() meldet jeden Schlüssel ohne Weg.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SPGuide = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* Die Abschnitte des Handbuchs, in der Reihenfolge, in der man sie
       braucht: erst die Bühne stellen, dann Szenen bauen, dann drucken. */
    var SECTIONS = [
        { id: 'stage', title: 'Die Bühne', tab: 'stage' },
        { id: 'scene', title: 'Szenen und Requisiten', tab: 'scenes' },
        { id: 'item', title: 'Ein ausgewähltes Requisit', tab: 'scenes' },
        { id: 'place', title: 'Orte', tab: 'places' },
        { id: 'trans', title: 'Umbauten', tab: 'scenes' },
        { id: 'draw', title: 'Requisiten zeichnen', tab: 'props' },
        { id: 'print', title: 'Drucken', tab: 'print' },
        { id: 'store', title: 'Sichern', tab: null }
    ];

    /*
     * Wo eine Einstellung wohnt.
     *
     *   tab     welcher Reiter
     *   panel   'item' oder 'scene', wenn sie im rechten Inspektor steckt
     *   dialog  Name des Dialogs, wenn sie nur dort auftaucht
     *   open    was man drücken muss, um dorthin zu kommen — als Text für
     *           Leute, nicht als Selektor
     */
    var WHERE = {
        settings: { dialog: 'settings', open: 'Einstellungen, oben neben dem Stücknamen' },
        backup:   { dialog: 'backup',   open: 'Sicherung, oben rechts' },
        draw:     { tab: 'props', dialog: 'draw', open: 'Requisiten, dann „Requisit zeichnen“' },
        trans:    { tab: 'scenes', dialog: 'transition', open: 'Szenen, dann einen Umbau in der Liste anklicken' },
        item:     { tab: 'scenes', panel: 'item', open: 'Szenen, ein Requisit anklicken, rechts „Auswahl“' },
        sceneIns: { tab: 'scenes', panel: 'scene', open: 'Szenen, rechts „Szene“' }
    };

    /* Ausnahmen zuerst; alles andere folgt dem Präfix. */
    var EXCEPTIONS = {
        'stage.directions': WHERE.settings,
        'scene.numbering': WHERE.settings,
        'store.backup': WHERE.backup,
        'store.restore': WHERE.backup,
        'scene.notes': WHERE.sceneIns,
        'scene.wingNotes': WHERE.sceneIns
    };

    var BY_PREFIX = {
        stage: { tab: 'stage', open: 'Reiter „Bühne“' },
        scene: { tab: 'scenes', open: 'Reiter „Szenen“' },
        item: WHERE.item,
        place: { tab: 'places', open: 'Reiter „Orte“' },
        print: { tab: 'print', open: 'Reiter „Drucken“' },
        draw: WHERE.draw,
        trans: WHERE.trans,
        store: WHERE.backup
    };

    function routeFor(key) {
        if (EXCEPTIONS[key]) return EXCEPTIONS[key];
        return BY_PREFIX[key.split('.')[0]] || null;
    }

    /*
     * Umlaute falten. Wer „Bühne“ sucht, tippt je nach Tastatur und Laune
     * „bühne“, „buehne“ oder „buhne“ — alle drei müssen auf dieselbe Form
     * laufen, sonst sucht man im Deutschen dauernd daneben. Also: Umlaut auf
     * den Grundbuchstaben, und die Ersatzschreibung gleich hinterher. Dass
     * dabei auch „neue“ zu „nue“ wird, stört nicht: Text und Anfrage gehen
     * durch dieselbe Mühle, es kann also nur zusammenfallen, was ohnehin
     * beides passt.
     */
    function fold(text) {
        return String(text == null ? '' : text)
            .toLowerCase()
            .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u')
            .replace(/ß/g, 'ss')
            .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u')
            .replace(/[„“”‚‘’]/g, '"')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /*
     * Baut den durchsuchbaren Index. `explain` ist SPI18n.explain, `keys`
     * die Liste aller Schlüssel — beides wird hereingereicht, damit dieses
     * Modul nichts über die Sprache wissen muss.
     */
    function buildIndex(keys, explain) {
        var out = [];
        keys.forEach(function (key) {
            var entry = explain(key);
            if (!entry) return;
            var route = routeFor(key);
            out.push({
                key: key,
                title: entry.title,
                body: entry.body,
                section: key.split('.')[0],
                tab: route && route.tab || null,
                panel: route && route.panel || null,
                dialog: route && route.dialog || null,
                open: route && route.open || '',
                foldedTitle: fold(entry.title),
                foldedBody: fold(entry.body)
            });
        });
        return out;
    }

    /*
     * Sucht in Titeln und Fließtext. Ein Treffer im Titel wiegt schwerer als
     * einer im Text, ein Wortanfang schwerer als ein Treffer mitten drin —
     * sonst steht „Raster“ hinter drei Einträgen, die das Wort nur erwähnen.
     * Alle Wörter der Anfrage müssen vorkommen, sonst wird die Liste bei
     * zwei Suchbegriffen länger statt kürzer.
     */
    function search(index, query, limit) {
        var words = fold(query).split(' ').filter(Boolean);
        if (!words.length) return [];
        var hits = [];
        index.forEach(function (entry) {
            var score = 0;
            for (var i = 0; i < words.length; i++) {
                var word = words[i];
                var inTitle = entry.foldedTitle.indexOf(word);
                var inBody = entry.foldedBody.indexOf(word);
                if (inTitle === -1 && inBody === -1) return;      // Wort fehlt
                if (inTitle === 0) score += 100;
                else if (inTitle > 0) score += entry.foldedTitle[inTitle - 1] === ' ' ? 60 : 30;
                if (inBody > -1) score += 6;
            }
            if (entry.foldedTitle === fold(query)) score += 500;
            hits.push({ entry: entry, score: score });
        });
        hits.sort(function (a, b) {
            return b.score - a.score || a.entry.title.localeCompare(b.entry.title);
        });
        return hits.slice(0, limit || 12).map(function (h) { return h.entry; });
    }

    /* Meldet, was keine Wegbeschreibung hat. Läuft im Test mit, damit ein
       neuer Schlüssel nicht stillschweigend ins Nichts zeigt. */
    function audit(keys) {
        return keys.filter(function (key) { return !routeFor(key); });
    }

    function sectionsOf(index) {
        return SECTIONS.map(function (section) {
            return {
                id: section.id,
                title: section.title,
                tab: section.tab,
                entries: index.filter(function (e) { return e.section === section.id; })
            };
        }).filter(function (s) { return s.entries.length; });
    }

    return {
        SECTIONS: SECTIONS,
        fold: fold,
        routeFor: routeFor,
        buildIndex: buildIndex,
        search: search,
        audit: audit,
        sectionsOf: sectionsOf
    };
}));
