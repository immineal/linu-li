import { describe, expect, it } from "vitest";
import type { LineString, MultiLineString } from "geojson";
import { matchSegments } from "../src/match.js";
import type { AddressFeature, OrtsteilFeature, StreetFeature } from "../src/fetchOsm.js";
import type { SperrmuellSegment } from "../src/types.js";

// A straight north-pointing line, 6 vertices ~0.2224 km apart (~1.112 km total).
const LINE: [number, number][] = [
  [7, 50.0],
  [7, 50.002],
  [7, 50.004],
  [7, 50.006],
  [7, 50.008],
  [7, 50.01],
];

const streets: StreetFeature[] = [
  {
    type: "Feature",
    geometry: { type: "LineString", coordinates: LINE },
    properties: { id: "w1", name: "Teststraße", highway: "residential" },
  },
];

// One even-numbered address point per vertex: 2, 4, 6, 8, 10, 12.
const addresses: AddressFeature[] = LINE.map((coord, i) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: coord },
  properties: {
    id: `a${i}`,
    "addr:housenumber": String((i + 1) * 2),
    "addr:street": "Teststraße",
  },
}));

const ortsteile: OrtsteilFeature[] = [];

const baseRoute = {
  kreis: "X",
  kreisBez: "Testbezirk",
  bezirk: "X",
  bezirkBez: "Testbezirk",
  gebiet: "X",
  gebietBez: "Testgebiet",
};

function makeSegment(overrides: Partial<SperrmuellSegment>): SperrmuellSegment {
  return {
    id: "seg",
    street: "Teststraße",
    ortsteil: "",
    plz: "53111",
    crossStreets: "",
    predicate: { wholeStreet: true, ranges: [], toggles: [] },
    rangeLabel: "ganze Straße",
    dates: ["2026-06-15", "2026-09-15", "2026-12-15"],
    route: baseRoute,
    ...overrides,
  };
}

describe("matchSegments", () => {
  it("uses the full way geometry for a 'whole street' predicate", () => {
    const segment = makeSegment({ id: "whole" });
    const result = matchSegments([segment], streets, addresses, ortsteile);

    expect(result.stats).toEqual({ totalSegments: 1, matchedExact: 1, matchedApproximate: 0, unmatched: 0 });
    const [feature] = result.features;
    expect(feature.properties.geometryConfidence).toBe("exact");
    expect((feature.geometry as LineString).coordinates).toEqual(LINE);
  });

  it("clips a closed range to the matched address points", () => {
    const segment = makeSegment({
      id: "range-4-8",
      predicate: { wholeStreet: false, ranges: [{ parity: "even", from: 4, to: 8 }], toggles: [] },
      rangeLabel: "gerade 4–8",
    });
    const result = matchSegments([segment], streets, addresses, ortsteile);

    const [feature] = result.features;
    expect(feature.properties.geometryConfidence).toBe("exact");
    const coords = (feature.geometry as LineString).coordinates;
    // Clipped between house no. 4 (vertex index 1) and house no. 8 (vertex index 3).
    expect(coords[0][1]).toBeCloseTo(50.002, 5);
    expect(coords[coords.length - 1][1]).toBeCloseTo(50.006, 5);
  });

  it("extends an open-ended range to the end of the way", () => {
    const segment = makeSegment({
      id: "range-10-end",
      predicate: { wholeStreet: false, ranges: [{ parity: "even", from: 10, to: null }], toggles: [] },
      rangeLabel: "gerade 10–Ende",
    });
    const result = matchSegments([segment], streets, addresses, ortsteile);

    const [feature] = result.features;
    expect(feature.properties.geometryConfidence).toBe("exact");
    const coords = (feature.geometry as LineString).coordinates;
    // House no. 10 is at vertex index 4; the range is open-ended, so it
    // extends to the end of the way (vertex index 5).
    expect(coords[0][1]).toBeCloseTo(50.008, 5);
    expect(coords[coords.length - 1][1]).toBeCloseTo(50.01, 5);
  });

  it("falls back to the full way as 'approximate' when no address point matches the range", () => {
    const segment = makeSegment({
      id: "range-odd",
      predicate: { wholeStreet: false, ranges: [{ parity: "odd", from: 1, to: null }], toggles: [] },
      rangeLabel: "ungerade 1–Ende",
    });
    const result = matchSegments([segment], streets, addresses, ortsteile);

    const [feature] = result.features;
    expect(feature.properties.geometryConfidence).toBe("approximate");
    expect(feature.properties.confidenceNote).toMatch(/Keine Hausnummern-Daten/);
    expect((feature.geometry as LineString).coordinates).toEqual(LINE);
  });

  it("marks a segment with no matching OSM street name as 'unmatched'", () => {
    const segment = makeSegment({ id: "ghost", street: "Phantomstraße" });
    const result = matchSegments([segment], streets, addresses, ortsteile);

    expect(result.stats).toEqual({ totalSegments: 1, matchedExact: 0, matchedApproximate: 0, unmatched: 1 });
    const [feature] = result.features;
    expect(feature.properties.geometryConfidence).toBe("unmatched");
    expect(feature.geometry).toBeNull();
    expect(result.unmatchedSegments).toHaveLength(1);
  });

  it("combines multiple candidate ways into a MultiLineString", () => {
    const secondWay: StreetFeature = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [[7.01, 50.0], [7.01, 50.002]] },
      properties: { id: "w2", name: "Teststraße", highway: "residential" },
    };
    const segment = makeSegment({ id: "whole-multi" });
    const result = matchSegments([segment], [...streets, secondWay], addresses, ortsteile);

    const [feature] = result.features;
    expect(feature.properties.geometryConfidence).toBe("exact");
    expect(feature.geometry?.type).toBe("MultiLineString");
    expect((feature.geometry as MultiLineString).coordinates).toHaveLength(2);
  });
});
