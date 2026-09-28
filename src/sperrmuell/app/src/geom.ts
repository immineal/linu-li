import type { Geometry, Position } from "geojson";

export type BBox = [number, number, number, number];

function extend(bbox: BBox, pos: Position): void {
  if (pos[0] < bbox[0]) bbox[0] = pos[0];
  if (pos[1] < bbox[1]) bbox[1] = pos[1];
  if (pos[0] > bbox[2]) bbox[2] = pos[0];
  if (pos[1] > bbox[3]) bbox[3] = pos[1];
}

/** Bounding box `[minX, minY, maxX, maxY]` of any GeoJSON geometry. */
export function geometryBounds(geometry: Geometry): BBox {
  const bbox: BBox = [Infinity, Infinity, -Infinity, -Infinity];

  function walk(coords: unknown): void {
    if (Array.isArray(coords) && typeof coords[0] === "number") {
      extend(bbox, coords as Position);
      return;
    }
    if (Array.isArray(coords)) {
      for (const c of coords) walk(c);
    }
  }

  if (geometry.type === "GeometryCollection") {
    for (const g of geometry.geometries) {
      const sub = geometryBounds(g);
      extend(bbox, [sub[0], sub[1]]);
      extend(bbox, [sub[2], sub[3]]);
    }
  } else {
    walk(geometry.coordinates);
  }

  return bbox;
}
