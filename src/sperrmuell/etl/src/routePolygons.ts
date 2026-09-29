import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { RouteCluster } from "./clusters.js";
import type { MatchedFeature } from "./match.js";
import type { IsoDate } from "./types.js";

/** How far to buffer each segment's line geometry when building a date's collection-zone polygon. */
const BUFFER_KM = 0.12;
/** Number of steps per buffer arc; lower than turf's default (8) to keep output size manageable. */
const BUFFER_STEPS = 6;
/** Degrees of tolerance for simplifying the final unioned polygon (~20m at Bonn's latitude). */
const SIMPLIFY_TOLERANCE = 0.0002;

export interface RoutePolygonProperties {
  date: IsoDate;
  /** Total segments scheduled for this date. */
  segmentCount: number;
  /** Of those, how many contributed geometry to this polygon (excludes "unmatched"). */
  geometrySegmentCount: number;
}

export type RoutePolygonFeature = Feature<Polygon | MultiPolygon, RoutePolygonProperties>;

/**
 * Build one "collection zone" polygon per date, by buffering every matched
 * segment's line geometry and merging the buffers into a single (multi)polygon.
 * Segments with `geometryConfidence === "unmatched"` (no geometry) don't
 * contribute, but are still counted in `segmentCount`.
 */
export function buildRoutePolygons(clusters: RouteCluster[], features: MatchedFeature[]): RoutePolygonFeature[] {
  const byId = new Map(features.map((f) => [f.properties.segmentId, f]));

  return clusters.map((cluster) => {
    const buffers: Feature<Polygon | MultiPolygon>[] = [];
    for (const id of cluster.segmentIds) {
      const feature = byId.get(id);
      if (!feature || feature.geometry === null) continue;
      const buffered = turf.buffer(turf.feature(feature.geometry), BUFFER_KM, {
        units: "kilometers",
        steps: BUFFER_STEPS,
      });
      if (buffered) buffers.push(buffered);
    }

    let geometry: Polygon | MultiPolygon;
    if (buffers.length === 0) {
      geometry = { type: "MultiPolygon", coordinates: [] };
    } else if (buffers.length === 1) {
      geometry = buffers[0].geometry;
    } else {
      const unioned = turf.union(turf.featureCollection(buffers));
      geometry = unioned ? (unioned.geometry as Polygon | MultiPolygon) : buffers[0].geometry;
    }

    if (geometry.coordinates.length > 0) {
      geometry = turf.simplify(turf.feature(geometry), {
        tolerance: SIMPLIFY_TOLERANCE,
        highQuality: false,
      }).geometry;
    }

    return {
      type: "Feature",
      geometry,
      properties: {
        date: cluster.date,
        segmentCount: cluster.segmentIds.length,
        geometrySegmentCount: buffers.length,
      },
    };
  });
}
