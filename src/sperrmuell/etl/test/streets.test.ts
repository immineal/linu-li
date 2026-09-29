import { describe, expect, it } from "vitest";
import { streetsFromOverpass } from "../src/fetchOsm.js";

// Overpass `out geom` for one ordinary street and one square mapped as a
// pedestrian area, the way Moltkeplatz in Bad Godesberg is mapped since 2026.
const raw = JSON.stringify({
  elements: [
    {
      type: "way",
      id: 1,
      tags: { highway: "residential", name: "Teststraße" },
      geometry: [
        { lat: 50.0, lon: 7.0 },
        { lat: 50.001, lon: 7.0 },
      ],
    },
    {
      type: "way",
      id: 2,
      tags: { highway: "pedestrian", area: "yes", name: "Testplatz" },
      geometry: [
        { lat: 50.0, lon: 7.01 },
        { lat: 50.0, lon: 7.011 },
        { lat: 50.001, lon: 7.011 },
        { lat: 50.001, lon: 7.01 },
        { lat: 50.0, lon: 7.01 },
      ],
    },
  ],
});

describe("streetsFromOverpass", () => {
  it("keeps ordinary streets as lines", () => {
    const streets = streetsFromOverpass(raw);
    const street = streets.find((s) => s.properties.name === "Teststraße");
    expect(street?.geometry.type).toBe("LineString");
    expect(street?.geometry.coordinates).toHaveLength(2);
  });

  it("keeps a square mapped as an area, as its outline", () => {
    const streets = streetsFromOverpass(raw);
    const square = streets.find((s) => s.properties.name === "Testplatz");
    expect(square).toBeDefined();
    expect(square?.geometry.type).toBe("LineString");
    expect(square?.geometry.coordinates).toHaveLength(5);
    expect(square?.properties.highway).toBe("pedestrian");
  });
});
