/* ============================================================ *
 * Site-wide language switch.
 *
 * Two supported locales: English (default) and German. The choice is made
 * once per page load, before layout.js runs, so nothing flashes in the wrong
 * language on its way to the right one.
 *
 * How the choice is made, in order:
 *   1. ?lang=en|de in the URL wins over everything. This is what the footer
 *      switch uses, and what somebody sharing a link uses to force a locale.
 *   2. localStorage 'll_lang' — remembered from the last click on the switch.
 *   3. navigator.language — the browser tells us. Anything starting 'de' is
 *      German, otherwise English. A Swiss browser reporting 'de-CH' is still
 *      German; a French browser reporting 'fr-FR' gets English.
 *   4. English, as a floor. There is no third language.
 *
 * A page can lock itself to one locale with data-lang-lock="de" on <html>.
 * The stage planner (Bühnenbild) and the Bonn Sperrmüll map do this — they
 * are German by design. The footer switch is hidden on those pages, so
 * nothing appears to break when the button quietly does nothing.
 * ============================================================ */

(function () {
    'use strict';

    var STORAGE_KEY = 'll_lang';
    var SUPPORTED = ['en', 'de'];
    var DEFAULT = 'en';

    function normalise(raw) {
        if (!raw) return null;
        var short = String(raw).toLowerCase().slice(0, 2);
        return SUPPORTED.indexOf(short) === -1 ? null : short;
    }

    function fromQuery() {
        try {
            var q = new URLSearchParams(window.location.search).get('lang');
            return normalise(q);
        } catch (err) { return null; }
    }

    function fromStorage() {
        try { return normalise(localStorage.getItem(STORAGE_KEY)); }
        catch (err) { return null; }
    }

    function fromBrowser() {
        var langs = [];
        if (navigator.languages && navigator.languages.length) langs = navigator.languages;
        else if (navigator.language) langs = [navigator.language];
        for (var i = 0; i < langs.length; i++) {
            var l = normalise(langs[i]);
            if (l) return l;
        }
        /* Nothing in the reported list matches a supported locale. Anything
           starting with something other than 'en' or 'de' — French, Chinese,
           Arabic — gets English, per the site's rule. */
        return DEFAULT;
    }

    function pageLock() {
        var el = document.documentElement;
        return normalise(el && el.getAttribute('data-lang-lock'));
    }

    var lockedTo = pageLock();
    var chosen = lockedTo || fromQuery() || fromStorage() || fromBrowser();

    /* Set the html[lang] and html[data-lang] attributes before the first
       paint. layout.js reads data-frame="de" as well — kept as the legacy
       key so pages that still ask for a German frame explicitly are not
       overridden by the auto-detected English default. */
    var html = document.documentElement;
    var frame = html.getAttribute('data-frame');
    if (frame === 'de') chosen = 'de';
    html.setAttribute('lang', chosen);
    html.setAttribute('data-lang', chosen);
    if (chosen === 'de') html.setAttribute('data-frame', 'de');

    /* The translation lookup. Two shapes: t(en, de) for inline callers, and
       t(key, dict) for dict-driven callers. The inline form is what the old
       layout.js `say(en, de)` did — kept because it reads well next to a
       template literal. */
    function t(a, b) {
        if (typeof a === 'string' && typeof b === 'string') {
            return chosen === 'de' ? b : a;
        }
        if (a && typeof a === 'object') {
            return a[chosen] || a[DEFAULT] || '';
        }
        return a;
    }

    /* Walk a subtree and swap the text of anything that carries a data-de or
       data-en attribute. The English text stays in the markup as the source
       of truth; the German is an overlay. This runs on DOMContentLoaded and
       again after layout.js injects its header/footer. */
    function apply(root) {
        root = root || document;
        if (!root.querySelectorAll) return;

        /* Text swap. data-de holds the German string; the English one is
           whatever was already in the element. Empty data-de means "same in
           both", which is legal and does nothing. */
        var textNodes = root.querySelectorAll('[data-de]');
        for (var i = 0; i < textNodes.length; i++) {
            var el = textNodes[i];
            var de = el.getAttribute('data-de');
            if (chosen === 'de') {
                /* Remember the English original the first time we touch it,
                   so a re-apply on a language flip finds it again. */
                if (!el.hasAttribute('data-en-original')) {
                    el.setAttribute('data-en-original', el.textContent);
                }
                el.textContent = de;
            } else {
                var original = el.getAttribute('data-en-original');
                if (original !== null) el.textContent = original;
            }
        }

        /* Attribute swap. data-de-attr="placeholder:Text hier|aria-label:…"
           swaps one or more named attributes. Same pattern for the English
           fallback stored under data-en-attr-original per attribute. */
        var attrNodes = root.querySelectorAll('[data-de-attr]');
        for (var j = 0; j < attrNodes.length; j++) {
            applyAttrs(attrNodes[j]);
        }

        /* Title, if the <title> element carries a data-de. */
        var title = document.querySelector('title[data-de]');
        if (title) document.title = title.textContent;
    }

    function applyAttrs(el) {
        var spec = el.getAttribute('data-de-attr');
        var pairs = spec.split('|');
        for (var i = 0; i < pairs.length; i++) {
            var colon = pairs[i].indexOf(':');
            if (colon === -1) continue;
            var name = pairs[i].slice(0, colon).trim();
            var deValue = pairs[i].slice(colon + 1);
            var originalKey = 'data-en-attr-' + name;
            if (chosen === 'de') {
                if (!el.hasAttribute(originalKey)) {
                    el.setAttribute(originalKey, el.getAttribute(name) || '');
                }
                el.setAttribute(name, deValue);
            } else {
                var original = el.getAttribute(originalKey);
                if (original !== null) el.setAttribute(name, original);
            }
        }
    }

    /* The switch. Called from the footer button. Persists, then reloads the
       page with ?lang=… stripped so a bookmark stays clean.

       A full navigation, not an in-place swap: layout.js builds the chrome
       once at DOMContentLoaded and tools bind against it, so getting the
       new locale everywhere without a reload would mean re-running that
       whole path. The theme toggle handles its state the same way in
       spirit (persist and let the next paint pick it up). */
    function setLang(next) {
        next = normalise(next) || DEFAULT;
        if (lockedTo) return;
        try { localStorage.setItem(STORAGE_KEY, next); } catch (err) { /* private mode */ }
        var url = new URL(window.location.href);
        var hadLangParam = url.searchParams.has('lang');
        url.searchParams.delete('lang');
        var target = url.pathname + (url.search ? url.search : '') + url.hash;
        if (hadLangParam) {
            window.location.href = target;
        } else {
            window.location.reload();
        }
    }

    function otherLang() {
        return chosen === 'de' ? 'en' : 'de';
    }

    window.LL_I18N = {
        lang: chosen,
        locked: !!lockedTo,
        t: t,
        apply: apply,
        setLang: setLang,
        otherLang: otherLang
    };

    /* First sweep as soon as the DOM is parsed, second one after layout.js
       has inserted the header/footer. layout.js calls LL_I18N.apply()
       explicitly right after insertAdjacentHTML for that second pass. */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { apply(); });
    } else {
        apply();
    }
})();
