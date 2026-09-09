import { existsSync, mkdirSync, readFileSync, readdirSync, copyFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const APP_DIR = fileURLToPath(new URL(".", import.meta.url));
const DATA_DIR = resolve(APP_DIR, "../data");

const CONTENT_TYPES: Record<string, string> = {
  ".geojson": "application/geo+json",
  ".json": "application/json",
};

/**
 * Serve the ETL output in `data/` (at the repo root) as `/data/*`, both for
 * the dev server and the production build. Keeps the build artifacts as the
 * single source of truth instead of duplicating them into `app/public/`.
 */
function dataPlugin() {
  return {
    name: "sperrmuell-data",
    configureServer(server: { middlewares: { use: (fn: (req: any, res: any, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/data/")) return next();
        const file = join(DATA_DIR, req.url.slice("/data/".length));
        if (!existsSync(file)) return next();
        res.setHeader("Content-Type", CONTENT_TYPES[extname(file)] ?? "application/octet-stream");
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      if (!existsSync(DATA_DIR)) return;
      const outDir = resolve(APP_DIR, "dist/data");
      mkdirSync(outDir, { recursive: true });
      for (const name of readdirSync(DATA_DIR)) {
        const src = join(DATA_DIR, name);
        if (extname(src) === ".geojson" || extname(src) === ".json") {
          copyFileSync(src, join(outDir, name));
        }
      }
    },
  };
}

/**
 * The files that decide how the built app is *served*, copied into the build
 * at the paths the web server expects.
 *
 * They belong in the build rather than in the website's repository, because
 * the alternative was tried: they lived only over there, so `dist/` was never
 * a complete copy of the directory it feeds, and mirroring the one onto the
 * other with --delete would have thrown them away. Anything that has to sit
 * next to the bundle is emitted here, and publishing is then a plain mirror
 * with nothing to remember and nothing to exclude.
 */
function servePlugin() {
  const dateien: Array<[string, string]> = [
    ["serve/assets.htaccess", "assets/.htaccess"],
    ["serve/data.htaccess", "data/.htaccess"],
    // The worker that retires the registration from the app's own previous
    // address. See serve/abgemeldet-sw.js — it is emitted here because the
    // app is what moved, so the app is what owes the people who were there
    // before a way out of the old scope.
    ["serve/abgemeldet-sw.js", "abgemeldet-sw.js"],
  ];
  return {
    name: "sperrmuell-serve",
    closeBundle() {
      for (const [von, nach] of dateien) {
        const quelle = resolve(APP_DIR, von);
        if (!existsSync(quelle)) throw new Error(`serve/: ${von} is missing`);
        const ziel = resolve(APP_DIR, "dist", nach);
        mkdirSync(resolve(ziel, ".."), { recursive: true });
        copyFileSync(quelle, ziel);
      }
    },
  };
}

export default defineConfig({
  /**
   * The map is served from linu.li/tools/sperrmuell/, and Vite writes this
   * path into the build: the asset URLs in index.html, and BASE_URL where
   * main.ts registers the worker and dataLoader.ts fetches `data/`.
   *
   * It used to be passed as --base on the command line, which nothing
   * recorded — a build without the flag produced a bundle that asked for
   * /assets/... and /sw.js at the domain root and failed on every one. It
   * lives here now so a plain `npm run build` is correct.
   *
   * Before September 2026 this was "/sperrmuell/". That address still
   * answers, but only as a redirect, plus one worker that retires the old
   * registration. Building with the old value puts the app back behind that
   * redirect: tests/test-kurz-adressen.js in the linu-li repository fails on
   * it, but only once the output has been committed there.
   */
  base: "/tools/sperrmuell/",
  plugins: [dataPlugin(), servePlugin()],
  server: {
    host: true,
  },
});
