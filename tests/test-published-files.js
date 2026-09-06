/**
 * What the deploy actually puts on the web server.
 *
 * The website is deployed by mirroring the checkout, so anything sitting in
 * the repository root is public unless the deploy removes it first. Test
 * harnesses, the dependency manifest and a local dev server were all being
 * served that way for months, and nothing said so.
 *
 * This applies the deploy's own removal rules — read out of the workflow,
 * so the two cannot drift — and insists that what survives at the top level
 * is exactly the list below. A new file in the root fails here until
 * somebody decides which side it belongs on.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// Everything the website itself serves from its top level.
const PUBLISHED = [
    '.htaccess',
    'LICENSE',
    'impressum.html',
    'index.html',
    'privacy.html',
    'robots.txt',
    'sitemap.xml',
    'sw.js',
];

function fail(msg) {
    console.error('FAIL: ' + msg);
    process.exitCode = 1;
}

const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/deploy.yml'), 'utf8');

// The `rm -f` lines of the strip step carry the root-level patterns.
const patterns = [];
for (const line of workflow.split('\n')) {
    const m = line.match(/^\s*rm -f\s+(.*)$/);
    if (m) patterns.push(...m[1].trim().split(/\s+/));
}
const dirs = [];
for (const line of workflow.split('\n')) {
    const m = line.match(/^\s*rm -rf\s+(.*)$/);
    if (m) dirs.push(...m[1].trim().split(/\s+/));
}
if (patterns.length === 0) fail('found no "rm -f" line in the deploy workflow — has the strip step moved?');

const globToRe = (g) =>
    new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');
const stripped = patterns.map(globToRe);

const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const rootFiles = tracked.filter((f) => !f.includes('/')).sort();

const survives = rootFiles.filter((f) => !stripped.some((re) => re.test(f)));

const unexpected = survives.filter((f) => !PUBLISHED.includes(f));
for (const f of unexpected) {
    fail(`${f} would be uploaded to the web server. Either add it to PUBLISHED in this test, or have the deploy's strip step remove it.`);
}
const missing = PUBLISHED.filter((f) => !survives.includes(f));
for (const f of missing) {
    fail(`${f} is listed as published but would not reach the server — it is gone from the repository, or the strip step now removes it.`);
}

// The directories the strip step drops must actually be the dev ones.
for (const d of dirs) {
    if (/^(tools|assets|sperrmuell)$/.test(d)) fail(`the deploy strips "${d}/", which the website needs`);
}

if (process.exitCode) {
    console.error('Published files test failed.');
} else {
    console.log(`PASS: published files — ${survives.length} of ${rootFiles.length} root files reach the server, and they are the expected ones`);
}
