import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findMatchingSegments, parseAddressInput } from "../src/address.js";
import { parseCsv } from "../src/csv.js";
import { parseSperrmuellSegments } from "../src/parseSegments.js";
import { normalizeStreetName } from "../src/streetName.js";

const fixturePath = new URL("./fixtures/sample-sperrmuell.csv", import.meta.url);
const { rows } = parseCsv(readFileSync(fixturePath, "utf-8"));
const segments = parseSperrmuellSegments(rows);

describe("normalizeStreetName", () => {
  it("treats 'Str.' and 'Straße' as equivalent", () => {
    expect(normalizeStreetName("Trierer Str.")).toBe(normalizeStreetName("Trierer Straße"));
    expect(normalizeStreetName("Trierer Str.")).toBe("triererstrasse");
  });

  it("normalizes umlauts, ß and punctuation", () => {
    expect(normalizeStreetName("Schloßplatz")).toBe("schlossplatz");
    expect(normalizeStreetName("Wilhelm-Kerp-Str.")).toBe("wilhelmkerpstrasse");
  });

  it("normalizes abbreviated street names with no separating space", () => {
    expect(normalizeStreetName("Gerastr.")).toBe(normalizeStreetName("Gerastraße"));
  });
});

describe("parseAddressInput", () => {
  it("splits a trailing house number (with optional letter suffix)", () => {
    expect(parseAddressInput("Trierer Str. 130")).toEqual({
      street: "Trierer Str.",
      houseNumber: 130,
      suffix: "",
    });
    expect(parseAddressInput("Ippendorfer Allee 1a")).toEqual({
      street: "Ippendorfer Allee",
      houseNumber: 1,
      suffix: "A",
    });
  });

  it("returns null for input without a house number", () => {
    expect(parseAddressInput("Trierer Str.")).toBeNull();
    expect(parseAddressInput("")).toBeNull();
  });
});

describe("findMatchingSegments", () => {
  it("finds the Trierer Str. segment containing a given even house number", () => {
    const matches = findMatchingSegments(segments, {
      street: "Trierer Straße", // spelled out, should still match "Trierer Str."
      houseNumber: 130,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].rangeLabel).toBe("gerade 128–136; ungerade 77–115");
    expect(matches[0].dates).toEqual(["2026-02-26", "2026-06-15", "2026-11-03"]);
  });

  it("routes house number 150 to the open-ended Trierer Str. segment", () => {
    const matches = findMatchingSegments(segments, {
      street: "Trierer Str.",
      houseNumber: 150,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].rangeLabel).toBe("gerade 148–Ende; ungerade 125–Ende");
  });

  it("respects HNR_NEG exclusions on Ippendorfer Allee", () => {
    // House number 1 and 1A are excluded from the ranged segment, but the
    // whole-street segment for the same name still covers them.
    const matchesOne = findMatchingSegments(segments, {
      street: "Ippendorfer Allee",
      houseNumber: 1,
    });
    expect(matchesOne.map((s) => s.rangeLabel)).toEqual(["ganze Straße"]);

    const matchesOneA = findMatchingSegments(segments, {
      street: "Ippendorfer Allee",
      houseNumber: 1,
      suffix: "A",
    });
    expect(matchesOneA.map((s) => s.rangeLabel)).toEqual(["ganze Straße"]);

    // House number 3 was never excluded, so both the ranged and
    // whole-street segments legitimately cover it.
    const matchesThree = findMatchingSegments(segments, {
      street: "Ippendorfer Allee",
      houseNumber: 3,
    });
    expect(matchesThree).toHaveLength(2);
  });

  it("returns [] for a street that isn't in the dataset", () => {
    const matches = findMatchingSegments(segments, {
      street: "Nichtvorhandenweg",
      houseNumber: 1,
    });
    expect(matches).toEqual([]);
  });
});
