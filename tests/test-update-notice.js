/**
 * "A new version is ready" — the prompt, end to end (Puppeteer).
 *
 * The worker no longer takes over on its own (sw.js has no skipWaiting any
 * more), so this prompt is the only thing that hands a running tab the new
 * code. If it stops appearing, nothing breaks and nothing complains: visitors
 * simply keep running whatever they had until they close every tab.
 *
 * The test deploys twice, by hand. A deploy is two substitutions in sw.js —
 * the commit into DEPLOY_SHA, the sentences into DEPLOY_NOTES — so a fake one
 * is two string replacements, and the browser cannot tell the difference: it
 * sees a file whose bytes changed and fetches a new worker.
 *
 * The prompt now appears the moment the new worker enters the waiting state:
 * no idle timer, no click-a-link trigger. That is what visitors expect from a
 * button called Reload, and the earlier design — 30 seconds on the page plus
 * 90 without input — meant that anyone who reloaded a handful of times to see
 * a fresh deploy got the new files without ever seeing the note that said
 * what changed. The test drives that direct path and reads the whole of
 * `ask()` on the way through.
 *
 * The locale check at the end proves that ?lang=de gives the German prompt
 * ("Neu laden", "Später") and ?lang=en gives the English one. That is the
 * only difference the i18n workover made to this flow — nothing else in the
 * update path is locale-sensitive.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';
const SW = path.join(__dirname, '..', 'sw.js');

function fail(msg) {
    console.error('FAIL: ' + msg);
    process.exitCode = 1;
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

/* After every step that sends the page away, we have to wait for the
   navigation. An evaluate that runs mid-navigation hangs until the protocol
   timeout and takes the whole run down with it. */
const arrived = (p) => p.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20_000 })
    .catch(() => {});
const TRACE = process.env.LL_SPUR === '1' || process.env.LL_TRACE === '1';
let stepNo = 0;
const trace = (what) => { if (TRACE) console.log('  [%d] %s', ++stepNo, what); };

/* What the deploy does: substitute the commit and the sentences. */
function deploy(template, sha, sentences) {
    fs.writeFileSync(SW, template
        .replace('__DEPLOY_SHA__', sha)
        .replace('[/* __DEPLOY_NOTES__ */]', JSON.stringify(sentences)));
}

(async () => {
    const template = fs.readFileSync(SW, 'utf8');
    if (!template.includes('__DEPLOY_SHA__') || !template.includes('__DEPLOY_NOTES__')) {
        fail('sw.js is not in its undeployed state — cannot fake a deploy from it');
        return;
    }

    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        /* The page navigates on its own mid-test (that is the point). An
           evaluate that runs into a navigation should give up rather than
           bring the whole run down with a protocol error. */
        protocolTimeout: 60_000,
    });

    try {
        const page = await browser.newPage();
        page.on('dialog', (d) => d.accept());

        /* A second tab, left open.
           Without it the waiting worker takes over the moment the first tab
           navigates away — no clients left, so it activates itself. That is
           the right behaviour, but it makes everything after the first
           navigation unobservable. Two open tabs are also the case worth
           checking: the second one must not be dragged along. */
        const other = await browser.newPage();

        trace('first version');
        /* ---- first version ---- */
        deploy(template, 'aaaaaaa', ['The first sentence.']);
        await page.goto(BASE + '/tools/word-counter/?lang=en', { waitUntil: 'networkidle2' });
        await page.evaluate(() => navigator.serviceWorker.ready).catch(() => {});
        await settle(1200);
        await page.reload({ waitUntil: 'networkidle2' });
        await settle(1200);
        if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
            fail('no worker took control — nothing under test');
            return;
        }

        trace('second tab');
        await other.goto(BASE + '/tools/case-converter/?lang=en', { waitUntil: 'networkidle2' });
        await other.evaluate(() => { window.__llNochDa = true; });
        await settle(600);

        trace('second version');
        /* ---- second version: the same path a deploy takes ---- */
        deploy(template, 'bbbbbbb',
            ['The first sentence.', 'The narrow gap is off the stage layout.']);
        // The browser sees the new sw.js on the next page load.
        await page.goto(BASE + '/tools/word-counter/?lang=en', { waitUntil: 'networkidle2' });
        await settle(2500);

        trace('waiting?');
        const waiting = await page.evaluate(async () =>
            !!(await navigator.serviceWorker.getRegistration())?.waiting);
        if (!waiting) {
            fail('the new worker did not install and wait — either sw.js is byte-identical ' +
                'across the two deploys, or skipWaiting is back');
            return;
        }

        trace('prompt straight away?');
        /* ---- the prompt appears the moment the new worker waits ---- */
        await page.waitForSelector('.ll-update', { timeout: 4000 }).catch(() => {});
        if (!(await page.$('.ll-update'))) {
            fail('the prompt did not appear after the new worker started waiting — the ' +
                'point of this design is that a Reload button is the first thing a ' +
                'returning visitor sees when there is a new version to offer');
            return;
        }

        const text = await page.evaluate(() => document.querySelector('.ll-update').innerText);
        if (!text.includes('The narrow gap is off the stage layout.')) {
            fail(`the prompt does not name what changed: ${JSON.stringify(text)}`);
        }
        if (text.split('The first sentence.').length > 2) {
            fail('the prompt repeats a sentence from the version already running — only ' +
                'what is new since the visitor\'s own version belongs in there');
        }

        /* On an English page the chrome must be English. */
        const enChrome = await page.evaluate(() => ({
            heading: document.querySelector('#ll-update-titel')?.textContent || '',
            reload: document.querySelector('.ll-update [data-tun="jetzt"]')?.textContent || '',
            later: document.querySelector('.ll-update [data-tun="spaeter"]')?.textContent || '',
        }));
        if (!/new version is ready/i.test(enChrome.heading)) {
            fail(`English prompt heading is wrong: ${JSON.stringify(enChrome.heading)}`);
        }
        if (!/reload/i.test(enChrome.reload)) {
            fail(`English Reload button is wrong: ${JSON.stringify(enChrome.reload)}`);
        }
        if (!/later/i.test(enChrome.later)) {
            fail(`English Later button is wrong: ${JSON.stringify(enChrome.later)}`);
        }

        trace('Escape');
        /* ---- "Later"/Escape closes the prompt; the page does not ask again ---- */
        await page.keyboard.press('Escape');
        await settle(600);
        if (await page.$('.ll-update')) {
            fail('Escape did not close the prompt — it is modal, so there has to be a ' +
                'way out that is not a button');
            return;
        }

        /* No click or link triggered the prompt — it came up because a worker
           was waiting. After closing, the page stays on its own URL because
           there was no `afterwards` to carry it away. */
        if (!(await page.evaluate(() => window.location.pathname.includes('word-counter')))) {
            fail('Escape navigated the visitor somewhere they did not click for');
            return;
        }

        /* ---- another deploy, new tab, and then "Reload" ----
           After a second deploy the tab expects the prompt just as instantly
           as the first time. */
        deploy(template, 'ccccccc',
            ['The first sentence.', 'The narrow gap is off the stage layout.',
             'And one more thing.']);

        await page.goto(BASE + '/tools/word-counter/?lang=en', { waitUntil: 'networkidle2' });
        await settle(2500);
        if (!(await page.evaluate(async () =>
            !!(await navigator.serviceWorker.getRegistration())?.waiting))) {
            fail('a further deploy produced no waiting worker');
            return;
        }
        await page.waitForSelector('.ll-update', { timeout: 4000 }).catch(() => {});
        if (!(await page.$('.ll-update'))) {
            fail('the prompt did not come up after a further deploy');
            return;
        }

        trace('Reload');
        /* ---- "Reload" swaps the worker and reloads ---- */
        const gone = arrived(page);
        await page.evaluate(() =>
            document.querySelector('.ll-update [data-tun="jetzt"]').click());
        await gone;
        await settle(1500);

        const now = await page.evaluate(async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            return { waits: !!reg?.waiting, dialogThere: !!document.querySelector('.ll-update') };
        });
        if (now.waits) fail('after "reload" the new worker is still waiting');
        if (now.dialogThere) fail('the prompt is still on screen after "reload"');

        trace('other tab intact');
        /* The neighbour tab must not have been affected by any of this. */
        const neighbourIntact = await other.evaluate(() => window.__llNochDa === true);
        if (!neighbourIntact) {
            fail('the second tab reloaded along with the first — nobody there pressed ' +
                'anything, and whatever was open in it is gone');
        }

        trace('German locale');
        /* ---- and once more with ?lang=de, to prove the chrome flips ---- */
        deploy(template, 'ddddddd',
            ['The first sentence.', 'The narrow gap is off the stage layout.',
             'And one more thing.', 'And one after that.']);

        const dePage = await browser.newPage();
        dePage.on('dialog', (d) => d.accept());
        await dePage.goto(BASE + '/tools/word-counter/?lang=de', { waitUntil: 'networkidle2' });
        await settle(2500);
        await dePage.waitForSelector('.ll-update', { timeout: 4000 }).catch(() => {});
        if (!(await dePage.$('.ll-update'))) {
            fail('the prompt did not come up on the German page');
        } else {
            const deChrome = await dePage.evaluate(() => ({
                heading: document.querySelector('#ll-update-titel')?.textContent || '',
                reload: document.querySelector('.ll-update [data-tun="jetzt"]')?.textContent || '',
                later: document.querySelector('.ll-update [data-tun="spaeter"]')?.textContent || '',
            }));
            if (!/neue Fassung/i.test(deChrome.heading)) {
                fail(`German prompt heading is wrong: ${JSON.stringify(deChrome.heading)}`);
            }
            if (!/neu laden/i.test(deChrome.reload)) {
                fail(`German Reload button is wrong: ${JSON.stringify(deChrome.reload)}`);
            }
            if (!/später/i.test(deChrome.later)) {
                fail(`German Later button is wrong: ${JSON.stringify(deChrome.later)}`);
            }
        }
        await dePage.close();

        if (!process.exitCode) {
            console.log('PASS: the prompt appears the moment a new worker waits, says ' +
                'what changed, hands over on "reload", leaves the other tab alone, and ' +
                'flips its buttons and heading between English and German.');
        }
    } finally {
        fs.writeFileSync(SW, template);
        await browser.close();
    }
})().catch((err) => {
    console.error('FAIL: ' + err.message);
    process.exit(1);
});
