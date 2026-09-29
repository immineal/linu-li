/**
 * Copy the build into tools/sperrmuell/, the directory the website serves.
 *
 * The deploy workflow and CI run this after `npm run build`; locally it is
 * how the map gets into the site to be looked at. Only data/ is committed
 * over there, and the build carries a copy of it, so the mirror leaves it
 * as it is.
 *
 * This used to be done by hand, and that is how the two drifted: a fix to the
 * service worker was made in the copy over there and never here, so the
 * source still carried the bug and the next build would have shipped it back
 * out. There is now one command, and `dist/` is a complete picture of the
 * directory it feeds — the .htaccess rules and the retiring worker are
 * emitted by the build too — so this is a plain mirror with nothing to
 * exclude and nothing to remember.
 *
 *   npm run publish:site            -- default target
 *   npm run publish:site -- <path>  -- somewhere else
 *   npm run publish:site -- --dry   -- say what would change, touch nothing
 *
 * It mirrors with --delete, which removes whatever is in the target and not
 * in the build. That is the point (an old content-hashed bundle has to go),
 * and it is also why the checks below refuse to run against a directory that
 * does not look like the one intended.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(APP, "dist");

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const ziel = resolve(args.find((a) => !a.startsWith("--")) ??
  join(APP, "../../../tools/sperrmuell"));

function stop(...zeilen) {
  for (const z of zeilen) console.error(z);
  process.exit(1);
}

// ---- is there a build, and is it a whole one? ----
if (!existsSync(DIST)) stop("No dist/. Run `npm run build` first.");

const verlangt = [
  "index.html",
  "manifest.webmanifest",
  "favicon.svg",
  "sw.js",
  "abgemeldet-sw.js",
  "assets/.htaccess",
  "data/.htaccess",
  "data/index.json",
];
const fehlt = verlangt.filter((f) => !existsSync(join(DIST, f)));
if (fehlt.length) {
  stop(
    "The build is incomplete, and publishing it would delete these from the website:",
    ...fehlt.map((f) => "  " + f),
    "",
    "The .htaccess rules and abgemeldet-sw.js come from app/serve/ via the",
    "servePlugin in vite.config.ts. Check that it still runs.",
  );
}
const bundles = readdirSync(join(DIST, "assets")).filter((f) => f.endsWith(".js"));
if (bundles.length === 0) stop("No bundle under dist/assets/ — that is not a finished build.");

// ---- does the target look like the place we mean? ----
// --delete is unforgiving, so this refuses anything that is not recognisably
// the tool directory inside that repository.
const repo = resolve(ziel, "../..");
const kennzeichen = [
  [join(repo, "index.html"), "the site's front page"],
  [join(repo, "sw.js"), "the site's own service worker"],
  [join(repo, "tools"), "the tools directory"],
];
const daneben = kennzeichen.filter(([p]) => !existsSync(p));
if (daneben.length || !existsSync(join(repo, ".git"))) {
  stop(
    `${ziel} does not look like linu-li/tools/sperrmuell.`,
    ...daneben.map(([p, was]) => `  missing ${was}: ${p}`),
    !existsSync(join(repo, ".git")) ? `  missing a git repository at ${repo}` : "",
    "",
    "Refusing to mirror with --delete into a directory this cannot identify.",
    "Pass the right path: npm run publish:site -- <path-to>/linu-li/tools/sperrmuell",
  );
}
if (existsSync(ziel) && !statSync(ziel).isDirectory()) stop(`${ziel} is not a directory.`);

// ---- mirror ----
const rsync = ["-a", "--delete", "--itemize-changes", DIST + "/", ziel + "/"];
if (dry) rsync.unshift("--dry-run");
const aus = execFileSync("rsync", rsync, { encoding: "utf8" }).trim();

console.log(`${dry ? "Would mirror" : "Mirrored"} ${verlangt.length - 1}+ files into ${ziel}`);
console.log(aus ? aus.split("\n").map((z) => "  " + z).join("\n") : "  (already identical)");
if (!dry && aus) {
  console.log("");
  console.log("Nothing to commit except data/: the rest of tools/sperrmuell/ is ignored");
  console.log("by git and built again on every deploy.");
}
