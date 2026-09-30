if ('serviceWorker' in navigator) {
    // Always the one at the root. A worker's reach stops at the directory it
    // is served from, so the old one under /assets/ controlled no page at all
    // and the site was never actually available offline.
    navigator.serviceWorker.register('/sw.js')
        .then(offerNewVersion)
        .catch(err => console.error('Service worker registration failed:', err));

    // Visitors from before still carry that /assets/ registration around.
    // It controls nothing, but it holds an old cache. Send it on its way.
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
 *   - It asks at the first safe moment. Either the visitor is about to
 *     leave this page anyway (an internal link), or they have stopped doing
 *     anything for a while. Whichever comes first.
 *   - It never asks a page twice. "Later" is a variable, not a stored
 *     preference. Nothing is written down, nothing needs a line in the
 *     privacy policy, and the next page asks once more. A visitor who keeps
 *     dismissing it still gets the new version the moment they close the tab.
 *
 * The sentences come from the waiting worker, which carries every note since
 * the version this page is running (assets/update-note.txt -> sw.js). Asking
 * somebody to reload without saying why is how update prompts get trained
 * away.
 * ============================================================ */

const VISIBLE_NOTES = 5;

function offerNewVersion(registration) {
    if (!registration) return;

    let alreadyAsked = false;      // this page, not this browser
    let itWasMe = false;           // only the tab that clicked reloads

    /* At the top on purpose. `check()` further down runs while this function
       body is still being processed, and it calls `schedule()`, which reads
       both of these. If they sat below, the access threw in the temporal
       dead zone, but only when a worker was already waiting at load time.
       When that happened, the rest of this function died, the click listener
       was never registered, and the notice never appeared again. All that
       was visible of it was a single line in the console. */
    let scheduled = false;

    /* A worker swap touches every tab. Without this lock, the neighbouring
       tab would reload along and throw away the file it has open, without
       anybody there having clicked anything. */
    let targetAfterSwap = null;
    let swapped = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!itWasMe || swapped) return;
        swapped = true;
        window.location.href = targetAfterSwap || window.location.href;
    });

    const waiting = () => registration.waiting;

    function check() {
        if (waiting()) schedule();
    }

    registration.addEventListener('updatefound', () => {
        const newer = registration.installing;
        if (!newer) return;
        newer.addEventListener('statechange', () => {
            if (newer.state === 'installed' && navigator.serviceWorker.controller) schedule();
        });
    });
    check();

    /**
     * No waiting. As soon as a new worker is installed and waiting, ask. This
     * also covers the case the idle-timer logic missed: somebody who wants to
     * watch the reload happen is never idle for 90 seconds, but they are
     * exactly the person who should get the prompt. On a background tab the
     * popup does no harm, they see it when they come back.
     *
     * A single guard against the case where registration.waiting is not yet
     * populated when the updatefound statechange fires. That happens shortly
     * after the installed transition, hence the deferral into the next task
     * round.
     */
    function schedule() {
        if (alreadyAsked || scheduled) return;
        scheduled = true;
        const runOnce = () => {
            if (alreadyAsked) return;
            if (!waiting()) return;
            if (document.body) ask();
            else document.addEventListener('DOMContentLoaded', () => ask(), { once: true });
        };
        if (waiting()) setTimeout(runOnce, 0);
        else setTimeout(runOnce, 100);
    }

    /* What the waiting worker is and what it has to say. */
    function askWorker(worker) {
        return new Promise((answer) => {
            if (!worker) return answer(null);
            const channel = new MessageChannel();
            const timer = setTimeout(() => answer(null), 2000);
            channel.port1.onmessage = (e) => { clearTimeout(timer); answer(e.data); };
            try { worker.postMessage({ frage: 'stand' }, [channel.port2]); }
            catch (err) { clearTimeout(timer); answer(null); }
        });
    }

    /* The click that triggered the notice wanted to go somewhere. */
    function goOn(address) { if (address) window.location.href = address; }

    async function ask(afterwards) {
        if (alreadyAsked) { goOn(afterwards); return; }
        alreadyAsked = true;

        /* Side by side, not one after the other. The click on the link is
           already intercepted, and two two-second deadlines back to back made
           it look dead for up to four seconds. */
        const [next, current] = await Promise.all([
            askWorker(waiting()),
            askWorker(navigator.serviceWorker.controller),
        ]);

        /* If the running worker does not know its own build, it is older
           than this mechanism. Nothing to tell, and the swap happens
           silently. That is the very first rollout. */
        if (!next || !current || !current.sha) { if (afterwards) goOn(afterwards); return; }

        /* Counted, not matched. The sentences the running worker did not know
           yet are the ones after its own count. */
        const all = next.notizen || [];
        const known = (current.notizen || []).length;
        const fresh = all.slice(known);
        if (!fresh.length) { if (afterwards) goOn(afterwards); return; }

        show(fresh, afterwards);
    }

    function show(notes, afterwards) {
        const t = (window.LL_I18N && window.LL_I18N.t)
            ? window.LL_I18N.t
            : ((en, de) => (document.documentElement.lang === 'de' ? de : en));

        const dialog = document.createElement('div');
        dialog.className = 'll-update';
        dialog.innerHTML = `
            <div class="ll-update-karte" role="dialog" aria-modal="true"
                 aria-labelledby="ll-update-titel">
              <h2 id="ll-update-titel">${t('A new version is ready', 'Eine neue Fassung ist da')}</h2>
              <ul></ul>
              <div class="ll-update-knoepfe">
                <button type="button" data-tun="spaeter">${t('Later', 'Später')}</button>
                <button type="button" data-tun="jetzt" class="ll-update-ja">${t('Reload', 'Neu laden')}</button>
              </div>
            </div>`;

        const list = dialog.querySelector('ul');
        notes.slice(0, VISIBLE_NOTES).forEach((text) => {
            const li = document.createElement('li');
            li.textContent = text;
            list.appendChild(li);
        });
        if (notes.length > VISIBLE_NOTES) {
            const rest = notes.length - VISIBLE_NOTES;
            const li = document.createElement('li');
            li.className = 'll-update-rest';
            li.textContent = t(`and ${rest} more`, `und ${rest} weitere`);
            list.appendChild(li);
        }

        const previousFocus = document.activeElement;
        const close = () => {
            document.removeEventListener('keydown', onKey, true);
            dialog.remove();
            if (previousFocus && previousFocus.focus) previousFocus.focus();
            goOn(afterwards);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
        };

        dialog.addEventListener('click', (e) => {
            const action = e.target.getAttribute && e.target.getAttribute('data-tun');
            if (action === 'spaeter' || e.target === dialog) return close();
            if (action !== 'jetzt') return;

            /* A tool that holds something says so. Whoever does not answer is
               taken as empty. Most tools are, and one with actual work in it
               has to speak up. tests/test-holds-work.js insists that every
               tool with a file input does. */
            let holds = false;
            try { holds = !!(window.llHoldsWork && window.llHoldsWork()); }
            catch (err) { holds = false; }
            /* Backwards compatibility: the hook used to be called llHaeltArbeit.
               A tool that still exports the old name during a deploy window
               should still be respected. */
            if (!holds) {
                try { holds = !!(window.llHaeltArbeit && window.llHaeltArbeit()); }
                catch (err) { holds = false; }
            }
            if (holds && !window.confirm(t(
                'This tool is still holding something that reloading will discard. Reload anyway?',
                'Dieses Werkzeug hält noch etwas, das beim Neuladen verloren geht. Trotzdem neu laden?'))) {
                return;
            }

            itWasMe = true;
            /* Someone who got here by clicking a link wanted to go somewhere.
               Reloading them on the old page instead would swallow their click.
               The new address does both at once: it picks up the new files and
               takes them where they wanted to go. */
            targetAfterSwap = afterwards || window.location.href;
            const w = waiting();
            if (w) w.postMessage({ frage: 'uebernimm' });
            /* If the worker does not accept the ask, the reload happens
               anyway. The page will fetch the new files itself. */
            setTimeout(() => { if (!swapped) window.location.href = targetAfterSwap; }, 1200);
        });

        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(dialog);
        const yesButton = dialog.querySelector('.ll-update-ja');
        if (yesButton) yesButton.focus();
    }
}

// The manifest is what makes the site installable. Only the front page
// carried a link to it, so a visitor who arrived straight at a tool was
// never offered the install. index.html still has its own link in the
// markup, which is better than waiting for this script, hence the check.
if (!document.querySelector('link[rel="manifest"]')) {
    const manifestLink = document.createElement('link');
    manifestLink.rel = 'manifest';
    manifestLink.href = '/assets/manifest.json';
    document.head.appendChild(manifestLink);
}

document.addEventListener('DOMContentLoaded', () => {
    const inToolsDir = window.location.pathname.includes('/tools/');
    const rootPath = inToolsDir ? '../../' : './';

    /* The site-wide t(). If i18n.js has not loaded (test harness, or a
       misconfigured page), fall back to the old data-frame="de" seed so this
       file still works in isolation. */
    const t = (window.LL_I18N && window.LL_I18N.t)
        ? window.LL_I18N.t
        : ((english, german) => (
            document.documentElement.getAttribute('data-frame') === 'de' ? german : english
        ));
    const lang = (window.LL_I18N && window.LL_I18N.lang) ||
        (document.documentElement.getAttribute('lang') === 'de' ? 'de' : 'en');
    /* The page is locked when either the runtime says so or the markup does.
       The buehnenbild page loads its own local i18n; it does not load the
       site-wide one, so window.LL_I18N is not there. The data-lang-lock
       attribute is the fallback signal that the page is not for switching. */
    const locked = !!(window.LL_I18N && window.LL_I18N.locked) ||
        !!document.documentElement.getAttribute('data-lang-lock');

    const headerHTML = `
    <header class="main-header">
        <nav>
            <a href="${rootPath}" class="logo-link">linu.li</a>
            <div style="display:flex; gap: 1.5rem; align-items: center;">
                <button id="theme-toggle" class="theme-switch" aria-label="${t('Switch between light and dark', 'Zwischen hell und dunkel wechseln')}">
                    <div class="switch-track">
                        <div class="switch-thumb"></div>
                    </div>
                </button>
            </div>
        </nav>
    </header>`;

    /* The language switch. Hidden on pages that lock a locale (buehnenbild
       and sperrmuell). "DE|EN" with the current one dimmed, one click flips.
       Uses aria-pressed so a screen reader hears which one is active. */
    const otherLang = lang === 'de' ? 'en' : 'de';
    const otherLabel = otherLang.toUpperCase();
    const langSwitchHTML = locked ? '' : `
        <button type="button" class="ll-lang-switch"
                aria-label="${t('Switch language to ' + otherLabel, 'Sprache auf ' + otherLabel + ' wechseln')}">
            <span class="ll-lang-current" aria-hidden="true">${lang.toUpperCase()}</span><span class="ll-lang-sep" aria-hidden="true"> | </span><span class="ll-lang-other" aria-hidden="true">${otherLabel}</span>
        </button>`;

    const footerHTML = `
    <footer style="text-align: center; padding: 3rem 1rem; opacity: 0.8; font-size: 0.9rem; border-top: 1px solid var(--border); margin-top: auto;">
        <div style="margin-bottom: 1.5rem;">
            <a href="https://ko-fi.com/linuslinhof" target="_blank" rel="noopener noreferrer" class="donate-btn">
                ${t('Buy me a coffee', 'Spendier mir einen Kaffee')}
            </a>
        </div>

        <p style="margin: 0 auto; text-align: center;">
            &copy; ${new Date().getFullYear()} Linus Linhof
        </p>
        <p style="margin: 0.5rem auto 0; opacity: 0.7; text-align: center;">
            <a href="${rootPath}impressum.html">${t('Legal notice', 'Impressum')}</a> &bull;
            <a href="${rootPath}privacy.html">${t('Privacy', 'Datenschutz')}</a>${langSwitchHTML ? ' &bull; ' + langSwitchHTML : ''}
        </p>
    </footer>
    <div id="toast-container" class="toast-container"></div>`;

    document.body.insertAdjacentHTML('afterbegin', headerHTML);
    document.body.insertAdjacentHTML('beforeend', footerHTML);

    /* A tool marks itself as archived with data-status="archiv". It is off
       the front page, but still runs. The notice belongs on the page itself,
       since from here on it is reached only through bookmarks and search
       engines. The front page has nothing left to point at it. It sits on
       top of the content rather than above the header, because it is a
       notice and not a warning. */
    if (document.documentElement.getAttribute('data-status') === 'archiv') {
        const spot = document.querySelector('main .container') || document.querySelector('main');
        if (spot) {
            spot.insertAdjacentHTML('afterbegin', `
            <p class="archive-note">
                ${t('Nobody is working on this tool any more. It still works, but it is off the front page.',
                    'Dieses Werkzeug wird nicht mehr weiterentwickelt. Es funktioniert weiter, steht aber nicht mehr auf der Startseite.')}
                ${t('Need it back? Write to', 'Brauchst du es? Schreib an')}
                <a href="mailto:feedback@linu.li">feedback@linu.li</a>
            </p>`);
        }
    }

    /* Wire up the language switch. Persists the choice and reloads. i18n.js
       is where the actual work lives; this button is only the trigger. */
    const langBtn = document.querySelector('.ll-lang-switch');
    if (langBtn && window.LL_I18N && !locked) {
        langBtn.addEventListener('click', () => {
            window.LL_I18N.setLang(window.LL_I18N.otherLang());
        });
    }

    /* Second i18n sweep after the header/footer are in the DOM. i18n.js did
       one on DOMContentLoaded, but the chrome was not there yet. */
    if (window.LL_I18N && window.LL_I18N.apply) window.LL_I18N.apply();

    const themeToggle = document.getElementById('theme-toggle');
    /* Without try/catch, everything below here fell over as soon as the
       browser blocked access (private window, site data blocked): the page
       came up light instead of dark, the toggle did not react, and the
       cleanup further down never ran. */
    let savedTheme = null;
    try { savedTheme = localStorage.getItem('theme'); } catch (err) { /* blocked */ }

    if (savedTheme !== 'light') {
        document.body.classList.add('dark-mode');
    }

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            try { localStorage.setItem('theme', isDark ? 'dark' : 'light'); } catch (err) { /* blocked */ }
        });
    }

    // Remembering fields across reloads. Opt-in, and it has to stay opt-in.
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
    // Mark settings, a format, a mode, a unit, a timezone. Never a field
    // that carries what someone typed, and never an output. If you are not
    // sure, leave it off: the cost is that a dropdown forgets, and the cost
    // of the other mistake is somebody's password sitting in localStorage.
    // tests/test-autosave-settings-only.js checks this.
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
    } catch (err) { /* no storage, nothing to clean */ }

    const inputsToSave = document.querySelectorAll(
        'textarea[data-save][id], input[type="text"][data-save][id], select[data-save][id]');

    inputsToSave.forEach(input => {
        const storageKey = `autosave_${pageId}_${input.id}`;

        // Restore.
        //
        // This used to read `if (saved !== null && input.value === '')`, and
        // that condition is never true for a <select>: a dropdown with
        // options always has a value. Every marked field is a dropdown, so
        // the setting was written on every change and never once read back.
        // Storage with no purpose, while the privacy policy said it was there
        // to bring a tool back the way you left it. Found by measuring all 32
        // fields in a browser, not by reading the line.
        //
        // Some of the dropdowns are filled by their own script after this
        // runs (timezones, currencies), and setting a value an option does
        // not have yet silently does nothing. So: try, and if the option is
        // not there, watch the element until it is.
        const savedValue = localStorage.getItem(storageKey);
        if (savedValue !== null) restore(input, savedValue);

        let debounceTimer;
        input.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            // A textarea fires this on every keystroke, and a localStorage
            // write is synchronous.
            debounceTimer = setTimeout(() => {
                localStorage.setItem(storageKey, e.target.value);
            }, 300);
        });

        input.addEventListener('change', (e) => {
            localStorage.setItem(storageKey, e.target.value);
        });
    });

    /* Restore a stored value even when the dropdown gets its options later.
       Ten seconds is the cutoff. After that the option is not coming, and
       the stored value would be wrong anyway.

       Fire 'change' in both paths, immediate and observed. Without it the
       tool never reruns its handler on load, and a remembered non-default
       choice arrives silently: qr-creator remembered "WiFi" but kept the
       URL form on screen, unit-converter came back with "km, mi" in the
       dropdowns but still showed the m/ft numbers, and every dropdown-driven
       tool had a subtler version of the same. */
    function restore(field, value) {
        const fits = () => field.tagName !== 'SELECT' ||
            [...field.options].some((o) => o.value === value);

        const apply = () => {
            field.value = value;
            field.dispatchEvent(new Event('change', { bubbles: true }));
        };

        if (fits()) { apply(); return; }

        const observer = new MutationObserver(() => {
            if (!fits()) return;
            apply();
            observer.disconnect();
        });
        observer.observe(field, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 10_000);
    }

    // Nothing in the site calls this. It is here for a tool that wants to
    // forget a field on demand.
    window.clearAutoSave = function(elementIds) {
        if (!Array.isArray(elementIds)) elementIds = [elementIds];
        elementIds.forEach(id => {
            localStorage.removeItem(`autosave_${pageId}_${id}`);
        });
    }
});

// The helpers below are globals on purpose: the tools call them directly.

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    // Drop any live toast that says exactly the same thing. Clicking Format
    // five times used to stack five identical "Formatted" toasts; every
    // JSONPath keystroke pause added another.
    Array.from(container.querySelectorAll('.toast')).forEach((old) => {
        if (old.textContent === message && !old.dataset.retiring) {
            old.dataset.retiring = '1';
            old.remove();
        }
    });
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    // Three seconds for a word or two, longer for a sentence that explains something
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, Math.max(3000, message.length * 60));
}

function copyToClipboard(text) {
    const t = (window.LL_I18N && window.LL_I18N.t)
        ? window.LL_I18N.t
        : ((en) => en);
    navigator.clipboard.writeText(text).then(() => {
        showToast(t('Copied to clipboard', 'In die Zwischenablage kopiert'), 'success');
    }).catch(err => {
        showToast(t('Could not copy to the clipboard', 'Kopieren in die Zwischenablage fehlgeschlagen'), 'error');
    });
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function setupDropZone(dropZone, fileInput, onFilesSelected) {
    if (!dropZone || !fileInput) return;

    /* Clear the input value before every open dialog. Without this a user who
       resets a tool and then picks the *same* file again gets nothing: the
       browser only fires 'change' when files differ from what was there
       before, and after a reset the input still remembers the last pick.
       Setting value = '' costs nothing when the input is already empty and
       fixes re-uploads across every file-input tool on the site
       (image-compressor, image-resizer, favicon-maker, pdf-merger, and a
       handful of others). */
    dropZone.addEventListener('click', () => {
        fileInput.value = '';
        fileInput.click();
    });

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
    const h1 = document.querySelector('h1');
    const descP = document.querySelector('.tool-header p') || document.querySelector('p');

    // An h1 can be present but render to nothing. The scene planner's wordmark
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
    const descText = renderedText(descP).trim() || 'Small tools that run in your browser tab.';
    const currentUrl = window.location.href;
    // Open Graph wants an absolute URL.
    const imagePath = `${window.location.origin}/assets/og-image.jpg`;

    document.title = titleText;

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

    setMeta('description', descText);
    setMeta('theme-color', '#faf6f2');

    setMeta('og:title', titleText, true);
    setMeta('og:description', descText, true);
    setMeta('og:image', imagePath, true);
    setMeta('og:url', currentUrl, true);
    setMeta('og:type', 'website', true);

    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:title', titleText);
    setMeta('twitter:description', descText);
    setMeta('twitter:image', imagePath);
}

document.addEventListener('DOMContentLoaded', () => {
    setupSEO();
});
