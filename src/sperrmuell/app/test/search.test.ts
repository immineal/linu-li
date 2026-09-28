import { describe, expect, it } from "vitest";
import { findSegments, parseAddressQuery } from "../src/search.js";
import type { AppData, SegmentFeature } from "../src/dataLoader.js";
import type { AddressPredicate } from "../src/types.js";

describe("parseAddressQuery", () => {
  it("splits street name from house number", () => {
    expect(parseAddressQuery("Trierer Str. 130")).toEqual({ street: "Trierer Str.", number: 130, suffix: "" });
  });

  it("splits off a letter suffix", () => {
    expect(parseAddressQuery("Trierer Str. 130a")).toEqual({ street: "Trierer Str.", number: 130, suffix: "A" });
    expect(parseAddressQuery("Trierer Str. 130 A")).toEqual({ street: "Trierer Str.", number: 130, suffix: "A" });
  });

  it("returns null when there is no house number", () => {
    expect(parseAddressQuery("Trierer Str.")).toBeNull();
    expect(parseAddressQuery("")).toBeNull();
  });
});

function segment(street: string, predicate: AddressPredicate, ortsteil = ""): SegmentFeature {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [[7, 50], [7.01, 50]] },
    properties: {
      segmentId: `${street}-${ortsteil}`,
      street,
      ortsteil,
      plz: "53111",
      rangeLabel: "",
      predicate,
      dates: ["2026-06-15", "2026-09-14", "2026-12-14"],
      routeCluster: { kreis: "", kreisBez: "", bezirk: "", bezirkBez: "", gebiet: "", gebietBez: "" },
      geometryConfidence: "exact",
    },
  };
}

describe("findSegments", () => {
  it("matches by normalized street name and house-number predicate", () => {
    const wholeStreet: AddressPredicate = { wholeStreet: true, ranges: [], toggles: [] };
    const evenOnly: AddressPredicate = { wholeStreet: false, ranges: [{ parity: "even", from: 2, to: null }], toggles: [] };

    const data = {
      segments: [segment("Trierer Straße", wholeStreet), segment("Adenauerallee", evenOnly)],
    } as unknown as AppData;

    expect(findSegments(data, { street: "Trierer Str.", number: 130, suffix: "" })).toHaveLength(1);
    expect(findSegments(data, { street: "Adenauerallee", number: 4, suffix: "" })).toHaveLength(1);
    expect(findSegments(data, { street: "Adenauerallee", number: 5, suffix: "" })).toHaveLength(0);
    expect(findSegments(data, { street: "Nichtstraße", number: 1, suffix: "" })).toHaveLength(0);
  });
});
