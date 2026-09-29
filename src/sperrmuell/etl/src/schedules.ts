import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "./csv.js";
import { TERMINE_DIR } from "./paths.js";

/**
 * Bonn publishes the collection schedule once a year, as a new file, usually
 * in December for the year after. The map shows this year's dates and, once
 * it is out, next year's too, so it keeps going past December.
 *
 *   refreshSchedules  downloads the years in the window and writes the
 *                     Sperrmüll rows to etl/termine/; run weekly by
 *                     .github/workflows/sperrmuell-daten.yml
 *   loadSchedules     reads what is there, for the build
 */

export const LICENSE = "Creative Commons Attribution 4.0 (CC BY 4.0) — bonnorange AöR / opendata.bonn.de";

/** Where the file has been every year so far. */
export function csvUrl(year: number): string {
  return `https://opendata.bonn.de/sites/default/files/ABFUHRTERMINE${year}OpenData.csv`;
}

/** The dataset page that links it, in case the file ever gets another name. */
export function datasetUrl(year: number): string {
  return `https://opendata.bonn.de/dataset/abfallplaner-m%C3%BCllabfuhrtermine-${year}`;
}

/** This year and the next. Earlier years are over and are not shown. */
export function windowYears(today: Date): number[] {
  const year = today.getUTCFullYear();
  return [year, year + 1];
}

const KEEP_COLUMNS = [
  "ID_TERMINE", "PLAN_BEZ", "PLAN_AB", "PLAN_BIS",
  "STRASSE1", "ORTSTEIL1", "PLZ1",
  "HNR_GE_AB", "HNR_GE_BIS", "HNR_UG_AB", "HNR_UG_BIS", "HNR_NEG", "STR_BEM1",
  "KREV", "KREVBEZ", "MREV", "MREVBEZ", "GREV", "GREVBEZ",
];

/**
 * The Sperrmüll rows of a full export, with the columns the build reads.
 * TERMIN columns stay only where a Sperrmüll row uses them. Returns null if
 * the text is not the export at all (an HTML error page, say) or carries no
 * Sperrmüll rows.
 */
export function trimSchedule(text: string): string | null {
  const { header, rows } = parseCsv(text);
  if (header[0] !== "ID_TERMINE" || !header.includes("PLAN_BEZ")) return null;
  const sperrmuell = rows.filter((r) => r.PLAN_BEZ === "Sperrmüll");
  if (sperrmuell.length === 0) return null;
  const termine = header.filter((h) => /^TERMIN\d+$/.test(h) && sperrmuell.some((r) => r[h]));
  const columns = [...KEEP_COLUMNS.filter((c) => header.includes(c)), ...termine];
  const lines = [columns.join(";"), ...sperrmuell.map((r) => columns.map((c) => r[c] ?? "").join(";"))];
  return lines.join("\n") + "\n";
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Four tries, backing off, for a dropped connection or a 5xx; a 4xx is an answer. */
async function fetchWithRetry(fetchFn: Fetch, url: string): Promise<Response> {
  let last = "";
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      // A hung connection must fail, not wait forever: the export is 25 MB,
      // and a stalled transfer once held a whole run until it was killed.
      const res = await fetchFn(url, {
        headers: { "User-Agent": "sperrmuell-bonn/1.0 (+https://linu.li/tools/sperrmuell/)" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status < 500) return res;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = (err as Error)?.message ?? String(err);
    }
    if (attempt < 4) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * 2 ** (attempt - 1)));
  }
  throw new Error(`${url} did not answer after four tries: ${last}`);
}

/** Exported for the tests, which have no time to wait. */
export let RETRY_DELAY_MS = 2000;
/** Per try, body included: a whole minute is ample for 25 MB. */
const REQUEST_TIMEOUT_MS = 60_000;
export function setRetryDelay(ms: number): void {
  RETRY_DELAY_MS = ms;
}

/**
 * Download one year's export and trim it. Tries the usual file name first,
 * and only if that is not there, any CSV the year's dataset page links to. Null when the city has not
 * published that year (yet); network trouble throws, so a bad connection is
 * never mistaken for "no schedule".
 */
export async function downloadSchedule(
  year: number,
  fetchFn: Fetch = fetch,
): Promise<{ url: string; csv: string } | null> {
  const direct = await tryCsv(fetchFn, csvUrl(year));
  if (direct) return direct;

  // Not under the usual name: look at what the year's dataset page links to.
  // An unknown page answers with the dataset listing, which links no CSV.
  const page = await fetchWithRetry(fetchFn, datasetUrl(year));
  if (!page.ok) return null;
  const html = await page.text();
  const links = new Set<string>();
  for (const m of html.matchAll(/href="([^"]+\.csv)"/gi)) {
    const url = new URL(m[1], "https://opendata.bonn.de/").href;
    if (url.includes(String(year)) && url !== csvUrl(year)) links.add(url);
  }
  for (const url of links) {
    const found = await tryCsv(fetchFn, url);
    if (found) return found;
  }
  return null;
}

async function tryCsv(fetchFn: Fetch, url: string): Promise<{ url: string; csv: string } | null> {
  const res = await fetchWithRetry(fetchFn, url);
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  const csv = trimSchedule(Buffer.from(await res.arrayBuffer()).toString("utf-8"));
  return csv ? { url, csv } : null;
}

export interface Schedule {
  year: number;
  url: string;
  text: string;
}

function fileFor(dir: string, year: number): string {
  return join(dir, `sperrmuell-${year}.csv`);
}

function readSources(dir: string): Record<string, string> {
  const path = join(dir, "quellen.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : {};
}

export type RefreshStatus = "new" | "changed" | "same" | "missing";

/** Download the window's years into `dir`. A year not published leaves its file (if any) alone. */
export async function refreshSchedules(
  years: number[],
  { dir = TERMINE_DIR, fetchFn = fetch as Fetch } = {},
): Promise<Array<{ year: number; status: RefreshStatus }>> {
  mkdirSync(dir, { recursive: true });
  const sources = readSources(dir);
  const result: Array<{ year: number; status: RefreshStatus }> = [];
  for (const year of years) {
    const found = await downloadSchedule(year, fetchFn);
    if (!found) {
      result.push({ year, status: "missing" });
      continue;
    }
    const path = fileFor(dir, year);
    const before = existsSync(path) ? readFileSync(path, "utf-8") : null;
    writeFileSync(path, found.csv);
    sources[year] = found.url;
    result.push({ year, status: before === null ? "new" : before === found.csv ? "same" : "changed" });
  }
  writeFileSync(join(dir, "quellen.json"), JSON.stringify(sources, null, 2) + "\n");
  return result;
}

/**
 * The committed schedules for the window. If none of its years is there
 * (January, and the city is late), the newest one there is, so a build
 * never comes out empty.
 */
export function loadSchedules(years: number[], dir = TERMINE_DIR): Schedule[] {
  const sources = readSources(dir);
  const have = existsSync(dir)
    ? readdirSync(dir)
        .map((f) => /^sperrmuell-(\d{4})\.csv$/.exec(f)?.[1])
        .filter((y): y is string => Boolean(y))
        .map(Number)
        .sort((a, b) => a - b)
    : [];
  let chosen = have.filter((y) => years.includes(y));
  if (chosen.length === 0 && have.length > 0) {
    const newest = have[have.length - 1];
    console.warn(`[csv] no schedule for ${years.join("/")} yet, using ${newest}`);
    chosen = [newest];
  }
  return chosen.map((year) => ({
    year,
    url: sources[year] ?? csvUrl(year),
    text: readFileSync(fileFor(dir, year), "utf-8"),
  }));
}
