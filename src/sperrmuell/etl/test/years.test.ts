import { describe, expect, it } from "vitest";
import { mergeYears } from "../src/years.js";
import type { SperrmuellSegment } from "../src/types.js";

function segment(id: string, street: string, dates: string[], to: number | null = null): SperrmuellSegment {
  return {
    id,
    street,
    ortsteil: "Alt-Godesberg",
    plz: "53173",
    crossStreets: "",
    predicate: { wholeStreet: false, ranges: [{ parity: "even", from: 2, to }], toggles: [] },
    rangeLabel: "",
    dates,
    route: { kreis: "", kreisBez: "", bezirk: "", bezirkBez: "", gebiet: "", gebietBez: "" },
  };
}

describe("mergeYears", () => {
  it("gives a stretch that is in both years all six dates", () => {
    const merged = mergeYears([
      { year: 2027, segments: [segment("9", "Moltkeplatz", ["2027-03-11", "2027-06-25", "2027-11-18"])] },
      { year: 2026, segments: [segment("1", "Moltkeplatz", ["2026-03-11", "2026-06-25", "2026-11-18"])] },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("1");
    expect(merged[0].dates).toEqual([
      "2026-03-11", "2026-06-25", "2026-11-18", "2027-03-11", "2027-06-25", "2027-11-18",
    ]);
  });

  it("keeps a stretch whose house numbers changed as two segments", () => {
    const merged = mergeYears([
      { year: 2026, segments: [segment("1", "Koblenzer Str.", ["2026-01-05", "2026-05-05", "2026-09-05"])] },
      { year: 2027, segments: [segment("2", "Koblenzer Str.", ["2027-01-05", "2027-05-05", "2027-09-05"], 50)] },
    ]);
    expect(merged.map((s) => s.dates.length)).toEqual([3, 3]);
  });

  it("never merges two rows of the same year, even if they look alike", () => {
    const merged = mergeYears([
      {
        year: 2026,
        segments: [
          segment("1", "Am Hof", ["2026-01-05", "2026-05-05", "2026-09-05"]),
          segment("2", "Am Hof", ["2026-02-05", "2026-06-05", "2026-10-05"]),
        ],
      },
      { year: 2027, segments: [segment("3", "Am Hof", ["2027-01-05", "2027-05-05", "2027-09-05"])] },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].dates).toHaveLength(6);
    expect(merged[1].dates).toHaveLength(3);
  });

  it("renames a later year's id that is already taken", () => {
    const merged = mergeYears([
      { year: 2026, segments: [segment("7", "A-Weg", ["2026-01-05", "2026-05-05", "2026-09-05"])] },
      { year: 2027, segments: [segment("7", "B-Weg", ["2027-01-05", "2027-05-05", "2027-09-05"])] },
    ]);
    expect(merged.map((s) => s.id)).toEqual(["7", "7-2027"]);
  });

  it("leaves the input segments alone", () => {
    const input = segment("1", "Moltkeplatz", ["2026-03-11", "2026-06-25", "2026-11-18"]);
    mergeYears([
      { year: 2026, segments: [input] },
      { year: 2027, segments: [segment("2", "Moltkeplatz", ["2027-03-11", "2027-06-25", "2027-11-18"])] },
    ]);
    expect(input.dates).toHaveLength(3);
  });
});
