import { describe, expect, it } from "vitest";
import { geometryBounds } from "../src/geom.js";

describe("geometryBounds", () => {
  it("computes the bounds of a LineString", () => {
    expect(
      geometryBounds({
        type: "LineString",
        coordinates: [
          [7.0, 50.0],
          [7.2, 50.1],
          [6.9, 50.05],
        ],
      }),
    ).toEqual([6.9, 50.0, 7.2, 50.1]);
  });

  it("computes the bounds of a Polygon (using the outer ring)", () => {
    expect(
      geometryBounds({
        type: "Polygon",
        coordinates: [
          [
            [7.0, 50.0],
            [7.1, 50.0],
            [7.1, 50.1],
            [7.0, 50.1],
            [7.0, 50.0],
          ],
        ],
      }),
    ).toEqual([7.0, 50.0, 7.1, 50.1]);
  });

  it("computes the bounds of a MultiPolygon across all parts", () => {
    expect(
      geometryBounds({
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [7.0, 50.0],
              [7.05, 50.0],
              [7.05, 50.05],
              [7.0, 50.05],
              [7.0, 50.0],
            ],
          ],
          [
            [
              [7.2, 50.2],
              [7.25, 50.2],
              [7.25, 50.25],
              [7.2, 50.25],
              [7.2, 50.2],
            ],
          ],
        ],
      }),
    ).toEqual([7.0, 50.0, 7.25, 50.25]);
  });

  it("computes the bounds of a GeometryCollection", () => {
    expect(
      geometryBounds({
        type: "GeometryCollection",
        geometries: [
          { type: "Point", coordinates: [7.0, 50.0] },
          { type: "Point", coordinates: [7.5, 50.5] },
        ],
      }),
    ).toEqual([7.0, 50.0, 7.5, 50.5]);
  });
});
