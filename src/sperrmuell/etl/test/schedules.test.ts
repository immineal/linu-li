import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/csv.js";
import { parseSperrmuellSegments } from "../src/parseSegments.js";
import {
  csvUrl,
  datasetUrl,
  downloadSchedule,
  loadSchedules,
  refreshSchedules,
  setRetryDelay,
  trimSchedule,
  windowYears,
} from "../src/schedules.js";

setRetryDelay(1);

const fixture = readFileSync(new URL("./fixtures/sample-sperrmuell.csv", import.meta.url), "utf-8");
const listing = "<html><title>Datasets | Offene Daten Bonn</title></html>";

/** A fake opendata.bonn.de: `files` maps URL to body; everything else is 404. */
function fakeFetch(files: Record<string, string>, pages: Record<string, string> = {}) {
  const asked: string[] = [];
  const fetchFn = async (url: string) => {
    asked.push(url);
    if (url in pages) return new Response(pages[url], { status: 200 });
    if (url.includes("/dataset/")) return new Response(listing, { status: 200 });
    if (url in files) return new Response(files[url], { status: 200 });
    return new Response("not found", { status: 404 });
  };
  return { fetchFn, asked };
}

describe("windowYears", () => {
  it("is this year and the next", () => {
    expect(windowYears(new Date("2026-12-24T12:00:00Z"))).toEqual([2026, 2027]);
    expect(windowYears(new Date("2027-01-02T12:00:00Z"))).toEqual([2027, 2028]);
  });
});

describe("trimSchedule", () => {
  it("keeps every Sperrmüll segment exactly as the full export gives it", () => {
    const trimmed = trimSchedule(fixture);
    expect(trimmed).not.toBeNull();
    const before = parseSperrmuellSegments(parseCsv(fixture).rows);
    const after = parseSperrmuellSegments(parseCsv(trimmed!).rows);
    expect(after).toEqual(before);
  });

  it("drops the rows of other collections", () => {
    const other = fixture.split(/\r?\n/)[1].replace("Sperrmüll", "Restabfall");
    const trimmed = trimSchedule(fixture.trimEnd() + "\r\n" + other + "\r\n")!;
    expect(trimmed).not.toContain("Restabfall");
  });

  it("refuses what is not the export", () => {
    expect(trimSchedule(listing)).toBeNull();
    expect(trimSchedule(fixture.replace(/Sperrmüll/g, "Restabfall"))).toBeNull();
  });
});

describe("downloadSchedule", () => {
  it("takes the file under its usual name", async () => {
    const { fetchFn } = fakeFetch({ [csvUrl(2027)]: fixture });
    const found = await downloadSchedule(2027, fetchFn);
    expect(found?.url).toBe(csvUrl(2027));
  });

  it("finds the file through the dataset page if it was renamed", async () => {
    const renamed = "https://opendata.bonn.de/sites/default/files/Abfuhrtermine_2027_final.csv";
    const { fetchFn } = fakeFetch(
      { [renamed]: fixture },
      { [datasetUrl(2027)]: `<a href="/sites/default/files/Abfuhrtermine_2027_final.csv">CSV</a>` },
    );
    const found = await downloadSchedule(2027, fetchFn);
    expect(found?.url).toBe(renamed);
  });

  it("says nothing is there when the year is not published", async () => {
    const { fetchFn } = fakeFetch({});
    expect(await downloadSchedule(2027, fetchFn)).toBeNull();
  });

  it("throws on a server error instead of calling it missing", async () => {
    const fetchFn = async () => new Response("", { status: 503 });
    await expect(downloadSchedule(2027, fetchFn)).rejects.toThrow("HTTP 503");
  });

  it("tries again after a 503 before giving up", async () => {
    let calls = 0;
    const fetchFn = async (url: string) => {
      if (url.includes("/dataset/")) return new Response(listing);
      calls++;
      return calls < 3 ? new Response("", { status: 503 }) : new Response(fixture);
    };
    expect(await downloadSchedule(2027, fetchFn)).not.toBeNull();
    expect(calls).toBe(3);
  });
});

describe("refreshSchedules and loadSchedules", () => {
  it("writes new years, reports unchanged ones, and loads the window", async () => {
    const dir = mkdtempSync(join(tmpdir(), "termine-"));
    const { fetchFn } = fakeFetch({ [csvUrl(2026)]: fixture });

    expect(await refreshSchedules([2026, 2027], { dir, fetchFn })).toEqual([
      { year: 2026, status: "new" },
      { year: 2027, status: "missing" },
    ]);
    expect(await refreshSchedules([2026, 2027], { dir, fetchFn })).toEqual([
      { year: 2026, status: "same" },
      { year: 2027, status: "missing" },
    ]);

    const loaded = loadSchedules([2026, 2027], dir);
    expect(loaded.map((s) => [s.year, s.url])).toEqual([[2026, csvUrl(2026)]]);
  });

  it("falls back to the newest year there is when the window has none", () => {
    const dir = mkdtempSync(join(tmpdir(), "termine-"));
    writeFileSync(join(dir, "sperrmuell-2025.csv"), trimSchedule(fixture)!);
    writeFileSync(join(dir, "sperrmuell-2026.csv"), trimSchedule(fixture)!);
    expect(loadSchedules([2027, 2028], dir).map((s) => s.year)).toEqual([2026]);
  });
});
