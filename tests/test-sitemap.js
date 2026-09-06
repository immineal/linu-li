/**
 * sitemap.xml — agrees with robots.txt and with what is on disk.
 *
 * A sitemap that lists a different host than the one robots.txt points a
 * crawler at is, by the sitemap protocol, a cross-submission: the URLs in
 * it may simply be ignored. The two files drifted apart once already, so
 * this pins them together. It also catches a tool that was added or
 * removed without the sitemap following.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');

function fail(msg) {
    console.error('FAIL: ' + msg);
    process.exitCode = 1;
}

const robotsSitemap = (robots.match(/^\s*Sitemap:\s*(\S+)/im) || [])[1];
if (!robotsSitemap) {
    fail('robots.txt names no sitemap');
    process.exit(1);
}
const expectedOrigin = new URL(robotsSitemap).origin;

const locs = [...sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
if (locs.length === 0) fail('sitemap.xml lists no URLs at all');

// 1. One host, the one robots.txt sends crawlers to.
const wrongHost = locs.filter((u) => new URL(u).origin !== expectedOrigin);
if (wrongHost.length) {
    fail(
        `${wrongHost.length} of ${locs.length} sitemap URLs are on a different host than robots.txt declares ` +
        `(${expectedOrigin}), starting with ${wrongHost[0]}`
    );
}

// 2. Every listed URL is a file that exists.
for (const url of locs) {
    let p = new URL(url).pathname;
    if (p === '' || p === '/') p = '/index.html';
    else if (p.endsWith('/')) p += 'index.html';
    if (!fs.existsSync(path.join(ROOT, p))) fail(`sitemap lists ${url}, but ${p} is not in the repository`);
}

// 3. Every tool page is listed.
const toolsDir = path.join(ROOT, 'tools');
const listedPaths = new Set(locs.map((u) => new URL(u).pathname.replace(/\/?$/, '/')));
for (const tool of fs.readdirSync(toolsDir).sort()) {
    if (!fs.existsSync(path.join(toolsDir, tool, 'index.html'))) continue;
    if (!listedPaths.has(`/tools/${tool}/`)) fail(`tools/${tool}/ exists but is missing from sitemap.xml`);
}

if (process.exitCode) {
    console.error('Sitemap test failed.');
} else {
    console.log(`PASS: sitemap — ${locs.length} URLs, all on ${expectedOrigin}, all present, every tool listed`);
}
