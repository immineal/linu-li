import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Absolute path to the repo root (two levels up from etl/src/). */
export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export const CACHE_DIR = join(REPO_ROOT, ".cache");
export const DATA_DIR = join(REPO_ROOT, "data");
export const OSM_CACHE_DIR = join(CACHE_DIR, "osm");
export const CSV_CACHE_PATH = join(CACHE_DIR, "ABFUHRTERMINE2026OpenData.csv");
