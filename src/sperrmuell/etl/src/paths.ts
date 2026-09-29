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
export const CSV_CACHE_PATH = join(CACHE_DIR, "ABFUHRTERMINE2026OpenData.csv");
