import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("..", import.meta.url));
const lies = (p: string) => readFileSync(resolve(APP, p), "utf8");

/**
 * The app is served from linu.li, and a handful of things about *how* have to
 * hold. None of them shows up in the app's own behaviour, which is why they
 * are checked here rather than trusted.
 *
 * The reason this file exists: the cache restriction below was fixed once
 * already, but in the copy that sits in the website's repository, and never
 * here. The source therefore still carried the bug, and the next `npm run
 * build` would have shipped it back out — the map would have wiped the whole
 * toolbox's offline storage again. A fix that only lives downstream is a fix
 * with an expiry date.
 */
describe("the service worker", () => {
  const sw = lies("public/sw.js");

  it("deletes only its own caches", () => {
    /* Cache Storage is per origin, not per worker. linu.li serves a second
       worker from the site root with its own cache on this same origin, and
       an unrestricted "delete everything that is not mine" empties it — so
       opening the map threw away what every tool had stored for offline use,
       and the next visit to a tool threw away the map's. */
    expect(sw).toMatch(/startsWith\("sperrmuell-"\)/);
    expect(sw).not.toMatch(/ll-toolbox/);
  });

  it("names its cache with the prefix it filters on", () => {
    const name = sw.match(/const CACHE_NAME = "([^"]+)"/)?.[1];
    expect(name).toBeDefined();
    expect(name!.startsWith("sperrmuell-")).toBe(true);
  });
});

describe("the worker that retires the old address", () => {
  const alt = lies("serve/abgemeldet-sw.js");

  /* The app used to answer at /sperrmuell/ and registered a worker from
     /sperrmuell/sw.js, which is still installed for everyone who opened it
     before the move. A worker script is never fetched through a redirect, so
     that address cannot simply 301 to the new one: it goes on serving this
     script instead, and this script takes the registration apart. */

  it("unregisters itself and sends open tabs on", () => {
    expect(alt).toMatch(/self\.registration\.unregister\(\)/);
    expect(alt).toMatch(/client\.navigate/);
  });

  it("answers no fetches, so requests reach the redirect", () => {
    expect(alt).not.toMatch(/addEventListener\(\s*["']fetch["']/);
  });

  it("clears its own caches and leaves the toolbox alone", () => {
    expect(alt).toMatch(/startsWith\("sperrmuell-"\)/);
    expect(alt).not.toMatch(/ll-toolbox/);
  });
});

describe("the build", () => {
  const config = lies("vite.config.ts");

  it("carries the base path the site serves the app from", () => {
    /* It used to be passed as --base on the command line and recorded
       nowhere, so a plain `npm run build` produced a bundle that asked for
       /assets/… at the domain root and failed on every request. */
    expect(config).toMatch(/base:\s*"\/tools\/sperrmuell\/"/);
  });

  it("emits the files that decide how it is served", () => {
    /* Without these in the build, dist/ is not a complete copy of the
       directory it feeds, and publishing with --delete removes them. */
    for (const datei of ["serve/assets.htaccess", "serve/data.htaccess", "serve/abgemeldet-sw.js"]) {
      expect(config).toContain(datei);
    }
  });

  it("does not hold the workers for a year", () => {
    /* The immutable rule is for the content-hashed bundles under assets/.
       A service worker caught by it is the one file that must never be. */
    const regeln = lies("serve/assets.htaccess");
    expect(regeln).toMatch(/max-age=31536000, immutable/);
    expect(regeln.replace(/#[^\n]*/g, "")).not.toMatch(/sw\.js/);
  });
});
