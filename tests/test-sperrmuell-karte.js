/**
 * Sperrmüll-Karte — läuft die gebaute Karte, und sieht sie aus wie die Seite?
 *
 * tools/sperrmuell/ enthält in git nur die Daten; Seite, Bündel und Worker
 * baut CI aus src/sperrmuell, bevor dieser Test läuft. Er prüft also, was der
 * Deploy hochladen würde:
 *
 *  - die Seite lädt ohne Fehler, und der Datumsregler zeigt ein Datum;
 *  - die Adresssuche findet „Moltkeplatz 3“ und nennt seine Termine, drei
 *    je Jahr (sechs, sobald der Plan fürs nächste Jahr da ist);
 *  - dunkel ist der Anfang, wie überall auf linu.li, und der Schalter macht
 *    hell, merkt es sich unter demselben Schlüssel wie die Seite ('theme')
 *    und hält beim Neuladen;
 *  - die Schriften sind die der Seite und kommen auch an.
 *
 * Kacheln kommen von openstreetmap.org und sind hier gesperrt, damit der Test
 * nichts über das Netz sagt.
 */
const puppeteer = require('puppeteer');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const URL_KARTE = BASE + '/tools/sperrmuell/';

function fail(msg) {
    console.error('FAIL: ' + msg);
    process.exitCode = 1;
}

function ok(msg) {
    console.log('ok: ' + msg);
}

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 800 });

        const fehler = [];
        const kaputt = [];
        page.on('pageerror', (e) => fehler.push(e.message));
        page.on('response', (res) => {
            if (res.status() >= 400 && res.url().startsWith(BASE)) {
                kaputt.push(res.status() + ' ' + res.url());
            }
        });
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (/tile\.openstreetmap\.org/.test(req.url())) req.abort();
            else req.continue();
        });

        await page.goto(URL_KARTE, { waitUntil: 'networkidle0' });

        // ---- Datum ----
        await page.waitForFunction(
            () => document.getElementById('date-label')?.textContent.trim().length > 0,
            { timeout: 15000 },
        ).catch(() => {});
        const datum = await page.$eval('#date-label', (e) => e.textContent.trim());
        if (datum) ok('Datumsregler zeigt „' + datum + '“');
        else fail('der Datumsregler zeigt kein Datum, die Daten kamen nicht an');

        // ---- dunkel zuerst ----
        const anfang = await page.evaluate(() => ({
            hell: document.documentElement.classList.contains('light'),
            gespeichert: localStorage.getItem('theme'),
            grund: getComputedStyle(document.body).backgroundColor,
        }));
        if (anfang.hell) fail('die Karte beginnt hell; die Seite beginnt dunkel');
        else ok('beginnt dunkel (' + anfang.grund + ')');

        // ---- Suche ----
        await page.type('#search-input', 'Moltkeplatz 3');
        await page.keyboard.press('Enter');
        await page.waitForSelector('#search-result .search-date-button', { timeout: 10000 })
            .catch(() => {});
        const termine = await page.$$eval('#search-result .search-date-button',
            (b) => b.map((x) => x.textContent.trim()));
        if (termine.length > 0 && termine.length % 3 === 0) ok('Suche nach Moltkeplatz 3: ' + termine.join(', '));
        else fail('Suche nach Moltkeplatz 3 fand ' + termine.length + ' Termine, erwartet drei je Jahr');

        // ---- Schalter ----
        await page.click('#theme-toggle');
        const danach = await page.evaluate(() => ({
            hell: document.documentElement.classList.contains('light'),
            gespeichert: localStorage.getItem('theme'),
            grund: getComputedStyle(document.body).backgroundColor,
            farbe: document.querySelector('meta[name="theme-color"]').getAttribute('content'),
        }));
        if (!danach.hell) fail('der Schalter macht die Karte nicht hell');
        else if (danach.gespeichert !== 'light') fail('hell wird nicht als theme=light gespeichert, sondern als ' + danach.gespeichert);
        else if (danach.grund === anfang.grund) fail('der Hintergrund bleibt beim Umschalten gleich');
        else ok('Schalter: hell, gespeichert, Hintergrund ' + danach.grund + ', theme-color ' + danach.farbe);

        await page.reload({ waitUntil: 'networkidle0' });
        const neu = await page.evaluate(() => document.documentElement.classList.contains('light'));
        if (neu) ok('hell hält nach dem Neuladen');
        else fail('nach dem Neuladen ist die Karte wieder dunkel');

        // ---- Schriften ----
        const schriften = await page.evaluate(async () => {
            await document.fonts.ready;
            const familie = (sel) => getComputedStyle(document.querySelector(sel)).fontFamily;
            const geladen = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family);
            return { titel: familie('#app-title h1'), text: familie('body'), geladen };
        });
        const namen = schriften.titel + ' ' + schriften.text;
        if (!/Libre Baskerville|Space Grotesk/.test(namen)) {
            fail('die Karte nutzt nicht die Schriften der Seite: ' + namen);
        } else if (schriften.geladen.length === 0) {
            fail('keine Schrift wurde geladen');
        } else {
            ok('Schriften: ' + [...new Set(schriften.geladen)].join(', '));
        }

        if (fehler.length) fail('Fehler auf der Seite: ' + fehler.join(' | '));
        else ok('keine Fehler auf der Seite');
        if (kaputt.length) fail('Anfragen schlugen fehl: ' + kaputt.join(', '));
        else ok('alle eigenen Anfragen kamen an');
    } finally {
        await browser.close();
    }
    if (process.exitCode) console.error('\nSperrmüll-Karte: FEHLGESCHLAGEN');
    else console.log('\nSperrmüll-Karte: alles gut');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
