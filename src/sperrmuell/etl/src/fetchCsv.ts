import { readFileSync } from "node:fs";
import { ensureDirFor, readCache, writeCache } from "./cache.js";
import { CSV_CACHE_PATH } from "./paths.js";

export const CSV_URL = "https://opendata.bonn.de/sites/default/files/ABFUHRTERMINE2026OpenData.csv";
const CSV_HOST = "opendata.bonn.de";
const CACHE_PATH = CSV_CACHE_PATH;

/**
 * Load the bonnorange "Abfuhrtermine 2026" CSV.
 *
 * - If `inputPath` is given (--input CLI flag), read that local file
 *   directly (no network).
 * - Otherwise use a cached copy at .cache/ if present.
 * - Otherwise download it from opendata.bonn.de and cache it.
 *
 * A network failure is reported with the exact host to allowlist, never
 * silently replaced with fabricated data.
 */
export async function loadCsv(inputPath?: string): Promise<string> {
  if (inputPath) {
    console.log(`[csv] reading local file ${inputPath}`);
    return readFileSync(inputPath, "utf-8");
  }

  const cached = readCache(CACHE_PATH);
  if (cached !== null) {
    console.log(`[csv] using cached ${CACHE_PATH}`);
    return cached;
  }

  console.log(`[csv] fetching ${CSV_URL}...`);
  let response: Response;
  try {
    response = await fetch(CSV_URL);
  } catch (err) {
    throw new Error(
      `Could not reach ${CSV_HOST}. If this environment has restricted network access, ` +
        `please allowlist ${CSV_HOST}, or download the CSV manually and re-run with ` +
        `--input <path-to-csv>.\nUnderlying error: ${(err as Error).message}`,
    );
  }
  if (!response.ok) {
    throw new Error(`Failed to download CSV from ${CSV_URL}: HTTP ${response.status}`);
  }

  const buf = Buffer.from(await response.arrayBuffer());
  const text = buf.toString("utf-8");
  ensureDirFor(CACHE_PATH);
  writeCache(CACHE_PATH, text);
  console.log(`[csv] cached to ${CACHE_PATH} (${text.length} bytes)`);
  return text;
}
