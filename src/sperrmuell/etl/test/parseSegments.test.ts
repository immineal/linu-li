import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/csv.js";
import { parseSegmentRow, parseSperrmuellSegments } from "../src/parseSegments.js";

const fixturePath = new URL("./fixtures/sample-sperrmuell.csv", import.meta.url);
const { rows } = parseCsv(readFileSync(fixturePath, "utf-8"));

describe("parseSperrmuellSegments", () => {
  it("keeps only PLAN_BEZ=Sperrmüll rows", () => {
    const segments = parseSperrmuellSegments(rows);
    // fixture has 20 Sperrmüll rows + 2 other waste-type rows
    expect(rows.length).toBe(22);
    expect(segments.length).toBe(20);
    expect(segments.every((s) => s.street.length > 0)).toBe(true);
  });

  it("parses the shared 3-date pattern for the Röttgen/Ippendorf/Lengsdorf cluster", () => {
    const segments = parseSperrmuellSegments(rows);
    for (const s of segments) {
      expect(s.dates).toEqual(["2026-02-26", "2026-06-15", "2026-11-03"]);
    }
  });

  it("parses the split Trierer Str. segments with their distinct house-number ranges", () => {
    const segments = parseSperrmuellSegments(rows);
    const trier = segments
      .filter((s) => s.street === "Trierer Str.")
      .sort((a, b) => (a.predicate.ranges[0].from - b.predicate.ranges[0].from));

    expect(trier).toHaveLength(3);
    expect(trier[0].rangeLabel).toBe("gerade 128–136; ungerade 77–115");
    expect(trier[1].rangeLabel).toBe("gerade 138–146; ungerade 117–123");
    expect(trier[2].rangeLabel).toBe("gerade 148–Ende; ungerade 125–Ende");

    for (const s of trier) {
      expect(s.ortsteil).toBe("Ippendorf (BN)");
      expect(s.plz).toBe("53115");
      expect(s.route.kreisBez).toBe("Ippendorf1");
    }
  });

  it("parses HNR_NEG exclusions and the whole-street fallback for Ippendorfer Allee", () => {
    const segments = parseSperrmuellSegments(rows);
    const allee = segments.filter((s) => s.street === "Ippendorfer Allee");
    expect(allee).toHaveLength(2);

    const withExclusion = allee.find((s) => !s.predicate.wholeStreet);
    const wholeStreet = allee.find((s) => s.predicate.wholeStreet);

    expect(withExclusion?.rangeLabel).toBe(
      "gerade 2–Ende; ungerade 1–Ende; außer 1, 1A, 1B, 1C, 1D",
    );
    expect(wholeStreet?.rangeLabel).toBe("ganze Straße");
  });

  it("parses the split Hobsweg segments", () => {
    const segments = parseSperrmuellSegments(rows);
    const hobsweg = segments
      .filter((s) => s.street === "Hobsweg")
      .sort((a, b) => a.predicate.ranges[0].from - b.predicate.ranges[0].from);

    expect(hobsweg).toHaveLength(2);
    expect(hobsweg[0].rangeLabel).toBe("gerade 2–84; ungerade 1–75");
    expect(hobsweg[1].rangeLabel).toBe("gerade 86–Ende; ungerade 77–Ende");
  });

  it("captures route hierarchy fields", () => {
    const segments = parseSperrmuellSegments(rows);
    const stationsweg = segments.find((s) => s.street === "Stationsweg");
    expect(stationsweg?.route).toEqual({
      kreis: "BHA",
      kreisBez: "Endenich",
      bezirk: "BH",
      bezirkBez: "Hardtberg",
      gebiet: "B",
      gebietBez: "Bonn",
    });
  });
});

describe("parseSegmentRow", () => {
  it("returns null for non-Sperrmüll rows", () => {
    const restmuell = rows.find((r) => r.PLAN_BEZ !== "Sperrmüll");
    expect(restmuell).toBeDefined();
    expect(parseSegmentRow(restmuell!)).toBeNull();
  });
});
