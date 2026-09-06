/**
 * Diff Checker — XSS regression test (Puppeteer).
 *
 * The worker hands back HTML strings that the page drops into the diff
 * table with innerHTML. Anything the worker fails to escape therefore
 * becomes live markup. This walks a set of payloads through every diff
 * mode and both views and insists that nothing of them survives as an
 * element, an attribute or a running script.
 */
const puppeteer = require('puppeteer');

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

const PAYLOADS = [
    '<img src=x onerror="window.__xss=(window.__xss||0)+1">',
    '<script>window.__xss=(window.__xss||0)+1</script>',
    '"><img src=x onerror="window.__xss=(window.__xss||0)+1">',
    "<svg/onload=window.__xss=(window.__xss||0)+1>",
    // Whitespace-only input takes a separate early-return branch in formatCode.
    '   ',
    // Looks like JavaScript, so highlight.js takes the syntax-colouring path
    // rather than the plain escape.
    'const a = 1; // <img src=x onerror="window.__xss=(window.__xss||0)+1">',
];

const MODES = ['lines', 'words', 'chars'];

// Where the payload goes matters. The worker only auto-detects a language
// when the right-hand box has text; with it empty the language stays
// 'plaintext' and formatCode takes its own escaping branch instead of
// handing the string to highlight.js. Both branches have to hold.
const PLACEMENTS = [
    { name: 'right (highlighted)', left: () => 'harmless', right: (p) => p },
    { name: 'left, right empty (plaintext fallback)', left: (p) => p, right: () => '' },
];

function fail(msg) {
    console.error('FAIL: ' + msg);
    process.exitCode = 1;
}

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.goto(BASE + '/tools/diff-checker/', { waitUntil: 'networkidle2' });

    let checks = 0;

    for (const payload of PAYLOADS) {
      for (const placement of PLACEMENTS) {
        for (const mode of MODES) {
            for (const view of ['inline', 'side']) {
                await page.evaluate(() => { delete window.__xss; });

                await page.evaluate(
                    ({ left, right, mode }) => {
                        document.getElementById('inputOriginal').value = left;
                        document.getElementById('inputChanged').value = right;
                        document.getElementById('diffMode').value = mode;
                        document.getElementById('compareBtn').click();
                    },
                    { left: placement.left(payload), right: placement.right(payload), mode }
                );

                await page.waitForFunction(
                    () => !document.getElementById('resultBox').classList.contains('hidden'),
                    { timeout: 10000 }
                );
                await page.evaluate((v) => window.switchView(v), view);
                // Let any injected handler that needs a tick actually fire.
                await new Promise((r) => setTimeout(r, 60));

                const result = await page.evaluate(() => {
                    const body = document.getElementById('diffTableBody');
                    return {
                        xss: window.__xss || 0,
                        injected: body.querySelectorAll('img, script, svg, iframe, object, embed').length,
                        onAttr: Array.from(body.querySelectorAll('*')).filter((el) =>
                            Array.from(el.attributes).some((a) => /^on/i.test(a.name))
                        ).length,
                        text: body.textContent,
                    };
                });

                const where = `payload=${JSON.stringify(payload)} in ${placement.name} mode=${mode} view=${view}`;
                if (result.xss) fail(`script executed — ${where}`);
                if (result.injected) fail(`${result.injected} injected element(s) — ${where}`);
                if (result.onAttr) fail(`${result.onAttr} on* handler attribute(s) — ${where}`);

                // The payload must still be *visible* as text; escaping that
                // swallows the input would be a different bug. Only line mode
                // puts the whole payload in one row — the character and word
                // modes scatter it over more rows than the virtual scroller
                // renders at once.
                if (mode === 'lines' && payload.trim() && !result.text.includes(payload)) {
                    fail(`payload vanished from the output instead of being escaped — ${where}`);
                }
                checks++;
            }
        }
      }
    }

    await browser.close();

    if (process.exitCode) {
        console.error('Diff Checker XSS test failed.');
    } else {
        console.log('PASS: Diff Checker XSS — ' + checks + ' payload/placement/mode/view combinations, nothing escaped into the DOM');
    }
})().catch((err) => {
    console.error('FAIL: ' + err.message);
    process.exit(1);
});
