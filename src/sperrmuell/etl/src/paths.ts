import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Absolute path to src/sperrmuell/ (two levels up from etl/src/). */
export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export const CACHE_DIR = join(REPO_ROOT, ".cache");
/**
 * Straight into the directory the website serves. The map's data used to be
 * written here and copied over by the build, which made two copies that
 * could disagree; now there is the one that is served, committed with the
 * rest of the site.
 */
export const DATA_DIR = join(REPO_ROOT, "../../tools/sperrmuell/data");
export const OSM_CACHE_DIR = join(CACHE_DIR, "osm");
/**
 * The Sperrmüll part of each year's schedule, one file per year
 * (sperrmuell-2026.csv), committed. The city's full export is 25 MB and
 * holds every kind of collection; these are the few hundred rows the map
 * needs. Being in git, they are what the data is built from, and a
 * schedule the city takes down again is not lost with it.
 */
export const TERMINE_DIR = join(REPO_ROOT, "etl/termine");
