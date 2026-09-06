if ('serviceWorker' in navigator) {
    // Always the one at the root. A worker's reach stops at the directory it
    // is served from, so the old one under /assets/ controlled no page at all
    // and the site was never actually available offline.
    navigator.serviceWorker.register('/sw.js')
        .then(neueVersionAnbieten)
        .catch(err => console.error('SW Registration Failed', err));

    // Visitors from before still carry that /assets/ registration around.
    // It controls nothing, but it holds an old cache — send it on its way.
    navigator.serviceWorker.getRegistrations()
        .then(regs => regs.forEach(reg => {
            if (reg.scope.endsWith('/assets/')) reg.unregister();
        }))
        .catch(() => {});
}

/* ============================================================ *
 * "There is a new version — take it?"
 *
 * The site redeploys several times a day and every visitor carries a cached
 * copy. The worker fetches the new one and then waits, and this is what
 * wakes it: without something here, a tab left open for a week would keep
 * running last week's code, because nothing would ever tell the waiting
 * worker to take over.
 *
 * Two rules shape when it appears, and both exist to keep it out of the way:
 *
 *   - it asks at the first safe moment — either the visitor is about to
 *     leave this page anyway (an internal link), or they have stopped doing
 *     anything for a while. Whichever comes first.
 *   - it never asks a page twice. "Später" is a variable, not a stored
 *     preference: nothing is written down, nothing needs a line in the
 *     privacy policy, and the next page asks once more. A visitor who keeps
 *     dismissing it still gets the new version the moment they close the tab.
 *
 * The sentences come from the waiting worker, which carries every note since
 * the version this page is running (assets/update-note.txt → sw.js). Asking
 * somebody to reload without saying why is how update prompts get trained
 * away.
 * ============================================================ */

/* Untätig heißt: lange genug hier, lange genug nichts getan, und der Reiter
   ist überhaupt sichtbar. Ohne die Mindestverweildauer erwischt es den, der
   nur kurz etwas nachschlägt; ohne das Sichtbarkeitsfenster stapeln sich
   Dialoge in Hintergrundreitern. */
const WARTEZEIT_SEITE = 30_000;
const WARTEZEIT_RUHE = 90_000;
const NOTIZEN_SICHTBAR = 5;

function neueVersionAnbieten(registration) {
    if (!registration) return;

    let schonGefragt = false;      // diese Seite, nicht dieser Browser
    let ichWarEs = false;          // nur der Reiter, der gedrückt hat, lädt neu

    /* Ganz oben, und das ist kein Geschmack: `pruefen()` weiter unten läuft
       noch während dieser Funktionskörper abgearbeitet wird, und es ruft
       `planen()`, das beide liest. Standen sie unterhalb, warf der Zugriff
       in die temporale Totzone — aber nur dann, wenn beim Laden schon ein
       Worker wartete. Dann starb der Rest dieser Funktion, der Klick-Zuhörer
       wurde nie registriert, und der Hinweis erschien nie wieder. Sichtbar
       war davon eine einzige Zeile in der Konsole. */
    let geplant = false;
    let ruheUhr = null;

    /* Ein Wechsel des Workers betrifft jeden Reiter. Ohne diese Sperre würde
       der Nachbarreiter mitladen und die Datei wegwerfen, die dort gerade
       offen ist — ohne dass dort jemand etwas gedrückt hätte. */
    let zielNachTausch = null;
    let getauscht = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!ichWarEs || getauscht) return;
        getauscht = true;
        window.location.href = zielNachTausch || window.location.href;
    });

    const wartender = () => registration.waiting;

    function pruefen() {
        if (wartender()) planen();
    }

    registration.addEventListener('updatefound', () => {
        const neuer = registration.installing;
        if (!neuer) return;
        neuer.addEventListener('statechange', () => {
            if (neuer.state === 'installed' && navigator.serviceWorker.controller) planen();
        });
    });
    pruefen();

    function planen() {
        if (schonGefragt || geplant) return;
        geplant = true;

        let letzteEingabe = performance.now();
        const angefasst = () => { letzteEingabe = performance.now(); };
        ['pointerdown', 'keydown', 'input', 'wheel', 'touchstart'].forEach(art =>
            window.addEventListener(art, angefasst, { passive: true }));

        /* Kommt ein Reiter aus dem Hintergrund zurück, fängt die Ruhe von
           vorne an. Ohne das stand das modale Fenster innerhalb von fünf
           Sekunden da — in genau dem Moment, in dem jemand wieder etwas tun
           wollte, weil er ja gerade zurückgewechselt ist. */
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') angefasst();
        });

        ruheUhr = setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            if (performance.now() < WARTEZEIT_SEITE) return;
            if (performance.now() - letzteEingabe < WARTEZEIT_RUHE) return;
            clearInterval(ruheUhr);
            fragen();
        }, 5000);
    }

    /* Der zweite Weg: wer ohnehin gerade weggeht, verliert nichts.
       Steht außerhalb von planen(), damit er genau einmal registriert wird —
       planen() läuft bei jedem gefundenen Worker erneut, und die Zuhörer
       häuften sich mit jedem Deploy in einem lange offenen Reiter. */
    document.addEventListener('click', (e) => {
        if (schonGefragt || !wartender()) return;

        /* Alles, was der Browser anders behandeln würde als eine gewöhnliche
           Navigation, bleibt unangetastet. Ohne diese Zeile fing der Hinweis
           auch Strg- und Umschalt-Klicks ab: es öffnete sich kein neuer
           Reiter, und danach navigierte ausgerechnet der Reiter weg, in dem
           die Arbeit steckte — ohne Rückfrage, weil der Arbeits-Haken nur am
           Knopf „Neu laden" hängt. */
        if (e.defaultPrevented || e.button !== 0) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

        const link = e.target.closest && e.target.closest('a[href]');
        if (!link) return;
        if (link.hasAttribute('download')) return;
        if (link.target && link.target !== '_self') return;

        let ziel;
        try { ziel = new URL(link.getAttribute('href'), window.location.href); }
        catch (err) { return; }
        if (ziel.origin !== window.location.origin) return;

        /* Ein Sprung innerhalb derselben Seite ist kein Weggehen. */
        const hier = window.location.href.split('#')[0];
        if (ziel.href.split('#')[0] === hier) return;

        e.preventDefault();
        if (ruheUhr) clearInterval(ruheUhr);
        fragen(ziel.href);
    }, false);

    /* Was der wartende Worker ist und was er zu erzählen hat. */
    function fragenAn(worker) {
        return new Promise((antwort) => {
            if (!worker) return antwort(null);
            const kanal = new MessageChannel();
            const uhr = setTimeout(() => antwort(null), 2000);
            kanal.port1.onmessage = (e) => { clearTimeout(uhr); antwort(e.data); };
            try { worker.postMessage({ frage: 'stand' }, [kanal.port2]); }
            catch (err) { clearTimeout(uhr); antwort(null); }
        });
    }

    /* Der Klick, der den Hinweis ausgelöst hat, wollte irgendwo hin. */
    function weiter(adresse) { if (adresse) window.location.href = adresse; }

    async function fragen(danach) {
        if (schonGefragt) { weiter(danach); return; }
        schonGefragt = true;

        /* Nebeneinander, nicht nacheinander: der Klick auf den Link ist schon
           abgefangen, und zwei Fristen von je zwei Sekunden hintereinander
           ließen ihn bis zu vier Sekunden lang tot wirken. */
        const [neu, alt] = await Promise.all([
            fragenAn(wartender()),
            fragenAn(navigator.serviceWorker.controller),
        ]);

        /* Kennt der laufende Worker seinen Stand nicht, ist er älter als
           dieser Mechanismus — dann gibt es nichts zu erzählen, und der
           Tausch geschieht still. Das ist der allererste Rollout. */
        if (!neu || !alt || !alt.sha) { if (danach) weiter(danach); return; }

        /* Gezählt, nicht verglichen: die Sätze, die der laufende Worker noch
           nicht kannte, sind die hinter seiner eigenen Anzahl. */
        const alle = neu.notizen || [];
        const schon = (alt.notizen || []).length;
        const neue = alle.slice(schon);
        if (!neue.length) { if (danach) weiter(danach); return; }

        zeigen(neue, danach);
    }

    function zeigen(notizen, danach) {
        const de = document.documentElement.lang === 'de' ||
            document.documentElement.getAttribute('data-frame') === 'de';
        const sag = (en, ger) => (de ? ger : en);

        const schirm = document.createElement('div');
        schirm.className = 'll-update';
        schirm.innerHTML = `
            <div class="ll-update-karte" role="dialog" aria-modal="true"
                 aria-labelledby="ll-update-titel">
              <h2 id="ll-update-titel">${sag('A new version is ready', 'Eine neue Fassung ist da')}</h2>
              <ul></ul>
              <div class="ll-update-knoepfe">
                <button type="button" data-tun="spaeter">${sag('Later', 'Später')}</button>
                <button type="button" data-tun="jetzt" class="ll-update-ja">${sag('Reload', 'Neu laden')}</button>
              </div>
            </div>`;

        const liste = schirm.querySelector('ul');
        notizen.slice(0, NOTIZEN_SICHTBAR).forEach((text) => {
            const li = document.createElement('li');
            li.textContent = text;
            liste.appendChild(li);
        });
        if (notizen.length > NOTIZEN_SICHTBAR) {
            const rest = notizen.length - NOTIZEN_SICHTBAR;
            const li = document.createElement('li');
            li.className = 'll-update-rest';
            li.textContent = sag(`and ${rest} more`, `und ${rest} weitere`);
            liste.appendChild(li);
        }

        const vorher = document.activeElement;
        const schliessen = () => {
            document.removeEventListener('keydown', taste, true);
            schirm.remove();
            if (vorher && vorher.focus) vorher.focus();
            weiter(danach);
        };
        const taste = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); schliessen(); }
        };

        schirm.addEventListener('click', (e) => {
            const tun = e.target.getAttribute && e.target.getAttribute('data-tun');
            if (tun === 'spaeter' || e.target === schirm) return schliessen();
            if (tun !== 'jetzt') return;

            /* Ein Werkzeug, das etwas hält, sagt es. Wer sich nicht meldet,
               gilt als leer — die meisten sind es, und ein Werkzeug mit
               Arbeit dran muss sich melden. tests/test-arbeit-haken.js
               besteht darauf, dass jedes mit Datei-Eingabe das tut. */
            let haelt = false;
            try { haelt = !!(window.llHaeltArbeit && window.llHaeltArbeit()); }
            catch (err) { haelt = false; }
            if (haelt && !window.confirm(sag(
                'This tool is still holding something that reloading will discard. Reload anyway?',
                'Dieses Werkzeug hält noch etwas, das beim Neuladen verloren geht. Trotzdem neu laden?'))) {
                return;
            }

            ichWarEs = true;
            /* Wer hierher über einen Klick auf einen Link gekommen ist,
               wollte woandershin. Ihn stattdessen auf der alten Seite neu
               laden zu lassen, verschluckt seinen Klick — die neue Adresse
               tut beides auf einmal: sie holt die neuen Dateien und bringt
               ihn dorthin, wo er hinwollte. */
            zielNachTausch = danach || window.location.href;
            const w = wartender();
            if (w) w.postMessage({ frage: 'uebernimm' });
            /* Nimmt der Worker die Aufforderung nicht an, geht es trotzdem
               weiter — die neuen Dateien holt die Seite sich dann selbst. */
            setTimeout(() => { if (!getauscht) window.location.href = zielNachTausch; }, 1200);
        });

        document.addEventListener('keydown', taste, true);
        document.body.appendChild(schirm);
        const ja = schirm.querySelector('.ll-update-ja');
        if (ja) ja.focus();
    }
}

// The manifest is what makes the site installable. Only the front page
// carried a link to it, so a visitor who arrived straight at a tool was
// never offered the install. index.html still has its own link in the
// markup, which is better than waiting for this script — hence the check.
if (!document.querySelector('link[rel="manifest"]')) {
    const manifestLink = document.createElement('link');
    manifestLink.rel = 'manifest';
    manifestLink.href = '/assets/manifest.json';
    document.head.appendChild(manifestLink);
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. Determine paths based on current location
    // Check if we are inside the 'tools' directory
    const inToolsDir = window.location.pathname.includes('/tools/');
    const rootPath = inToolsDir ? '../../' : './';

    // A page can ask for a German frame with data-frame="de". Not every German
    // page wants one: Impressum and Datenschutz are German documents that
    // belong to the whole site, and their frame stays English with the rest.
    const de = document.documentElement.getAttribute('data-frame') === 'de';
    const say = (english, german) => (de ? german : english);
    
    // 2. Inject Header
    const headerHTML = `
    <header class="main-header">
        <nav>
            <a href="${rootPath}" class="logo-link">Tools for Everyone</a>
            <div style="display:flex; gap: 1.5rem; align-items: center;">
                <button id="theme-toggle" class="theme-switch" aria-label="${say('Toggle Dark Mode', 'Zwischen hell und dunkel wechseln')}">
                    <div class="switch-track">
                        <div class="switch-thumb"></div>
                    </div>
                </button>
            </div>
        </nav>
    </header>`;
    
    // 3. Inject Footer
    const footerHTML = `
    <footer style="text-align: center; padding: 3rem 1rem; opacity: 0.8; font-size: 0.9rem; border-top: 1px solid var(--border); margin-top: auto;">
        
        <!-- Donation Section -->
        <div style="margin-bottom: 1.5rem;">
            <a href="https://ko-fi.com/linuslinhof" target="_blank" rel="noopener noreferrer" class="donate-btn">
                <span>☕</span> ${say('Buy me a coffee', 'Spendier mir einen Kaffee')}
            </a>
        </div>

        <p style="margin: 0 auto; text-align: center;">
            &copy; ${new Date().getFullYear()} Linus Linhof. ${say('Built for utility.', 'Gebaut, damit es etwas nützt.')}
        </p>
        
        <!-- Links with auto margins -->
        <p style="margin: 0.5rem auto 0; opacity: 0.7; text-align: center;">
            <a href="${rootPath}impressum.html">${say('Impressum / Legal', 'Impressum')}</a> &bull; 
            <a href="${rootPath}privacy.html">${say('Privacy / Datenschutz', 'Datenschutz')}</a>
        </p>
    </footer>
    <div id="toast-container" class="toast-container"></div>`;

    document.body.insertAdjacentHTML('afterbegin', headerHTML);
    document.body.insertAdjacentHTML('beforeend', footerHTML);

    // 4. Theme Logic
    const themeToggle = document.getElementById('theme-toggle');
    /* Ohne try/catch fiel hier alles Weitere aus, sobald der Browser den
       Zugriff sperrt (privates Fenster, Website-Daten blockiert): die Seite
       kam hell statt dunkel, der Umschalter reagierte nicht, und die
       Bereinigung weiter unten wurde nie erreicht. */
    let savedTheme = null;
    try { savedTheme = localStorage.getItem('theme'); } catch (err) { /* gesperrt */ }
    
    // Default to dark mode unless user has explicitly chosen light
    if (savedTheme !== 'light') {
        document.body.classList.add('dark-mode');
    }

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            try { localStorage.setItem('theme', isDark ? 'dark' : 'light'); } catch (err) { /* gesperrt */ }
        });
    }

    // 5. Auto-Save State Logic (Global)
    //
    // Opt-in, and it has to stay opt-in.
    //
    // This used to read `textarea[id], input[type="text"][id], select[id]` —
    // every text field on every page — with a short list of exceptions. That
    // meant the site quietly kept, forever and per browser: the WiFi password
    // typed into the QR creator, the HMAC secret typed into the JWT debugger,
    // whole documents from the markdown editor and the diff checker, the
    // vCard fields, the mail body, and the search term from the front page.
    // 88 fields across 29 pages, against 7 exceptions. Nothing ever deleted
    // any of it, and the privacy policy said the site stored two keys.
    //
    // An exception list cannot hold that line: the next tool with a password
    // field leaks by default, and nobody finds out. So the default is now
    // "remember nothing", and a field has to ask:
    //
    //     <select id="outputFormat" data-save>
    //
    // Mark settings — a format, a mode, a unit, a timezone. Never a field
    // that carries what someone typed, and never an output. If you are not
    // sure, leave it off: the cost is that a dropdown forgets, and the cost
    // of the other mistake is somebody's password sitting in localStorage.
    // tests/test-autosave-nur-einstellungen.js checks this.
    const pageId = window.location.pathname; // Unique key per tool

    // One-time clear-out of what the old rule left behind. It cannot be
    // selective: a key belongs to whichever page wrote it, and this page can
    // only see its own fields. Everything under the prefix goes, and the
    // marked fields fill up again as they are used. Losing a remembered
    // dropdown is the right price for not leaving a signing key behind on
    // someone's machine.
    try {
        if (!localStorage.getItem('ll_autosave_bereinigt_v1')) {
            Object.keys(localStorage)
                .filter(key => key.startsWith('autosave_'))
                .forEach(key => localStorage.removeItem(key));
            localStorage.setItem('ll_autosave_bereinigt_v1', '1');
        }
    } catch (err) { /* kein Speicher, nichts aufzuräumen */ }

    const inputsToSave = document.querySelectorAll(
        'textarea[data-save][id], input[type="text"][data-save][id], select[data-save][id]');

    inputsToSave.forEach(input => {
        const storageKey = `autosave_${pageId}_${input.id}`;
        
        // Restore.
        //
        // This used to read `if (saved !== null && input.value === '')`, and
        // that condition is never true for a <select>: a dropdown with
        // options always has a value. Every marked field is a dropdown, so
        // the setting was written on every change and never once read back —
        // storage with no purpose, while the privacy policy said it was there
        // to bring a tool back the way you left it. Found by measuring all 32
        // fields in a browser, not by reading the line.
        //
        // Some of the dropdowns are filled by their own script after this
        // runs (timezones, currencies), and setting a value an option does
        // not have yet silently does nothing. So: try, and if the option is
        // not there, watch the element until it is.
        const savedValue = localStorage.getItem(storageKey);
        if (savedValue !== null) wiederherstellen(input, savedValue);

        let debounceTimer;
        // Save on Input
        input.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            // ⚡ Bolt Performance Optimization:
            // Debounce synchronous localStorage writes to prevent main-thread
            // blocking and UI jank during rapid typing (especially in large textareas).
            debounceTimer = setTimeout(() => {
                localStorage.setItem(storageKey, e.target.value);
            }, 300);
        });
        
        // Save on Change (for selects)
        input.addEventListener('change', (e) => {
            localStorage.setItem(storageKey, e.target.value);
        });
    });

    /* Einen gespeicherten Wert zurücksetzen, auch wenn die Auswahl ihre
       Einträge erst später bekommt. Nach zehn Sekunden ist Schluss: dann
       gibt es die Option nicht mehr, und der alte Wert wäre ohnehin falsch. */
    function wiederherstellen(feld, wert) {
        const passt = () => feld.tagName !== 'SELECT' ||
            [...feld.options].some((o) => o.value === wert);

        if (passt()) { feld.value = wert; return; }

        const beobachter = new MutationObserver(() => {
            if (!passt()) return;
            feld.value = wert;
            feld.dispatchEvent(new Event('change', { bubbles: true }));
            beobachter.disconnect();
        });
        beobachter.observe(feld, { childList: true, subtree: true });
        setTimeout(() => beobachter.disconnect(), 10_000);
    }

    // Helper: Clear specific autosave. Nothing in the site calls it; it is
    // here for a tool that wants to forget a field on demand.
    window.clearAutoSave = function(elementIds) {
        if (!Array.isArray(elementIds)) elementIds = [elementIds];
        elementIds.forEach(id => {
            localStorage.removeItem(`autosave_${pageId}_${id}`);
        });
    }
});

/* === GLOBAL UTILITY FUNCTIONS === */

// Show Toast Notification
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return; 
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Copy Text to Clipboard
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard!', 'success');
    }).catch(err => {
        showToast('Failed to copy', 'error');
    });
}

// Format File Size (Bytes -> KB/MB)
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Setup Drag and Drop Zone
function setupDropZone(dropZone, fileInput, onFilesSelected) {
    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length) {
            fileInput.files = e.dataTransfer.files;
            onFilesSelected(e.dataTransfer.files); 
        }
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) {
            onFilesSelected(fileInput.files);
        }
    });
}

const PAGE_TITLE = document.title;

function setupSEO() {
    // 1. Get Page Details
    const h1 = document.querySelector('h1');
    const descP = document.querySelector('.tool-header p') || document.querySelector('p'); // Fallback to first p
    
    // Default values if H1 is missing
    // An h1 can be present but render to nothing — the scene planner's wordmark
    // collapses to 0x0, so innerText is empty and the tab was called "| Linus
    // Linhof". Fall back to the page's own <title>, read once at load so a
    // second pass never sees a title this function already rewrote.
    // innerText is what we want and textContent only the stand-in: outside a
    // real browser (jsdom, in the test suite) innerText does not exist at
    // all, which is not the same as "renders to nothing" and must not take
    // the rest of this function down with it.
    const renderedText = (el) => {
        if (!el) return '';
        return (el.innerText !== undefined ? el.innerText : el.textContent) || '';
    };

    const heading = renderedText(h1).trim() || PAGE_TITLE.split('|')[0].trim();
    const titleText = heading ? heading + ' | Linus Linhof' : 'Linus Linhof Toolbox';
    const descText = renderedText(descP).trim() || 'A privacy-first suite of web utilities.';
    const currentUrl = window.location.href;
    
    // Determine path to social image (assuming you put one at assets/og-image.jpg)
    // We need to calculate relative path back to root
    const inToolsDir = window.location.pathname.includes('/tools/');
    const origin = window.location.origin;
    // Replace this URL with your actual hosted image URL for best social reliability
    const imagePath = `${origin}/assets/og-image.jpg`; 

    // 2. Set Document Title
    document.title = titleText;

    // 3. Helper to update/create meta tags
    const setMeta = (name, value, isProperty = false) => {
        const attr = isProperty ? 'property' : 'name';
        let element = document.querySelector(`meta[${attr}="${name}"]`);
        if (!element) {
            element = document.createElement('meta');
            element.setAttribute(attr, name);
            document.head.appendChild(element);
        }
        element.setAttribute('content', value);
    };

    // 4. Set Standard Meta
    setMeta('description', descText);
    setMeta('theme-color', '#faf6f2');

    // 5. Set Open Graph (Facebook/LinkedIn/Discord)
    setMeta('og:title', titleText, true);
    setMeta('og:description', descText, true);
    setMeta('og:image', imagePath, true);
    setMeta('og:url', currentUrl, true);
    setMeta('og:type', 'website', true);

    // 6. Set Twitter Card
    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:title', titleText);
    setMeta('twitter:description', descText);
    setMeta('twitter:image', imagePath);
}

// === CALL IT INSIDE YOUR EXISTING LISTENER ===
document.addEventListener('DOMContentLoaded', () => {
    // ... your existing header/footer injection code ...

    // Run SEO Setup
    setupSEO(); 
    
    // ... rest of your code ...
});