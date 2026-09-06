/*
 * Szenen- und Requisitenplaner — Sprache.
 *
 * Wörterbuch im gettext-Stil: der Schlüssel ist der englische Ausgangstext,
 * der Wert die Übersetzung. Damit lässt sich Englisch später ohne Umbenennen
 * zurückholen — bei lang === 'en' gibt t() schlicht den Schlüssel zurück.
 *
 * Platzhalter werden als {name} geschrieben: t('%s props', ...) gibt es nicht,
 * stattdessen t('{n} props', { n: 3 }).
 */
(function (root, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory();
    } else {
        root.SPI18n = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var DE = {

        /* ---------------------------------------------------------- Chrome */
        'Scene planner': 'Szenenplaner',
        'for prop and set crews': 'für Requisite und Bühnenbau',
        'Scene & Prop Planner': 'Szenen- und Requisitenplaner',
        'Production': 'Produktion',
        'Settings': 'Einstellungen',
        'Scenes': 'Szenen',
        'Stage': 'Bühne',
        'Places': 'Orte',
        'Prop library': 'Requisiten',
        'Print': 'Drucken',
        'Sections': 'Bereiche',
        'Saved locally': 'Lokal gespeichert',
        'Saving…': 'Wird gespeichert …',
        'Could not save: storage is full': 'Nicht gespeichert: Speicher voll',
        'Paused — another window': 'Angehalten — anderes Fenster',
        'Newer work in another window': 'In einem anderen Fenster wurde neuer gearbeitet',
        'Another window of the planner has saved something newer. This window still shows what it had before and has stopped saving, so it cannot write over the other one.':
            'Ein anderes Fenster des Planers hat etwas Neueres gespeichert. Dieses Fenster zeigt noch seinen alten Stand und speichert nicht mehr, damit es den anderen nicht überschreibt.',
        '“Reload” fetches the newer state — anything changed in this window since then is gone. “Keep mine” writes this window over it — then the work from the other window is gone.':
            '„Neu laden“ holt den neueren Stand — was seither in diesem Fenster geändert wurde, ist dann weg. „Meinen behalten“ schreibt dieses Fenster darüber — dann ist die Arbeit des anderen Fensters weg.',
        'Decide later': 'Später entscheiden',
        'Keep mine': 'Meinen behalten',
        'Reload': 'Neu laden',
        'Kept this window. The other window’s newer work is gone.':
            'Dieses Fenster behalten. Die neuere Arbeit des anderen Fensters ist weg.',
        'Undo': 'Rückgängig',
        'Redo': 'Wiederherstellen',
        'Backup': 'Back-up',
        'Cancel': 'Abbrechen',
        'Close': 'Schließen',
        'Save': 'Speichern',
        'Delete': 'Löschen',
        'Back': 'Zurück',
        'Next': 'Weiter',
        'Apply': 'Übernehmen',
        'Undo (Ctrl+Z)': 'Rückgängig (Strg+Z)',
        'Redo (Ctrl+Shift+Z)': 'Wiederherstellen (Strg+Shift+Z)',
        'Production settings': 'Einstellungen der Produktion',
        'What is this?': 'Was ist das?',

        /* ------------------------------------------------------- Onboarding */
        'Welcome': 'Willkommen',
        'What brings you here?': 'Was hast du vor?',
        'I am planning a real production':
            'Ich plane ein konkretes Stück',
        'Set the whole thing up step by step: the piece, the stage, the acts, the scenes and the places they play in.':
            'Alles Schritt für Schritt einrichten: Stück, Bühne, Akte, Szenen und die Orte, an denen sie spielen.',
        'I am just having a look': 'Ich schaue mich nur um',
        'Opens a worked example you can pull apart.':
            'Öffnet ein fertiges Beispiel zum Auseinandernehmen.',
        'Open the example': 'Beispiel öffnen',
        'Step {n} of {total}': 'Schritt {n} von {total}',
        'Set up later': 'Später einrichten',
        'Run the setup again': 'Einrichtung erneut starten',

        'The piece': 'Das Stück',
        'What is it called?': 'Wie heißt es?',
        'Title of the piece': 'Titel des Stücks',
        'Subtitle, if it has one': 'Untertitel, falls vorhanden',
        'Venue': 'Spielstätte',
        'The name goes on every sheet you print.':
            'Der Titel steht auf jedem Blatt, das du druckst.',

        'How is the evening divided?': 'Wie ist der Abend gegliedert?',
        'The structure': 'Die Gliederung',
        'Filled': 'Gefüllt',
        'Rename this scene': 'Diese Szene umbenennen',
        'Choose a file': 'Datei wählen',
        'None chosen': 'Keine gewählt',
        'This file comes from a later version of the planner. Anything it knows that this one does not will be dropped.':
            'Diese Datei stammt aus einer neueren Fassung des Planers. Was sie kennt und diese Fassung nicht, geht beim Einspielen verloren.',
        'One act, straight through': 'Ein Akt, durchgehend',
        'Several acts': 'Mehrere Akte',
        'How many acts?': 'Wie viele Akte?',
        'Scene numbering': 'Szenennummerierung',
        'Straight through (1, 2, 3 …)': 'Durchgehend (1, 2, 3 …)',
        'Restart in each act (I.1, I.2, II.1 …)': 'Pro Akt neu (I.1, I.2, II.1 …)',
        'Restart in each act, roman (I.I, I.II, II.I …)': 'Pro Akt neu, römisch (I.I, I.II, II.I …)',

        'The stage': 'Die Bühne',
        'What shape is the playing area?': 'Welche Form hat die Spielfläche?',
        'Measurements': 'Maße',
        'Units': 'Maßeinheit',

        'The places': 'Die Orte',
        'A place is a set that comes back — the kitchen, the market, the café. Name them now and every scene can simply pick one.':
            'Ein Ort ist ein Bühnenbild, das wiederkehrt: die Küche, der Markt, das Café. Benenne sie jetzt, dann wählt jede Szene einfach einen aus.',
        'One place per line': 'Ein Ort pro Zeile',
        'You can add places later, and a scene never has to have one.':
            'Orte lassen sich später ergänzen, und keine Szene muss einen haben.',

        'The scenes': 'Die Szenen',
        'How many scenes are there?': 'Wie viele Szenen gibt es?',
        'Empty scenes are created now and you fill them in as you go.':
            'Die Szenen werden jetzt leer angelegt und nach und nach gefüllt.',
        'Scenes in act {n}': 'Szenen in Akt {n}',

        'Ready': 'Fertig',
        'From here you drag props onto the stage, scene by scene. The tool works out what has to be carried between them and prints it as an Umbauplan.':
            'Von hier ziehst du Requisiten auf die Bühne, Szene für Szene. Der Planer rechnet aus, was dazwischen getragen werden muss, und druckt es als Umbauplan.',
        'Nothing is placed for you — the stage starts empty, exactly as you left it.':
            'Nichts wird für dich hingestellt. Die Bühne bleibt leer, genau wie du sie verlässt.',
        'Take me to the first scene': 'Zur ersten Szene',

        /* ----------------------------------------------------- Running order */
        'Running order': 'Ablauf',
        'Add act': 'Akt hinzufügen',
        'Group the following scenes into a new act':
            'Die folgenden Szenen zu einem neuen Akt zusammenfassen',
        'Add scene': 'Szene hinzufügen',
        'Scene': 'Szene',
        'Act': 'Akt',
        'Act {n}': 'Akt {n}',
        'Untitled scene': 'Unbenannte Szene',
        'Untitled production': 'Unbenannte Produktion',
        'Scene title': 'Szenentitel',
        'Duplicate': 'Duplizieren',
        'No scenes yet.': 'Noch keine Szenen.',
        'Or open a worked example': 'Oder ein Beispiel öffnen',
        'Open an example': 'Beispiel öffnen',

        /* ------------------------------------------------------------ Canvas */
        'Zoom in': 'Vergrößern',
        'Zoom out': 'Verkleinern',
        'Fit': 'Einpassen',
        'Fit the stage in the window': 'Bühne ins Fenster einpassen',
        'Snap': 'Raster',
        'Snap positions to the grid': 'Positionen am Raster ausrichten',
        'Plan labels': 'Beschriftung im Plan',
        'Prop names': 'Requisitennamen',
        'Written labels only': 'Nur eigene Beschriftung',
        'Name and label': 'Name und Beschriftung',
        'No labels': 'Ohne Beschriftung',
        'Previous scene': 'Vorige Szene',
        'Show where things stood in the previous scene':
            'Zeigen, wo die Dinge in der vorigen Szene standen',
        'Copy layout from…': 'Aufbau übernehmen von …',
        'Mirror': 'Spiegeln',
        'Flip the whole layout across the centre line':
            'Den ganzen Aufbau an der Mittelachse spiegeln',
        'Presets': 'Vorlagen',
        'Drag a prop onto the stage, or click it to drop one in the middle.':
            'Zieh ein Requisit auf die Bühne oder klick es an, um es in die Mitte zu setzen.',
        'Search props': 'Requisiten suchen',
        'Prop category': 'Kategorie',
        'Props': 'Requisiten',
        'Selection': 'Auswahl',
        'Inspector': 'Werkzeuge',

        /* --------------------------------------------------------- Stage tab */
        'Width': 'Breite',
        'Depth': 'Tiefe',
        'Back width': 'Breite hinten',
        'Diameter': 'Durchmesser',
        'Sides': 'Seiten',
        'Apron width': 'Breite der Vorbühne',
        'Apron depth': 'Tiefe der Vorbühne',
        'Show the floor grid': 'Bodenraster zeigen',
        'Centre line': 'Mittelachse',
        'Setting line': 'Bauflucht',
        'Scale bar': 'Maßstab',
        'Curtains': 'Vorhänge',
        'Add a curtain': 'Vorhang hinzufügen',
        'Curtain': 'Vorhang',
        'House curtain': 'Hauptvorhang',
        'open': 'offen',
        'half': 'halb',
        'closed': 'zu',
        'Open': 'Offen',
        'Half': 'Halb',
        'Closed': 'Zu',
        'Half open': 'Halb offen',

        /* -------------------------------------------------------- Places tab */
        'Add a place': 'Ort hinzufügen',
        'Place': 'Ort',
        'No place': 'Kein Ort',
        'Name of the place': 'Name des Orts',
        'Used in {n} scenes': 'In {n} Szenen',
        'Used in 1 scene': 'In 1 Szene',
        'Not used yet': 'Noch nicht verwendet',
        'Standing props': 'Feste Requisiten',
        'Scenes keep their props; they simply lose the place.':
            'Die Szenen behalten ihre Requisiten, sie verlieren nur den Ort.',
        'No places yet.': 'Noch keine Orte.',

        /* --------------------------------------------------------- Props tab */
        'Search the library': 'Requisiten durchsuchen',
        'Filter by category': 'Nach Kategorie filtern',
        'Add your own prop': 'Eigenes Requisit hinzufügen',
        'Name': 'Name',
        'Category': 'Kategorie',
        'Drawing': 'Zeichnung',

        /* --------------------------------------------------------- Selection */
        'Position': 'Position',
        'Rotation': 'Drehung',
        'Size': 'Größe',
        'Label': 'Beschriftung',
        'Note': 'Notiz',
        'Lock': 'Sperren',
        'Locked': 'Gesperrt',
        'Flip': 'Umdrehen',
        'Space evenly': 'Gleichmäßig verteilen',
        'Copy': 'Kopie',
        'Handbook': 'Handbuch',
        'What are you looking for?': 'Wonach suchst du?',
        'Nothing under that word.': 'Unter dem Wort steht nichts.',
        'Read the whole manual': 'Ganzes Handbuch öffnen',
        'Search the manual (Ctrl+K)': 'Handbuch durchsuchen (Strg+K)',
        'You will find \u201c{what}\u201d here: {where}':
            'Wo „{what}“ steht: {where}',
        '\u201c{what}\u201d could not be found on screen.':
            '„{what}“ ist gerade nicht auf dem Schirm.',
        'Drag the dots to change a measurement. Hold Shift for finer steps.':
            'Die Punkte im Bild lassen sich ziehen. Shift für feinere Schritte.',
        'This scene already starts an act.': 'Diese Szene beginnt schon einen Akt.',
        'Add a scene first.': 'Leg zuerst eine Szene an.',
        'Side table': 'Kaffeetisch',
        'Shift finer · Alt free': 'Shift feiner · Alt frei',
        'Shift 5° · Alt free': 'Shift 5° · Alt frei',
        'Drag to move · Shift adds to the selection': 'Ziehen verschiebt · Shift wählt dazu',
        'Space or middle mouse pans · wheel zooms': 'Leertaste oder mittlere Maustaste schiebt · Rad zoomt',
        'Mirror it across the centre line': 'Dabei an der Mittelachse spiegeln',
        'Measured upstage from the setting line. Each scene can open or close them on its own.':
            'Gemessen von der Bauflucht nach hinten. Ob ein Vorhang offen oder zu ist, entscheidet jede Szene für sich.',
        '1 prop copied.': '1 Requisit kopiert.',
        '{n} props copied.': '{n} Requisiten kopiert.',
        'Kitchen\nMarket\nCafé': 'Schule\nMarkt\nWohnzimmer\nPark\nCafé',
                'Sets that come back through the evening. Each scene plays in one place.':
            'Bühnenbilder, die im Lauf des Abends wiederkommen. Jede Szene spielt an einem Ort.',
                'Choose a drawing first.': 'Wähle zuerst eine Zeichnung.',
        'The set': 'Das Bühnenbild',
        'Insert this place’s set': 'Bühnenbild dieses Orts einsetzen',
        'Update the place from this scene': 'Ort aus dieser Szene aktualisieren',
        'Match this scene to the place': 'Szene an den Ort angleichen',
        'No set yet': 'Noch kein Bühnenbild',
        'Arrange a scene, then update the place from it.':
            'Richte eine Szene ein und aktualisiere den Ort daraus.',
        'This scene matches its place.': 'Diese Szene stimmt mit ihrem Ort überein.',
        '1 thing differs from the place': '1 Sache weicht vom Ort ab',
        '{n} things differ from the place': '{n} Sachen weichen vom Ort ab',
        'The scene always wins — nothing here is changed behind your back.':
            'Die Szene gewinnt immer. Hier wird nichts hinter deinem Rücken geändert.',
        '1 scene differs': '1 Szene weicht ab',
        '{n} scenes differ': '{n} Szenen weichen ab',
        'All scenes match': 'Alle Szenen stimmen überein',
        'Set taken from this scene.': 'Bühnenbild aus dieser Szene übernommen.',
        'The place loses {list}.': 'Der Ort verliert {list}.',
        'The place loses all {n}.': 'Der Ort verliert alle {n}.',
        'Carry on?': 'Trotzdem?',
        'Set inserted.': 'Bühnenbild eingesetzt.',
        'This scene has no place yet.': 'Diese Szene hat noch keinen Ort.',
        'Act added, with 1 scene in it.': 'Akt angelegt, mit 1 Szene darin.',
        'Act added, with {n} scenes in it.': 'Akt angelegt, mit {n} Szenen darin.',
        'Act added. It is empty for now.': 'Akt angelegt. Er ist vorerst leer.',
        'Got it': 'Verstanden',
        'Turn these introductions off': 'Alle abschalten',
        'Show the introductions again': 'Einführungen wieder einschalten',
        'The short panel that appears the first time you open each section.':
            'Der kurze Streifen, der beim ersten Öffnen jedes Bereichs erscheint.',
        'Draw the curtains': 'Vorhänge zeichnen',
        'Help': 'Hilfe',
        'Help and setup': 'Hilfe und Einrichtung',
        'Start over with a new production': 'Neues Stück Schritt für Schritt einrichten',
        'Walks you through the piece, the stage, the acts, the scenes and the places, and leaves a fresh production behind. What you have now stays untouched.':
            'Führt durch Stück, Bühne, Akte, Szenen und Orte und legt danach eine neue Produktion an. Was du jetzt hast, bleibt unberührt.',
        'Show the opening question again': 'Die Eingangsfrage noch einmal zeigen',
        'The one you saw the very first time — set up a production, or open the example.':
            'Die Frage vom allerersten Mal: Produktion einrichten oder Beispiel öffnen.',
        'Open the worked example': 'Beispiel öffnen',
        'A finished production to pull apart. It is added alongside what you have.':
            'Eine fertige Produktion zum Auseinandernehmen. Sie kommt zu dem dazu, was du schon hast.',
        'Every setting has a ? beside it. It says what the setting does on the printed sheet.':
            'Neben jeder Einstellung steht ein ?. Es sagt, was sie auf dem gedruckten Blatt bewirkt.',
        'Where things live': 'Wo was steckt',
        'Scene numbering and the direction convention are under Settings, next to the production name. The stage shape, the grid, the wings and the curtains are on the Stage tab.':
            'Szenennummerierung und Richtungssicht stehen unter „Einstellungen“, neben dem Namen der Produktion. Bühnenform, Maße, Raster, Gassen und Vorhänge stehen im Reiter „Bühne“.',
        'A play in two acts, for trying things out': 'Ein Stück in zwei Akten, zum Ausprobieren',
        'School hall': 'Aula',
        'Before the interval': 'Vor der Pause',
        'After the interval': 'Nach der Pause',
        'The school': 'Die Schule',
        'The market': 'Der Markt',
        'The living room': 'Das Wohnzimmer',
        'The park': 'Der Park',
        'The café': 'Das Café',
        'School': 'Schule',
        'Market': 'Markt',
        'Living room': 'Wohnzimmer',
        'Park': 'Park',
        'Café': 'Café',
        '4 chairs, board, desk, sponge, chalk': '4 Stühle, Tafel, Tisch, Schwamm, Stift',
        'Market stall, crate': 'Händlerstand, Kiste',
        'Table, cloth, 2 chairs, coat stand, side table with picture':
            'Tisch, Tischdecke, 2 Stühle, Kleiderständer, Kaffeetisch mit Bild',
        'Bench, bin': 'Bank, Mülleimer',
        'Table, 3 chairs, mugs, pot, menu': 'Tisch, 3 Stühle, Tassen, Kanne, Karte',
        'The board is set before the house opens.': 'Die Tafel steht vor dem Einlass.',
        'Crate stays in the right wing for later.': 'Kiste bleibt rechts in der Gasse für später.',
        'Strike the whole room during the interval.': 'Den ganzen Raum in der Pause abbauen.',
        'A mug with a mouthful of water in it': 'Kaffeetasse mit einem Schluck Wasser',
        'Anna’s chair': 'Annas Stuhl',
        'Centre line and setting line': 'Mittelachse und Bauflucht',
        'Where the audience sits': 'Wo das Publikum sitzt',
        'Title beside the number': 'Titel neben der Nummer',
        'Footer on every sheet': 'Fußzeile auf jedem Blatt',
        'Number only, beside the stage': 'Nur die Nummer, neben der Bühne',
        'Wing notes': 'Gassenzettel',
        'Add a wing note': 'Gassenzettel hinzufügen',
        'What has to be ready': 'Was bereitliegen muss',
        'Which side': 'Welche Seite',
        'Left wing': 'Linke Gasse',
        'Right wing': 'Rechte Gasse',
        'Drawing to show': 'Zeichnung dazu',
        'No drawing': 'Ohne Zeichnung',
        'This stage shape has no wings to stand in.':
            'Diese Bühnenform hat keine Gassen, in denen ein Zettel stehen könnte.',
        /* --------------------------------------------- neue Requisiten */
        'Sofa': 'Sofa',
        'Dining table': 'Esstisch',
        'Round table': 'Runder Tisch',
        'Rug': 'Teppich',
        'Folding screen': 'Paravent',
        'Upright piano': 'Klavier',
        'Grand piano': 'Flügel',

        'Drag to widen the panel': 'Ziehen ändert die Breite der Spalte',
        'Text in the field': 'Text im Feld',
        'e.g. Sofa goes off here': 'z. B. Sofa geht hier ab',
        'This is what stands in the field, on screen and on paper. Empty prints as an empty field.':
            'Das steht im Feld, am Bildschirm wie auf dem Papier. Leer druckt ein leeres Feld.',
        'This is what stands in the field, on screen and on paper. Every line break is one on the plan, and the letters grow to fill the field. Empty prints as an empty field.':
            'Das steht im Feld, am Bildschirm wie auf dem Papier. Jeder Zeilenumbruch ist auch auf dem Plan einer, und die Schrift wächst mit, bis sie das Feld füllt. Leer druckt ein leeres Feld.',

        /* ------------------------------------------------------------ *
         * Bauvorschriften
         *
         * Die Werte, die eine Bauvorschrift selbst nennt. Sie stehen im
         * Quelltext englisch, weil sie dort neben der Rechnung stehen, die
         * sie steuern; hier bekommen sie das Wort, das eine Bühnencrew
         * benutzt.
         * ------------------------------------------------------------ */
        /* ------------------------------------------------------------ *
         * Rückmeldung
         * ------------------------------------------------------------ */
        'Say something': 'Rückmeldung',
        'Suggest a prop or report a fault': 'Ein Requisit vorschlagen oder einen Fehler melden',
        'Something missing? Say so.': 'Fehlt etwas? Sag Bescheid.',
        'Suggest a prop': 'Ein Requisit vorschlagen',
        'Suggest “{word}”': '„{word}“ vorschlagen',
        'A prop is missing': 'Ein Requisit fehlt',
        'Something is broken': 'Etwas geht nicht',
        'Your e-mail, only if you want an answer': 'Deine Mailadresse, nur falls du eine Antwort willst',
        'Leave it empty and stay anonymous': 'Leer lassen und anonym bleiben',
        'Sent with it: which tab was open, how wide the window is and which browser. No names, nothing out of your production.':
            'Mitgeschickt wird: welcher Reiter offen war, wie breit das Fenster ist und welcher Browser. Keine Namen, nichts aus deiner Produktion.',
        'e.g. A hospital bed on castors, about 1.00 × 2.10 m': 'z. B. Ein Krankenbett auf Rollen, etwa 1,00 × 2,10 m',
        'e.g. The door swings the wrong way after I mirror the scene': 'z. B. Die Tür schlägt falsch herum auf, nachdem ich die Szene gespiegelt habe',
        'Whatever it is. A sentence is enough.': 'Was auch immer. Ein Satz reicht.',
        'Send': 'Abschicken',
        'Thank you — it is on its way.': 'Danke — ist unterwegs.',
        'That did not go through. Is there a connection?': 'Das ist nicht durchgegangen. Steht die Verbindung?',
        'Tab': 'Reiter',
        'Window': 'Fenster',
        'Props on the stage': 'Requisiten auf der Bühne',
        'Language': 'Sprache',

        /* Was auf der Bühne gilt — und dass im Auswahl-Bereich nichts gilt. */
        'On the stage this drawing keeps its proportion. Here the second edge follows along.':
            'Auf der Bühne behält die Zeichnung ihr Verhältnis. Hier zieht die zweite Kante mit.',
        'On the stage this stays square. Here you can write any two numbers.':
            'Auf der Bühne bleibt es quadratisch. Hier kannst du zwei beliebige Zahlen eintragen.',
        'On the stage you can only pull this one wider. Here you can write any two numbers.':
            'Auf der Bühne lässt sich das nur in die Breite ziehen. Hier kannst du zwei beliebige Zahlen eintragen.',
        'This comes in one size, so the stage will not let you pull it. Here you can write any two numbers.':
            'Das gibt es nur in einer Größe, deshalb lässt die Bühne es nicht ziehen. Hier kannst du zwei beliebige Zahlen eintragen.',
        'The depth is what the leaf sweeps, so it follows the width by itself.':
            'Die Tiefe ist der Schwenkbereich des Flügels und folgt deshalb von selbst der Breite.',
        'The depth follows the width · Alt frees it': 'Die Tiefe folgt der Breite · Alt löst sie',
        'Both edges free': 'Beide Kanten frei',
        'Ctrl keeps the shape': 'Strg hält die Form',
        'Keeps its proportion · Alt frees the edges': 'Behält sein Verhältnis · Alt löst die Kanten',
        'Stays square · Alt frees the edges': 'Bleibt quadratisch · Alt löst die Kanten',
        'Only the width · Alt frees the depth': 'Nur die Breite · Alt löst die Tiefe',
        'Only the length · Alt frees the width': 'Nur die Länge · Alt löst die Breite',
        'On the stage you can only pull this one longer. Here you can write any two numbers.':
            'Auf der Bühne lässt sich das nur in die Länge ziehen. Hier kannst du zwei beliebige Zahlen eintragen.',
        'This one comes in one size · Alt drags it anyway': 'Gibt es nur in einer Größe · Alt zieht trotzdem',
        'Alt frees the edges': 'Alt löst die Kanten',

        'This one is drawn from the side, so you can tell what it is. \u201cDeep\u201d is the height of the picture here, not the floor it stands on.':
            'Dieses Stück ist von der Seite gezeichnet, damit man es erkennt. „Tief“ ist hier die Höhe des Bildes, nicht die Standfläche.',

        'Break the table here…': 'Tabelle hier unterbrechen …',
        'Back-up': 'Back-up',
        'The planner keeps everything in this browser and uploads nothing. Back-up writes a file with all of it, to bring along or to put back.':
            'Der Planer behält alles in diesem Browser und lädt nichts hoch. „Back-up“ schreibt eine Datei mit allem darin — zum Mitnehmen oder zum Wiedereinspielen.',
        'Applies to every scene in this production.': 'Gilt für jede Szene dieser Produktion.',
        'These only print while the wings are marked on the Stage tab.':
            'Die werden nur gedruckt, solange im Bühne-Reiter Gassen eingezeichnet sind.',
        'Something waiting in this wing': 'Etwas, das in dieser Gasse bereitliegt',
        '1 more, no room here': 'noch 1, kein Platz mehr',
        '{n} more, no room here': 'noch {n}, kein Platz mehr',
        '1 thing waiting in this wing': '1 Zettel in dieser Gasse',
        '{n} things waiting in this wing': '{n} Zettel in dieser Gasse',
        'With the wings marked you can put notes in them on the plan — for anything that has to be standing by without being on stage.':
            'Mit eingezeichneten Gassen kannst du im Plan Zettel hineinstellen — für alles, was bereitliegen muss, ohne auf der Bühne zu stehen.',
        'Throw this drawing away?': 'Diese Zeichnung verwerfen?',
        'All 1 scene at a glance': 'Das eine Bühnenbild auf einen Blick',
        'All {n} scenes at a glance': 'Alle {n} Bühnenbilder auf einen Blick',
        'Give it a real width, above 5 cm.': 'Trag eine wirkliche Breite ein, über 5 cm.',
        'Follows the width and the drawing': 'Folgt der Breite und der Zeichnung',
        'The depth follows the width, so the drawing keeps its shape.':
            'Die Tiefe folgt der Breite, damit die Zeichnung ihre Form behält.',
        '{typed} is too small — kept at {least}.':
            '{typed} ist zu klein — bleibt bei {least}.',
        '{typed} is too large — kept at {most}.':
            '{typed} ist zu groß — bleibt bei {most}.',
        'Where and how big': 'Wo und wie groß',
        'Back from the front': 'Hinten',
        'Turned (°)': 'Gedreht (°)',
        'Wide': 'Breit',
        'Order, copies, catalogue size': 'Reihenfolge, Kopien, Katalogmaß',
        'Everything else': 'Alles Weitere',
        'What stands on the scene sheet': 'Was auf dem Szenenblatt steht',
        'All the scenes on one sheet': 'Alle Szenen auf ein Blatt',
        'Do nothing': 'Nichts tun',
        'Add them alongside': 'Dazunehmen',
        'Replace everything': 'Alles ersetzen',
        'Delete everything in this browser and put the backup in its place?':
            'Alles in diesem Browser löschen und das Back-up an seine Stelle setzen?',
        'The file holds 1 production:': 'In der Datei steht 1 Produktion:',
        'The file holds {n} productions:': 'In der Datei stehen {n} Produktionen:',
        'You have 1 production open. Adding leaves it alone; replacing deletes it.':
            'Du hast 1 Produktion offen. Dazunehmen lässt sie stehen, Ersetzen löscht sie.',
        'You have {n} productions open. Adding leaves them alone; replacing deletes them.':
            'Du hast {n} Produktionen offen. Dazunehmen lässt sie stehen, Ersetzen löscht sie.',
        'Waiting in the left wing': 'Bereit in der linken Gasse',
        'Waiting in the right wing': 'Bereit in der rechten Gasse',
        'Nothing waiting in this wing yet.': 'In dieser Gasse liegt noch nichts bereit.',
        'Choose a drawing': 'Zeichnung wählen',
        'Move up': 'Nach oben',
        'Move down': 'Nach unten',
        'Water glass': 'Wasserglas',
        'Wine glass': 'Weinglas',
        'After this changeover': 'Nach diesem Umbau',
        'Kept what you had typed. Carry on setting up whenever you like.':
            'Was du eingetragen hattest, ist gesichert. Einrichten kannst du später weiter.',

        'How this one is built': 'Wie dieses Stück gebaut ist',
        'Across from centre': 'Quer von der Mitte',
        'Upstage of setting line': 'Hinter der Bauflucht',
        'Deep': 'Tief',

        'Arm width': 'Armlehne breit',
        'Back depth': 'Lehne tief',
        'Corner radius': 'Ecken gerundet',
        'Show the seat cushion': 'Sitzkissen zeigen',
        'Boards in the seat': 'Latten im Sitz',
        'Gap between the boards': 'Fuge zwischen den Latten',
        'With a backrest': 'Mit Rückenlehne',
        'Depth of the backrest': 'Rückenlehne tief',
        'Backrest stands out by': 'Lehne steht hinten über',
        'Legs set in from the end': 'Beine eingerückt vom Ende',
        'Leg mark': 'Beinmarke',
        'With a tablecloth': 'Mit Tischdecke',
        'Size of one square': 'Karo, Kantenlänge',
        'On a single foot': 'Auf einem Mittelfuß',
        'Pillow depth': 'Kissen tief',
        'Two pillows from this width on': 'Zwei Kissen ab dieser Breite',
        'Turn-down line': 'Decke aufgeschlagen',
        'Width of one panel': 'Ein Flügel breit',
        'Opening angle': 'Öffnungswinkel',
        'Hinged on the right': 'Anschlag rechts',
        'Width of one jamb': 'Zarge breit',
        'Oval instead of rectangular': 'Oval statt eckig',
        'Length of the fringe': 'Fransen lang',
        'Space between the threads': 'Abstand der Fäden',
        'Border inside the edge': 'Borte innen',
        'Border set in by': 'Borte eingerückt um',
        'Depth of the keyboard': 'Klaviatur tief',
        'Key spacing on the plan': 'Tastenabstand im Plan',
        'Draw the black keys': 'Schwarze Tasten zeichnen',
        'Space between the rungs': 'Sprossenabstand',
        'Width of a stile': 'Holm breit',
        'Taper towards the tip': 'Zur Spitze verjüngt',
        'Rounded ends': 'Enden gerundet',
        'Print the border': 'Rand mitdrucken',
        'Air around the text': 'Luft um den Text',
        'Letters at most this high': 'Buchstaben höchstens so hoch',
        'Wings': 'Gassen',
        'Mark the wings': 'Gassen einzeichnen',
        'Inset from the side': 'Abstand von der Seite',
        'How far forward': 'Wie weit nach vorne',
        'replace what is here': 'ersetzt, was hier steht',
        'add to what is here': 'kommt zu dem dazu, was hier steht',
        'replace the layout': 'ersetzt den Aufbau dort',
        'add these props to it': 'kommt dort dazu',
        'Add it': 'Hinzufügen',
        '1 drawing added. It sits alongside the built-in ones in every production in this browser.':
            '1 eigene Zeichnung. Sie steht in jeder Produktion dieses Browsers neben den mitgelieferten.',
        '{n} drawings added. They sit alongside the built-in ones in every production in this browser.':
            '{n} eigene Zeichnungen. Sie stehen in jeder Produktion dieses Browsers neben den mitgelieferten.',
        'Bare stage. Drag a prop in from the right to start.':
            'Leere Bühne. Zieh zum Anfangen ein Requisit von rechts herüber.',
        '1 prop': '1 Requisit',
        '{n} props': '{n} Requisiten',
        '{title} ({n} props)': '{title} ({n} Requisiten)',
        'curtain state open': 'offen',
        'curtain state half': 'halb offen',
        'Include the place': 'Ort mitdrucken',
        'Scene {label}': 'Szene {label}',
        'Across ({unit})': 'Quer ({unit})',
        'Deep ({unit})': 'Tief ({unit})',
        'Draw a grid on the floor': 'Raster auf den Boden zeichnen',
        'Letter and number the squares': 'Felder mit Buchstaben und Zahlen versehen',
        '{n} changes': '{n} Änderungen',
        '1 change': '1 Änderung',
        '1 prop sits outside the stage outline': '1 Requisit steht außerhalb der Bühne',
        '{n} props sit outside the stage outline': '{n} Requisiten stehen außerhalb der Bühne',
        '{n} props selected': '{n} Requisiten ausgewählt',
        '1 prop selected': '1 Requisit ausgewählt',
        'square {ref}': 'Feld {ref}',
        '{n} sheets of A4': '{n} Blatt A4',
        ', which is a thick pile': ', ein ordentlicher Stapel',
        'No scene selected. Add one on the left to start placing props.':
            'Keine Szene ausgewählt. Leg links eine an, um Requisiten zu stellen.',
        'This is the first scene, so everything here is a preset before the house opens.':
            'Das ist die erste Szene. Alles hier gehört zum Grundaufbau vor dem Einlass.',
        '{label} (worked out automatically)': '{label} (automatisch ermittelt)',
        '{title} (copy)': '{title} (Kopie)',
        'Delete “{title}” and its {n} props?': '„{title}“ mit {n} Requisiten löschen?',
        'Delete “{title}” and the one prop in it?': '„{title}“ mit dem einen Requisit darin löschen?',
        'Delete scene {label} and the one prop in it?': 'Szene {label} mit dem einen Requisit darin löschen?',
        '{title} (one prop)': '{title} (ein Requisit)',
        '{cols} by {rows}, one scene': '{cols} × {rows}, eine Szene',
        'Delete “{name}” with its one scene?': '„{name}“ mit seiner einen Szene löschen?',
        'This prop stands in one place across all your productions. Deleting it leaves that place empty. Carry on?':
            'Dieses Requisit steht an einer Stelle über alle deine Produktionen. Beim Löschen bleibt diese Stelle leer. Trotzdem löschen?',
        'Delete scene {label} and its {n} props?': 'Szene {label} mit {n} Requisiten löschen?',
        'this scene': 'diese Szene',
        'Props keep their identity, so the change list will say “moved” rather than “struck and brought back on”.':
            'Requisiten behalten ihre Identität. Im Umbauplan steht dann „umgestellt“ statt „abgebaut und wieder aufgebaut“.',
        'Copy the layout': 'Aufbau übernehmen',
        'Layout copied into {n} scenes.': 'Aufbau in {n} Szenen übernommen.',
        'Layout copied into 1 scene.': 'Aufbau in 1 Szene übernommen.',
        'Carry this prop into later scenes': 'Dieses Requisit in spätere Szenen übernehmen',
        'Carry these props into later scenes': 'Diese Requisiten in spätere Szenen übernehmen',
        'Carry it over': 'Übernehmen',
        'Delete the act': 'Akt löschen',
        'The playing area comes out {w} across by {h} deep.':
            'Die Spielfläche misst {w} in der Breite und {h} in der Tiefe.',
        'Lettered squares give the crew something to call out: “the trunk goes in C4”.':
            'Beschriftete Felder geben der Mannschaft etwas zum Zurufen: „die Truhe kommt auf C4“.',
        'used {n}×': '{n}× verwendet',
        'not used yet': 'noch nicht verwendet',
        'Nothing added yet. A PNG, JPEG or SVG works.':
            'Noch nichts hinzugefügt. PNG, JPEG oder SVG geht.',
        'Draw it seen from straight above. The size fields below set the size on the plan.':
            'Zeichne so, dass die Mannschaft erkennt, was es sein soll — größere Sachen, auf denen etwas stehen kann, von oben; Kleinkram lieber von der Seite. Die Maßfelder darunter bestimmen die Größe im Plan.',
        'Everything you have made takes about {size}. Browsers usually stop somewhere around 5 MB, so keep custom drawings small and take a backup from time to time.':
            'Alles Angelegte belegt etwa {size}. Browser machen meist bei rund 5 MB Schluss. Halte eigene Zeichnungen also klein und sichere ab und zu.',
        'Edit prop': 'Requisit bearbeiten',
        'Add a prop of your own': 'Eigenes Requisit hinzufügen',
        'This prop stands in {n} places across all your productions. Deleting it leaves those places empty. Carry on?':
            'Dieses Requisit steht in {n} Aufstellungen über alle deine Produktionen. Beim Löschen bleiben diese Stellen leer. Trotzdem löschen?',
        'Delete this prop?': 'Dieses Requisit löschen?',
        'Delete “{name}” with its {n} scenes?': '„{name}“ mit {n} Szenen löschen?',
        'Backup saved to your downloads.': 'Back-up in deinen Downloads gespeichert.',
        'Turned {n}°': '{n}° gedreht',
        'Useful for a set that comes back later in the evening. Tick the scenes that should look like this one.':
            'Nützlich für ein Bühnenbild, das später wiederkommt. Hak die Szenen an, die so aussehen sollen.',
        'The same prop, in the same spot. It keeps its identity, so it will not show up as struck and brought back.':
            'Dasselbe Requisit, an derselben Stelle. Es behält seine Identität und taucht darum nicht als abgebaut und neu aufgebaut auf.',
        'Pictures are scaled down to 480 pixels and stored in this browser. A transparent background keeps the plan readable.':
            'Bilder werden auf 480 Pixel verkleinert und in diesem Browser abgelegt. Ein durchsichtiger Hintergrund hält den Plan lesbar.',
        'Mirror it': 'Dabei spiegeln',
        'yours': 'eigenes',
        'no change': 'keine Änderung',
        'preset': 'Grundaufbau',
        'e.g. Anna’s chair': 'z. B. Annas Stuhl',
        'Squares are ({unit})': 'Felder sind ({unit}) groß',
        'Across from centre ({unit})': 'Quer von der Mitte ({unit})',
        'Upstage of setting line ({unit})': 'Hinter der Bauflucht ({unit})',
        'Upstage ({unit})': 'Nach hinten ({unit})',
        'Comes on from stage right': 'Kommt von rechts herein',
        'Curtain name': 'Name des Vorhangs',
        'Delete this scene': 'Diese Szene löschen',
        'Distance upstage': 'Abstand nach hinten',
        'Draft 3, please recycle': 'Fassung 3, bitte entsorgen',
        'Grandfather clock': 'Standuhr',
        'Rename this act': 'Akt umbenennen',
        'Tea things preset. Fire lit.': 'Teegeschirr vorbereitet. Kamin brennt.',
        'And': 'Und dabei',
        'Preset': 'Vorlage',
        'Duplicate this scene': 'Diese Szene duplizieren',
        'Bring forward': 'Nach vorne',
        'Nothing selected': 'Nichts ausgewählt',
        'Click a prop on the stage, or drag a box around several.':
            'Klick ein Requisit auf der Bühne an oder zieh einen Rahmen um mehrere.',

        /* ------------------------------------------------------ Scene panel */
        'Bare stage': 'Leere Bühne',
        'Bring on': 'Aufbau',
        'Strike': 'Abbau',
        'Move': 'Umstellen',
        'Plays in': 'Spielt in',

        /* -------------------------------------------------- Change-over plan */
        'Change-over plan': 'Umbauplan',
        'Umbauplan': 'Umbauplan',
        'Transition': 'Übergang',
        'For reference': 'Zur Referenz',
        'The plan gives more': 'Die Skizze gibt mehr her',
        'Before the show': 'Vor der Vorstellung',
        'INTERVAL': 'PAUSE',
        'Break the table here': 'Tabelle hier unterbrechen',
        'Banner text': 'Text im Balken',
        'Line underneath': 'Zeile darunter',
        'Notes for this change': 'Hinweise zu diesem Umbau',
        'Mark this change as critical': 'Diesen Umbau als kritisch markieren',
        'Hold ready': 'Bereithalten',

        /* ------------------------------------------------------------- Print */
        'A4 sheets, straight from the browser. Choose “Save as PDF” in the print dialogue if you would rather send a file than carry paper.':
            'A4 direkt aus dem Browser. Wähle im Druckdialog „Als PDF sichern“, wenn du lieber eine Datei verschickst als Papier trägst.',
        'The plans': 'Die Pläne',
        'One scene to a sheet.':
            'Eine Szene pro Blatt.',
        'The Umbauplan': 'Der Umbauplan',
        'The table for every changeover.':
            'Die Tabelle für jeden Umbau.',
        'Print the plans': 'Pläne drucken',
        'Print the Umbauplan': 'Umbauplan drucken',
        'Paper': 'Papier',
        'A4 upright': 'A4 hoch',
        'A4 on its side': 'A4 quer',
        'Which scenes': 'Welche Szenen',
        'The whole production': 'Die ganze Produktion',
        '{act} only': 'Nur {act}',
        'Footer line': 'Fußzeile',
        'Sheets to print': 'Blätter',
        'Title sheet': 'Titelblatt',
        'A divider before each act': 'Trennblatt vor jedem Akt',
        'One sheet per scene': 'Ein Blatt pro Szene',
        'Overview sheets': 'Übersichtsblätter',
        'Prop inventory': 'Requisitenliste',
        'Scenes to a sheet': 'Szenen pro Blatt',
        '{cols} by {rows}, {n} scenes': '{cols} × {rows}, {n} Szenen',
        'Something else': 'Etwas anderes',
        'Across': 'Quer',
        'Down': 'Hoch',
        'Start a fresh sheet for each act': 'Für jeden Akt ein neues Blatt beginnen',
        'In the print dialogue: margins to none, background graphics on.':
            'Im Druckdialog: Ränder auf „keine“, Hintergrundgrafiken an.',
        '{n} sheets': '{n} Blätter',
        '1 sheet': '1 Blatt',
        '1 sheet of A4': '1 Blatt A4',
        'Nothing to print yet': 'Noch nichts zu drucken',
        'Include the reference box': 'Referenzkasten mitdrucken',
        'Include positions in the table': 'Positionen in der Tabelle',
        'Page {n} of {total}': 'Seite {n} von {total}',
        'Drawn': 'Stand',
        'Distinct props': 'Verschiedene Requisiten',
        'Most at once': 'Höchstens gleichzeitig',
        'Appears in': 'Kommt vor in',
        'Every prop used, and the most needed at any one time':
            'Alle verwendeten Requisiten und wie viele davon höchstens gleichzeitig gebraucht werden',
        'Prop and scene plan': 'Requisiten- und Szenenplan',
        'Scenes in this act': 'Szenen in diesem Akt',
        'Overview': 'Übersicht',
        '{cols} by {rows} overview, sheet {n} of {total}':
            'Übersicht {cols} × {rows}, Blatt {n} von {total}',
        'part {n} of {total}': 'Teil {n} von {total}',

        /* -------------------------------------------------------- Directions */
        'Audience': 'Publikum',
        'Audience on all sides': 'Publikum ringsum',
        'Stage ground plan': 'Bühnengrundriss',
        'left': 'links',
        'right': 'rechts',
        'upstage': 'hinten',
        'downstage': 'vorne',
        'centre': 'Mitte',
        'centre stage': 'Bühnenmitte',
        'to the left': 'nach links',
        'to the right': 'nach rechts',
        'on the centre line': 'auf der Mittelachse',
        'on the setting line': 'auf der Bauflucht',
        '{len} to the left': '{len} nach links',
        '{len} to the right': '{len} nach rechts',
        '{len} upstage': '{len} nach hinten',
        '{len} downstage': '{len} nach vorne',
        'front left': 'vorne links',
        'front right': 'vorne rechts',
        'back left': 'hinten links',
        'back right': 'hinten rechts',
        'front centre': 'vorne Mitte',
        'back centre': 'hinten Mitte',
        'Directions as seen by': 'Richtungen aus Sicht',
        'the audience': 'des Publikums',
        'the cast': 'der Spielenden',


        /* ------------------------------------------------------ Stage shapes */
        'Rectangular': 'Rechteckig',
        'End-on or proscenium. Audience downstage.':
            'Guckkasten oder Frontalbühne. Publikum davor.',
        'Trapezoid': 'Trapez',
        'Narrower upstage than down, or the other way round.':
            'Hinten schmaler als vorne, oder umgekehrt.',
        'Thrust': 'Vorbühne',
        'Main stage plus an apron the audience sits around.':
            'Hauptbühne mit Vorbühne, um die das Publikum herumsitzt.',
        'Circular': 'Rund',
        'Round stage, audience on the downstage side.':
            'Runde Bühne, Publikum davor.',
        'Half round': 'Halbrund',
        'Flat upstage wall, curved front edge.':
            'Gerade Wand hinten, runde Kante vorne.',
        'Arena, in the round': 'Arena, Rundumbühne',
        'Round stage with audience on every side.':
            'Runde Bühne, Publikum auf allen Seiten.',
        'Traverse, alley': 'Gasse, Mittelgang',
        'Long playing strip, audience on both long sides.':
            'Langer Spielstreifen, Publikum an beiden Längsseiten.',
        'Polygon': 'Vieleck',
        'Regular polygon with a flat edge facing the audience.':
            'Gleichmäßiges Vieleck mit gerader Kante zum Publikum.',

        /* --------------------------------------------------- Prop categories */
        'Tables': 'Tische',
        'Furniture': 'Möbel',
        'Set pieces': 'Bühnenbild',
        'Tableware': 'Geschirr',
        'Small props': 'Kleinrequisiten',
        'Technical': 'Technik',

        'Seating': 'Sitzmöbel',
        'Tables & desks': 'Tische',
        'Storage': 'Stauraum',
        'Beds & soft furnishing': 'Betten und Textilien',
        'Structure': 'Aufbauten',
        'Planting & landscape': 'Pflanzen und Landschaft',
        'Light & sound': 'Licht und Ton',
        'Objects': 'Gegenstände',
        'Marks & notes': 'Markierungen',

        /* ------------------------------------------------ Illustrationen */
        'Blackboard': 'Tafel',
        'School chair': 'Stuhl',
        'Crate': 'Kiste',
        'Coat stand': 'Kleiderständer',
        'Typewriter': 'Schreibmaschine',
        'Wine bottle': 'Weinflasche',
        'Bench': 'Bank',
        'Bin': 'Mülleimer',
        'Café chair': 'Caféstuhl',
        'Mug': 'Kaffeetasse',
        'Book': 'Märchenbuch',
        'Three crates': 'Drei Kisten',
        'Table with a cloth': 'Tisch mit Tischdecke',
        'Flat': 'Wand',
        'Folding flats': 'Paravent',
        'Picture on a stand': 'Bild auf Ständer',
        'Sponge': 'Schwamm',
        'Chalk': 'Stift',
        'Menu card': 'Karte',
        'Coffee pot': 'Kännchen',

        /* -------------------------------------------------------- Prop names */
        'Armchair': 'Sessel',
        'Suitcase': 'Koffer',
        'Bed': 'Bett',
        'Doorway': 'Tür',
        'Ladder': 'Leiter',
        'Rock': 'Fels',
        'Speaker': 'Lautsprecher',
        'Music stand': 'Notenständer',
        'Clock': 'Uhr',
        'Spike mark': 'Klebemarke',
        'Move arrow': 'Pfeil',
        'Zone outline': 'Bereich',
        'Label plate': 'Textfeld',
        'Unknown prop': 'Unbekanntes Requisit',

        /* ------------------------------------------- Weitere Oberfläche */
        'Add the first scene': 'Erste Szene anlegen',
        'Back to catalogue size': 'Zurück auf Katalogmaß',
        'Carry into later scenes…': 'In spätere Szenen übernehmen …',
        'Changes from the scene before': 'Änderungen zur Szene davor',
        'Clear the stage': 'Bühne leeren',
        'Copy this layout to other scenes…': 'Diesen Aufbau in andere Szenen kopieren …',
        'Copy this layout to other scenes': 'Diesen Aufbau in andere Szenen kopieren',
        'Copy a layout into this scene': 'Aufbau in diese Szene übernehmen',
        'Copy it over': 'Übernehmen',
        'Curtains in this scene': 'Vorhänge in dieser Szene',
        'Delete this production': 'Diese Produktion löschen',
        'Drawing (PNG, JPEG or SVG)': 'Zeichnung (PNG, JPEG oder SVG)',
        'Drawing your own': 'Eigene Zeichnung',
        'Duplicate this one': 'Diese duplizieren',
        'Edit': 'Bearbeiten',
        'Every category': 'Alle Kategorien',
        'Grid': 'Raster',
        'Guides': 'Hilfslinien',
        'In this selection': 'In dieser Auswahl',
        'In those scenes': 'In diesen Szenen',
        'Labels on the plan': 'Beschriftung im Plan',
        'Layout': 'Aufbau',
        'Line up across': 'Quer ausrichten',
        'Line up upstage': 'Längs ausrichten',
        'No curtain marked.': 'Kein Vorhang eingetragen.',
        'No drawing chosen yet': 'Noch keine Zeichnung gewählt',
        'No scene selected.': 'Keine Szene ausgewählt.',
        'Normally': 'Normal',
        'Not in an act': 'Keinem Akt zugeordnet',
        'Note for the crew': 'Hinweis für die Mannschaft',
        'Notes': 'Notizen',
        'Notes for the divider page': 'Notizen für das Trennblatt',
        'Notes for the title sheet': 'Notizen für das Titelblatt',
        'Nothing changes from the scene before.': 'Nichts ändert sich zur Szene davor.',
        'Nothing matches that search.': 'Nichts passt zu dieser Suche.',
        'Nothing matches that.': 'Nichts passt dazu.',
        'Nothing selected to print.': 'Nichts zum Drucken ausgewählt.',
        'Nothing selected.': 'Nichts ausgewählt.',
        'Number shown on the sheet': 'Nummer auf dem Blatt',
        'Number the scenes': 'Szenen nummerieren',
        'Order and copies': 'Reihenfolge und Kopien',
        'Reads as': 'Liest sich als',
        'Restart in each act, as II.3': 'Pro Akt neu, als II.3',
        'Restart in each act, roman (I.I, I.II …)': 'Pro Akt neu, römisch (I.I, I.II …)',
        'Restore a backup': 'Back-up einspielen',
        'Restore from a backup': 'Aus einem Back-up wiederherstellen',
        'Save this plan as a picture': 'Diesen Plan als Bild sichern',
        'Scene sheets': 'Szenenblätter',
        'Send back': 'Nach hinten',
        'Start another production': 'Weitere Produktion anlegen',
        'Browser storage': 'Speicher im Browser',
        'Straight through, 1 to the end': 'Durchgehend, 1 bis zum Schluss',
        'Subtitle': 'Untertitel',
        'Subtitle, time of day': 'Untertitel, Tageszeit',
        'Take the layout from': 'Aufbau übernehmen von',
        'This production': 'Diese Produktion',
        'Turned (degrees)': 'Drehung (Grad)',
        'Written on the plan': 'Auf dem Plan geschrieben',
        'Your own props': 'Eigene Requisiten',
        'Add another scene first.': 'Lege zuerst eine weitere Szene an.',
        'Backup restored.': 'Back-up eingespielt.',
        'Bare stage. Drag a prop in from the right, or copy the layout from another scene.':
            'Leere Bühne. Zieh ein Requisit von rechts herüber oder übernimm den Aufbau aus einer anderen Szene.',
        'Depth, back wall to setting line': 'Tiefe, Rückwand bis Bauflucht',
        'Example production opened. Delete it whenever you like.':
            'Beispielproduktion geöffnet. Du kannst sie jederzeit löschen.',
        'Number of sides': 'Anzahl der Seiten',
        'Take everything off the stage in this scene?': 'Alles von der Bühne dieser Szene nehmen?',
        'That file could not be read as a picture.': 'Diese Datei ließ sich nicht als Bild lesen.',
        'That file is not a scene plan.': 'Diese Datei ist kein Szenenplan.',
        'The picture could not be made.': 'Das Bild konnte nicht erzeugt werden.',
        'There is only one scene so far.': 'Es gibt bisher nur eine Szene.',
        'This is the last scene.': 'Das ist die letzte Szene.',
        'Width at the back': 'Breite hinten',
        'Width, wall to wall': 'Breite, Wand zu Wand',
        'Include scene notes': 'Notizen zur Szene mitdrucken',
        'This prop is used {n} times': 'Dieses Requisit wird {n}× verwendet',
        'Delete “{name}”?': '„{name}“ löschen?',
        'Traveller {n}': 'Vorhang {n}',

        /* ----------------------------------------------- Beispielstück */
        'The Winter Guest': 'Der Wintergast',
        'A play in two acts': 'Ein Stück in zwei Akten',
        'Act one': 'Erster Akt',
        'Act two': 'Zweiter Akt',
        'Evening, the first frost': 'Abend, der erste Frost',
        'Export a backup': 'Back-up exportieren',
        'This browser will not store any more. Export a backup, then delete an old production or a heavy custom prop.':
            'Dieser Browser speichert nichts mehr. Exportiere ein Back-up und lösche dann eine alte Produktion oder ein großes eigenes Requisit.',
        'Saved plan could not be read, starting fresh.':
            'Der gespeicherte Plan war nicht lesbar, es wird neu begonnen.',

        /* ------------------------------------------------ Requisiten-Zeichner */
        'Draw a prop': 'Requisit zeichnen',
        'Draw your own prop': 'Eigenes Requisit zeichnen',
        'Edit the drawing': 'Zeichnung bearbeiten',
        'Pick': 'Auswählen',
        'Box': 'Rechteck',
        'Round': 'Kreis',
        'Line': 'Linie',
        'Open run': 'Linie mit Ecken',
        'Closed run': 'Geschlossene Form',
        'Line only': 'Nur Linie',
        'Tinted': 'Getönt',
        'Dashed': 'Gestrichelt',
        'Solid': 'Voll',
        'Drawing tools': 'Werkzeuge',
        'Line and area': 'Linie und Fläche',
        'Rounded corners': 'Ecken abrunden',
        'Bring to front': 'Nach vorn',
        'Send to back': 'Nach hinten',
        'Delete shape': 'Form löschen',
        'Snap to the grid': 'Am Raster fangen',
        'On the plan': 'So steht es auf dem Plan',
        'Finish this run': 'Zug abschließen',
        'Search words': 'Suchwörter',
        'chair table wooden': 'Stuhl Tisch Holz',
        'Give the prop a name.': 'Gib dem Requisit einen Namen.',
        'Draw something first.': 'Zeichne erst etwas.',
        'Drag across the square to draw. Pick a shape to move or resize it.':
            'Zieh im Quadrat auf, um zu zeichnen. Eine Form anklicken, um sie zu schieben oder zu ziehen.',
        'Click each corner. Double-click, or press Enter, to finish the run.':
            'Jede Ecke anklicken. Doppelklick oder Eingabetaste schließt den Zug ab.',
        'Nothing drawn yet. Pick a tool above and drag across the square.':
            'Noch nichts gezeichnet. Nimm oben ein Werkzeug und zieh im Quadrat auf.',
        'The old drawing cannot be taken apart again. Draw it afresh, or close this and leave it as it is.':
            'Die alte Zeichnung lässt sich nicht mehr in Formen zerlegen. Zeichne sie neu, oder schließ das hier, dann bleibt sie, wie sie ist.',
        '1 shape': '1 Form',
        '{n} shapes': '{n} Formen'
    };


    /*
     * Die Erklärkästen.
     *
     * Zu jeder Einstellung, bei der man sich fragen kann, was sie tut, gehört
     * ein "?" — und dahinter ein Satz, der es sagt. Nicht was der Schalter
     * heißt, sondern was er auf dem Papier bewirkt und wann man ihn braucht.
     */
    var EXPLAIN_DE = {

        /* ------------------------------------------------------- Bühne */
        'stage.shape': {
            title: 'Bühnenform',
            body: 'Bestimmt den Umriss, den jeder Plan zeigt, und wo das Publikum eingezeichnet wird. Nimm die Form, die deine Spielfläche wirklich hat. Der Umriss ist die Bezugslinie für alle Positionsangaben im Umbauplan.'
        },
        'stage.width': {
            title: 'Breite',
            body: 'Von Wand zu Wand, quer zur Blickrichtung des Publikums. Miss die wirklich bespielbare Fläche, nicht den Raum.'
        },
        'stage.depth': {
            title: 'Tiefe',
            body: 'Von der Rückwand bis zur Bauflucht vorne. Bei einer Vorbühne zählt die Vorbühne nicht mit, die wird getrennt eingetragen.'
        },
        'stage.apron': {
            title: 'Vorbühne',
            body: 'Der Teil, der vor der Bauflucht ins Publikum ragt. Der Plan zeichnet ihn als Rundung vor der Hauptbühne; Requisiten dürfen darauf stehen.'
        },
        'stage.grid.show': {
            title: 'Bodenraster',
            body: 'Legt ein Gitter über den Plan. Auf dem gedruckten Blatt lässt sich damit auf einen Blick abschätzen, wie weit etwas von der Wand steht, ohne Lineal.'
        },
        'stage.grid.labels': {
            title: 'Felder beschriften',
            body: 'Gibt jedem Rasterfeld einen Buchstaben und eine Zahl, wie auf einem Schachbrett. Dann kann die Mannschaft zurufen „die Truhe kommt auf C4“, statt zu zeigen. Ist das an, benennt der Umbauplan Umstellungen mit diesem Feld statt mit „hinten rechts“.'
        },
        'stage.grid.spacing': {
            title: 'Rasterweite',
            body: 'Kantenlänge eines Feldes. Ein Meter ist der übliche Wert; bei kleinen Bühnen sind 50 cm feiner, bei großen wird das Raster sonst unleserlich.'
        },
        'stage.centreLine': {
            title: 'Mittelachse',
            body: 'Die senkrechte Linie durch die Bühnenmitte. Alle Querangaben werden von ihr aus gemessen. „1,20 m nach links“ heißt: 1,20 m von dieser Linie.'
        },
        'stage.settingLine': {
            title: 'Bauflucht',
            body: 'Die Linie, an der das Bühnenbild vorne abschließt. Alle Tiefenangaben zählen von hier nach hinten. Bei einer Vorbühne liegt sie hinter der Vorbühne, nicht an der Bühnenkante.'
        },
        'stage.scaleBar': {
            title: 'Maßstab',
            body: 'Ein kurzer Balken mit Meterangabe unten im Plan. Damit lässt sich auf dem ausgedruckten Blatt jede Strecke nachmessen, auch wenn der Drucker skaliert hat.'
        },
        'stage.wings': {
            title: 'Gassen',
            body: 'Die seitliche Abdeckung: eine Linie kommt von hinten nach vorne und knickt zur Seitenkante ab. Was dahinter steht, sieht das Publikum nicht. Dort wartet, was noch auf die Bühne muss. Auf dem gedruckten Blatt zeigt sie der Mannschaft, wie weit sie etwas herausziehen darf.'
        },
        'stage.curtains': {
            title: 'Vorhänge',
            body: 'Eine Linie quer über die Bühne in einem bestimmten Abstand von der Bauflucht. Jede Szene stellt für sich ein, ob dieser Vorhang offen, halb offen oder zu ist. Der Planer entscheidet das nie selbst.'
        },
        'stage.curtain.offset': {
            title: 'Abstand nach hinten',
            body: 'Wie weit hinter der Bauflucht der Vorhang hängt. Null heißt: direkt auf der Bauflucht.'
        },
        'stage.directions': {
            title: 'Richtungen aus welcher Sicht?',
            body: 'Ob „links“ auf dem Blatt die linke Seite der Zeichnung meint (also aus Sicht des Publikums) oder die linke Hand der Spielenden. Die beiden sind gegenläufig. Das wird an jedem Haus anders gehandhabt. Nimm, was deine Leute ohnehin sagen; die Wahl gilt für den ganzen Umbauplan.'
        },

        /* ------------------------------------------------------ Szenen */
        'scene.numbering': {
            title: 'Szenen nummerieren',
            body: 'Durchgehend zählt den ganzen Abend (1, 2, 3 …). Pro Akt fängt in jedem Akt neu an und stellt die Aktnummer voran (I.1, I.2, II.1 …). Die Nummer steht groß auf jedem Planblatt und in der ersten Spalte des Umbauplans.'
        },
        'scene.label': {
            title: 'Eigene Nummer',
            body: 'Überschreibt die errechnete Nummer für diese eine Szene. Für einen Prolog, ein Zwischenspiel oder alles, was sich nicht einreiht.'
        },
        'scene.act': {
            title: 'Akt',
            body: 'Ordnet die Szene einem Akt zu. Akte steuern die Nummerierung und können beim Drucken ein Trennblatt bekommen.'
        },
        'scene.place': {
            title: 'Ort',
            body: 'An welchem der benannten Orte diese Szene spielt: Schule, Markt, Café. Der Ort steht auf dem Planblatt und trägt den Referenzkasten des Umbauplans. Eine Szene muss keinen Ort haben.'
        },
        'scene.notes': {
            title: 'Notizen zur Szene',
            body: 'Freier Text für alles, was zu dieser Szene gehört. Auf dem Blatt steht er nur, wenn du ihn im Druckbereich ausdrücklich einschaltest. Das Planblatt soll leer bleiben.'
        },
        'scene.snap': {
            title: 'Am Raster ausrichten',
            body: 'Lässt Requisiten beim Ziehen auf halbe Rasterfelder einrasten. Macht Reihen gerade. Zum freien Stellen ausschalten oder beim Ziehen die Alt-Taste halten.'
        },
        'scene.labels': {
            title: 'Beschriftung im Plan',
            body: 'Was neben jedem Requisit im Plan steht. „Keine Beschriftung“ ist am ruhigsten und passt zu einem Blatt, das nur die Zeichnung zeigt; „Requisitennamen“ ist ohne Nachschlagen lesbar, wird aber bei vollen Bühnen eng. „Nur eigene Beschriftung“ zeigt allein, was du selbst hineingeschrieben hast, „Name und Beschriftung“ beides.'
        },
        'scene.ghosts': {
            title: 'Vorige Szene andeuten',
            body: 'Zeichnet blass ein, wo die Dinge in der Szene davor standen, mit Pfeilen zur neuen Position. Zum Prüfen am Bildschirm, ob ein Umbau wirklich so gemeint ist.'
        },
        'scene.copyLayout': {
            title: 'Aufbau übernehmen',
            body: 'Holt den Aufbau einer anderen Szene hierher, ersetzend oder ergänzend, wahlweise gespiegelt. Die Requisiten behalten dabei ihre Identität, im Umbauplan steht also „umgestellt“ statt „abgebaut und neu aufgebaut“.'
        },
        'scene.mirror': {
            title: 'Spiegeln',
            body: 'Klappt den ganzen Aufbau an der Mittelachse um. Für ein Bühnenbild, das seitenverkehrt wiederkommt.'
        },
        'scene.pushForward': {
            title: 'In spätere Szenen übernehmen',
            body: 'Trägt die ausgewählten Requisiten unverändert in spätere Szenen weiter. Damit bleibt etwas stehen, statt in jeder Szene neu aufgebaut zu werden.'
        },

        /* ------------------------------------------------------ Auswahl */
        'item.lock': {
            title: 'Sperren',
            body: 'Verhindert versehentliches Verschieben. Ein gesperrtes Requisit bleibt sichtbar und zählt weiter im Umbauplan mit.'
        },
        'item.rot': {
            title: 'Drehung',
            body: 'In Grad, im Uhrzeigersinn. Dreht sich zwischen zwei Szenen nur die Ausrichtung und sonst nichts, steht im Umbauplan der Winkel statt einer Position.'
        },
        'item.flip': {
            title: 'Umdrehen',
            body: 'Spiegelt nur die Zeichnung dieses einen Requisits. Für alles, was eine Vorder- und eine Rückseite hat, etwa eine Treppe oder ein Sofa.'
        },
        'item.build': {
            title: 'Wie dieses Stück gebaut ist',
            body: 'Requisiten mit einer Bauvorschrift werden bei jeder Größe neu gerechnet, in Bühnenmetern. Die Armlehne bleibt 18 cm breit, ob das Sofa 1,40 m oder 2,40 m misst, und die Leiter bekommt Sprossen dazu, statt gedehnte zu bekommen. Was hier steht, hängt davon ab, was ausgewählt ist \u2014 jede Vorschrift nennt ihre Werte selbst.'
        },
        'item.size': {
            title: 'Größe',
            body: 'Die echte Grundfläche in Metern. Ändert sie sich zwischen zwei Szenen, gilt das als Umstellung, praktisch bei einem Tisch, der ausgezogen wird. Bei den schräg gezeichneten Requisiten geht die zweite Kante immer mit. Sie sind maßstäblich gezeichnet und würden sonst verzerrt.'
        },
        'item.label': {
            title: 'Eigene Beschriftung',
            body: 'Ein Name für dieses eine Stück, etwa „Annas Stuhl“. Er hilft dem Planer, dasselbe Requisit über Szenen hinweg wiederzuerkennen, und steht in Klammern im Umbauplan.'
        },
        'item.align': {
            title: 'Ausrichten und verteilen',
            body: 'Zieht die ausgewählten Requisiten auf eine gemeinsame Linie oder setzt gleiche Abstände zwischen sie. Rein geometrisch. Der Planer rät dabei nichts.'
        },

        /* -------------------------------------------------------- Orte */
        'place.what': {
            title: 'Was ist ein Ort?',
            body: 'Ein Bühnenbild, das im Lauf des Abends wiederkehrt: die Schule, der Markt, das Café. Szenen verweisen darauf, statt die Requisitenliste jedes Mal zu wiederholen.'
        },
        'place.set': {
            title: 'Das Bühnenbild',
            body: 'Der Aufbau, der zu diesem Ort gehört. Von selbst landet er nie in einer Szene. Du setzt ihn ein, wenn du ihn brauchst. Umgekehrt kannst du den Ort aus einer eingerichteten Szene aktualisieren, wenn sich der Aufbau geändert hat.'
        },
        'place.drift': {
            title: 'Abweichung',
            body: 'Eine Szene, die sich seit dem Einsetzen verändert hat. Meist ist das Absicht, denn oft steht in einer Szene eben ein Stuhl anders. Der Planer zeigt es an, damit dir eine ungewollte Abweichung vor der Aufführung auffällt. Ändern kannst du es in beide Richtungen, aber nur von Hand.'
        },

        /* -------------------------------------------------------- Umbau */
        'trans.note': {
            title: 'Hinweis zu diesem Umbau',
            body: 'Für alles, was der Planer nicht wissen kann: „Kaffeetasse mit einem Schluck Wasser hinten rechts bereithalten“. Steht mit einem Stern kursiv unter der errechneten Liste.'
        },
        'trans.critical': {
            title: 'Kritischer Umbau',
            body: 'Druckt die ganze Zeile fett. Für den Umbau, der eng ist oder immer schiefgeht, damit das Auge ihn beim Überfliegen findet.'
        },
        'trans.banner': {
            title: 'Balken quer durch die Tabelle',
            body: 'Ein Einschnitt zwischen zwei Zeilen: PAUSE, VORHANG AUF, ein Umbau vor offenem Vorhang. Der Balken zieht die nächste Zeile mit auf dieselbe Seite, damit er nie allein unten steht.'
        },

        /* ------------------------------------------------------ Drucken */
        'print.docs': {
            title: 'Zwei Dokumente',
            body: 'Die Pläne sind zum Ansehen, der Umbauplan zum Abarbeiten. Sie werden getrennt gedruckt, weil sie an verschiedenen Orten liegen: die Pläne an der Bühne, der Umbauplan bei der Mannschaft.'
        },
        'print.orientation': {
            title: 'Papierlage',
            body: 'Hoch oder quer. Eine breite, flache Bühne kommt quer größer heraus; eine tiefe Bühne hoch.'
        },
        'print.scope': {
            title: 'Welche Szenen',
            body: 'Beschränkt beide Dokumente auf einen Akt. Nützlich, wenn nur die zweite Hälfte neu geprobt wird und niemand den ganzen Stapel braucht.'
        },
        'print.cover': {
            title: 'Titelblatt',
            body: 'Ein Blatt vorn mit Stück, Spielstätte, Bühnenmaßen und Datum. Damit auf dem Stapel steht, welche Fassung er ist.'
        },
        'print.actPages': {
            title: 'Trennblatt vor jedem Akt',
            body: 'Ein Blatt mit Aktnummer und den Szenen darin, vor jeden Akt gelegt. Hilft beim Blättern im Dunkeln.'
        },
        'print.scenePages': {
            title: 'Ein Blatt pro Szene',
            body: 'Der eigentliche Plan: eine Szene, groß gezeichnet, mit Nummer und Titel. Sonst steht nichts darauf.'
        },
        'print.overview': {
            title: 'Übersichtsblätter',
            body: 'Viele kleine Pläne auf einem Blatt. Für die Wand hinter der Bühne, wo man den ganzen Abend auf einmal sehen will.'
        },
        'print.inventory': {
            title: 'Requisitenliste',
            body: 'Jedes verwendete Requisit mit der Zahl, die höchstens gleichzeitig auf der Bühne steht. Das ist die Zahl, die wirklich vorhanden sein muss.'
        },
        'print.labels': {
            title: 'Beschriftung im Plan',
            body: 'Wie die Requisiten auf dem gedruckten Plan benannt werden. Ohne Beschriftung wird die Zeichnung am ruhigsten. Dann trägt der Umbauplan die Namen.'
        },
        'print.showGrid': {
            title: 'Raster mitdrucken',
            body: 'Druckt das Bodenraster mit. Ohne Raster wirkt der Plan aufgeräumter, mit Raster lässt sich vor Ort messen.'
        },
        'print.showNotes': {
            title: 'Notizen mitdrucken',
            body: 'Setzt die Notizen der Szene unter die Zeichnung. Standardmäßig aus, damit das Planblatt eine Zeichnung bleibt.'
        },
        'print.showPlace': {
            title: 'Ort mitdrucken',
            body: 'Schreibt den Ort der Szene neben den Titel, etwa „I.V · Wohnzimmer“.'
        },
        'print.overviewAuto': {
            title: 'Alle Szenen auf ein Blatt',
            body: 'Legt alle Szenen als kleine Pläne nebeneinander auf ein einziges Blatt — der Überblick über den Abend, nicht die Vorlage zum Aufbauen. Ist das aus, bekommt jede Szene ihr eigenes Blatt.'
        },
        'print.overviewSize': {
            title: 'Szenen pro Blatt',
            body: 'Wie viele kleine Pläne auf ein Übersichtsblatt kommen. Bis 3 × 3 bleiben Publikum und Raster erkennbar, darüber wird es zur reinen Silhouette.'
        },
        'print.splitActs': {
            title: 'Pro Akt neu beginnen',
            body: 'Beginnt für jeden Akt ein frisches Übersichtsblatt, damit keine Seite über die Pause hinweggeht.'
        },
        'print.referenceBox': {
            title: 'Referenzkasten',
            body: 'Der umrahmte Block über der Tabelle: jeder Ort mit seinen festen Requisiten. Er ersetzt das Nachschlagen im Plan für alles, was ohnehin bekannt ist.'
        },
        'print.positions': {
            title: 'Positionen in der Tabelle',
            body: 'Ergänzt bei jeder Umstellung die genaue Position in Metern, zusätzlich zum Feld oder zur Richtungsangabe. Genauer, aber die Tabelle wird deutlich länger.'
        },
        'print.showGuides': {
            title: 'Mittelachse und Bauflucht',
            body: 'Die beiden Hilfslinien im Plan. Ohne sie wird das Blatt ruhiger; mit ihnen lässt sich vor Ort abschätzen, was mittig steht und was vor der Bauflucht liegt.'
        },
        'print.showAudience': {
            title: 'Publikum',
            body: 'Die Zackenlinie an den Seiten, an denen das Publikum sitzt. Wer die Bühne kennt, braucht sie nicht.'
        },
        'print.showTitle': {
            title: 'Titel neben der Nummer',
            body: 'Setzt Szenentitel und Ort neben die große Nummer. Aus, wenn das Blatt nur die Zeichnung tragen soll.'
        },
        'print.showFooter': {
            title: 'Fußzeile',
            body: 'Stück, eigene Fußzeile und Seitenzahl am unteren Rand jedes Blatts.'
        },
        'print.numberOutside': {
            title: 'Nur die Nummer, neben der Bühne',
            body: 'Stellt die Szenennummer groß links neben die Zeichnung, außerhalb des Bühnenrahmens, und lässt alles andere weg. So liegen die Blätter, die auf dieser Bühne schon benutzt wurden.'
        },
        'scene.wingNotes': {
            title: 'Gassenzettel',
            body: 'Ein kleines Bild mit Bildunterschrift, in die Gasse gestellt: was dort bereitliegen muss, ohne dass es auf der Bühne steht, etwa „Kaffeetasse mit einem Schluck Wasser“. Es steht auf dem Planblatt, wo die Mannschaft ohnehin hinsieht, und nicht bloß im Umbauplan.'
        },
        'print.footer': {
            title: 'Fußzeile',
            body: 'Steht klein auf jedem Blatt. Gut für den Stand der Fassung, damit auf der Probe niemand mit einem alten Ausdruck arbeitet.'
        },

        /* ----------------------------------------------------- Speicher */
        'store.backup': {
            title: 'Back-up',
            body: 'Schreibt alles in eine JSON-Datei zum Herunterladen: Produktionen, Szenen, eigene Requisiten. Der Planer speichert nur in diesem Browser. Wer die Browserdaten löscht und kein Back-up hat, verliert die Arbeit.'
        },
        'store.restore': {
            title: 'Wiederherstellen',
            body: 'Liest ein Back-up zurück. Du wirst gefragt, ob der Inhalt zu dem dazukommen oder alles ersetzen soll.'
        },

        /* --------------------------------------------- Requisiten-Zeichner */
        'draw.open': {
            title: 'Selbst zeichnen',
            body: 'Öffnet ein leeres Quadrat, in dem du das Requisit aus Rechtecken, Rundungen und Linien zusammensetzt. Anders als ein hochgeladenes Bild bleibt so Gezeichnetes bei jeder Größe scharf und druckt in derselben Strichstärke wie die eingebauten Zeichnungen.'
        },
        'draw.tools': {
            title: 'Werkzeuge',
            body: 'Mit „Auswählen“ schiebst und ziehst du Fertiges, mit den anderen zeichnest du Neues. Rechteck, Rundung und Linie ziehst du in einem Zug auf; bei Linienzug und Umriss klickst du Ecke für Ecke und schließt mit Doppelklick ab.'
        },
        'draw.paint': {
            title: 'Linie und Fläche',
            body: 'Legt fest, wie eine Form auf dem Plan erscheint. Ist eine ausgewählt, ändert sich diese, sonst gilt die Wahl für die nächste, die du zeichnest. „Nur Linie“ ist der blanke Umriss. „Getönt“ füllt sie ganz schwach ein. So wird sichtbar, dass da etwas steht, ohne dass der Grundriss zuläuft. „Gestrichelt“ ist die übliche Schreibweise für Türflügel und alles, was nur zeitweise da ist. „Voll“ deckt zu und ist für kleine Marken gedacht.'
        },
        'draw.radius': {
            title: 'Ecken abrunden',
            body: 'Bricht die vier Ecken des Rechtecks. Ein gepolsterter Sessel liest sich rund, eine Kiste eckig. Auf dem gedruckten Grundriss ist das oft der einzige Unterschied zwischen beiden.'
        },
        'draw.order': {
            title: 'Reihenfolge',
            body: 'Bestimmt, was über was liegt. Getönte und volle Flächen decken alles unter sich ab; die Lehne gehört also nach vorn geholt, wenn die Sitzfläche sie verschluckt.'
        },
        'draw.snap': {
            title: 'Am Raster fangen',
            body: 'Lässt jede Ecke auf die nächste Rasterlinie springen, damit Kanten fluchten und gegenüberliegende Teile gleich groß werden. Für schräge Linien, die nirgends aufgehen, schaltest du es aus.'
        },
        'draw.preview': {
            title: 'So steht es auf dem Plan',
            body: 'Zeigt die Zeichnung in der Größe, die sie später auf der Bühne hat, mit demselben Raster und derselben Strichstärke wie der fertige Plan. Was hier zu einem Klumpen zusammenläuft, ist auch auf dem Papier nicht zu erkennen und braucht weniger Linien.'
        },
        'draw.footprint': {
            title: 'Grundfläche',
            body: 'Das wirkliche Maß des Requisits, quer zur Bühne und in die Tiefe. Die Zeichnung wird auf dieses Rechteck gezogen. Ein gezeichneter Kreis wird auf einer breiten Grundfläche also zur Ellipse. Miss lieber nach, als zu schätzen. Davon hängt ab, ob auf der Bühne noch jemand vorbeikommt.'
        }
    };

    var EXPLAIN = { de: EXPLAIN_DE, en: null };

    /* Erklärung zu einem Schlüssel, ersatzweise auf Deutsch. */
    function explain(key) {
        var table = EXPLAIN[current] || EXPLAIN_DE;
        return (table && table[key]) || EXPLAIN_DE[key] || null;
    }


    /*
     * Die Einführungen.
     *
     * Beim ersten Betreten eines Reiters steht oben ein Streifen: wofür der
     * Bereich da ist und was man als Nächstes tut. Er blockiert nichts und
     * verschwindet, sobald man ihn wegklickt — aber er kommt für jeden
     * Bereich einmal, statt dass die Einrichtung einen nach dem letzten
     * Schritt sich selbst überlässt.
     */
    var INTRO_DE = {
        scenes: {
            title: 'Szenen',
            body: 'Jede Szene ist ein Standbild. Was zwischen zwei Szenen getragen werden muss, rechnet der Planer selbst aus.',
            steps: [
                'Das Ergebnis steht im Feld „Szene“ unter „Änderungen zur Szene davor“ und wird später zum Umbauplan.',
                'Beim Ziehen macht Shift das Raster feiner, Alt hebt es ganz auf.',
                'Was die Tasten gerade tun, steht unten rechts in der Leiste.'
            ]
        },
        stage: {
            title: 'Bühne',
            body: 'Eine Bühne für den ganzen Abend. Alle Szenen teilen sie sich.',
            steps: [
                'Vorhänge werden hier eingetragen, aber jede Szene stellt für sich ein, ob sie offen oder zu sind.',
                'Ändert sich die Form in der Pause, kann eine einzelne Szene eine eigene Bühne bekommen. Das steht im Feld „Szene“.'
            ]
        },
        places: {
            title: 'Orte',
            body: 'Ein Ort ist ein Bühnenbild, das wiederkehrt. Er merkt sich seinen Aufbau, damit du ihn nicht jedes Mal neu stellst.',
            steps: [
                'Aus dem Ort lässt sich der Aufbau in jede Szene setzen, und aus einer eingerichteten Szene der Ort aktualisieren.',
                'Weicht eine Szene später ab, wird das nur gemeldet. Geändert wird nichts von selbst.',
                'Was hier steht, füllt den Referenzkasten oben auf dem Umbauplan.'
            ]
        },
        props: {
            title: 'Requisiten',
            body: 'Alles, was auf die Bühne kann.',
            steps: [
                'Die Grundfläche in Metern bestimmt, wie groß ein Stück im Plan erscheint. Lieber nachmessen als schätzen.',
                'Fehlt etwas, zeichne es selbst: Rechtecke, Rundungen und Linien genügen für die meisten Requisiten.'
            ]
        },
        print: {
            title: 'Drucken',
            body: 'Zwei Dokumente, die getrennt gedruckt werden, weil sie an verschiedenen Orten liegen.',
            steps: [
                'Die Pläne gehören an die Bühne, der Umbauplan zur Mannschaft.',
                'Was du hier einstellst, gehört zu dieser Produktion. Eine andere Produktion hat ihre eigenen Einstellungen.'
            ]
        }
    };

    var INTRO = { de: INTRO_DE, en: null };

    function intro(tab) {
        var table = INTRO[current] || INTRO_DE;
        return (table && table[tab]) || INTRO_DE[tab] || null;
    }

    var LANGS = { de: DE, en: null };
    var current = 'de';

    function setLanguage(code) {
        current = LANGS[code] !== undefined ? code : 'de';
        return current;
    }

    function language() { return current; }

    function fill(text, vars) {
        if (!vars) return text;
        return text.replace(/\{(\w+)\}/g, function (whole, key) {
            return vars[key] === undefined ? whole : String(vars[key]);
        });
    }

    /* The key is the English source text, so an untranslated string still
       reads correctly rather than showing a missing-key placeholder. */
    function t(key, vars) {
        var table = LANGS[current];
        var text = (table && table[key] !== undefined) ? table[key] : key;
        return fill(text, vars);
    }

    /* Plural picker for the handful of places where German and English agree
       on the one/many split. */
    function plural(n, one, many, vars) {
        var v = vars || {};
        v.n = n;
        return t(n === 1 ? one : many, v);
    }

    /* Decimal comma in German, point in English. Used by core.js so a length
       never comes out as "2.40 m" on a German sheet. */
    function decimalSeparator() {
        return current === 'en' ? '.' : ',';
    }

    return {
        t: t,
        plural: plural,
        fill: fill,
        setLanguage: setLanguage,
        language: language,
        decimalSeparator: decimalSeparator,
        explain: explain,
        EXPLAIN: EXPLAIN,
        intro: intro,
        INTRO: INTRO,
        LANGS: LANGS,
        DE: DE
    };
}));
