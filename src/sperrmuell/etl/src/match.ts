import * as turf from "@turf/turf";
import type { Feature, LineString, MultiLineString } from "geojson";
import type {
  GeometryConfidence,
  IsoDate,
  RouteInfo,
  SegmentGeometryProperties,
  SperrmuellSegment,
} from "./types.js";
import type { AddressFeature, OrtsteilFeature, StreetFeature } from "./fetchOsm.js";
import { normalizeStreetName } from "./streetName.js";
import { resolveOrtsteilPolygon } from "./ortsteilMatch.js";
import { addressMatchesPredicate, tryParseHouseNumberToken } from "./predicate.js";

/** Max distance between an OSM address point and a candidate way for it to "belong" to that way. */
const ADDRESS_MATCH_RADIUS_KM = 0.15;
/** A matched range touching within this distance of the known address extent is extended to the way's end. */
const EDGE_EPSILON_KM = 0.01;
/** Clips shorter than this are widened slightly so they remain visible/clippable. */
const MIN_SLICE_LENGTH_KM = 0.005;
/** Candidate ways spanning more than this (with no Ortsteil filter applied) are treated as ambiguous. */
const AMBIGUOUS_SPAN_KM = 2;

export interface MatchedFeature {
  type: "Feature";
  geometry: LineString | MultiLineString | null;
  properties: SegmentGeometryProperties;
}

export interface MatchStats {
  totalSegments: number;
  matchedExact: number;
  matchedApproximate: number;
  unmatched: number;
}

export interface MatchResult {
  features: MatchedFeature[];
  stats: MatchStats;
  unmatchedSegments: SperrmuellSegment[];
}

interface PointOnWay {
  location: number;
  houseNumber: number;
  suffix: string;
}

interface WayContext {
  way: StreetFeature;
  line: Feature<LineString>;
  length: number;
  points: PointOnWay[];
}

interface StreetContext {
  ways: WayContext[];
  ambiguous: boolean;
  /** Whether `ways` was narrowed to a single Ortsteil (so a wider fallback exists). */
  ortsteilApplied: boolean;
}

/** Build a normalized-name -> features index. */
function buildNameIndex<T extends { properties: { name?: string; "addr:street"?: string } }>(
  features: T[],
  nameOf: (f: T) => string,
): Map<string, T[]> {
  const index = new Map<string, T[]>();
  for (const f of features) {
    const key = normalizeStreetName(nameOf(f));
    if (!key) continue;
    const list = index.get(key);
    if (list) list.push(f);
    else index.set(key, [f]);
  }
  return index;
}

/** Bounding-box diagonal (km) spanned by a set of ways, used to detect candidates that span multiple villages. */
function bboxDiagonalKm(ways: StreetFeature[]): number {
  if (ways.length === 0) return 0;
  const box = turf.bbox(turf.featureCollection(ways.map((w) => turf.feature(w.geometry))));
  return turf.distance([box[0], box[1]], [box[2], box[3]], { units: "kilometers" });
}

function combineLines(lines: LineString[]): LineString | MultiLineString {
  if (lines.length === 1) return lines[0];
  return { type: "MultiLineString", coordinates: lines.map((l) => l.coordinates) };
}

/** Build per-way address indexes: assign each address point to its nearest candidate way (within radius). */
function buildStreetContext(candidateWays: StreetFeature[], candidateAddresses: AddressFeature[]): WayContext[] {
  const contexts: WayContext[] = candidateWays.map((way) => {
    const line = turf.feature(way.geometry);
    return { way, line, length: turf.length(line, { units: "kilometers" }), points: [] };
  });

  for (const addr of candidateAddresses) {
    const token = tryParseHouseNumberToken(addr.properties["addr:housenumber"]);
    if (token === null) continue;

    const pt = turf.point(addr.geometry.coordinates);
    let best: { ctx: WayContext; location: number; dist: number } | null = null;
    for (const ctx of contexts) {
      const snapped = turf.nearestPointOnLine(ctx.line, pt, { units: "kilometers" });
      const dist = snapped.properties.dist as number;
      if (dist > ADDRESS_MATCH_RADIUS_KM) continue;
      if (best === null || dist < best.dist) {
        best = { ctx, location: snapped.properties.location as number, dist };
      }
    }
    if (best) {
      best.ctx.points.push({ location: best.location, houseNumber: token.number, suffix: token.suffix });
    }
  }

  for (const ctx of contexts) ctx.points.sort((a, b) => a.location - b.location);
  return contexts;
}

/**
 * Match Sperrmüll segments to OSM street geometry and clip to house-number
 * ranges where possible.
 *
 * For each segment:
 * - Candidate ways are found by normalized street name, optionally
 *   narrowed to a single Ortsteil polygon for streets that exist in
 *   multiple parts of Bonn. Address points are matched to whichever
 *   candidate way is nearest within `ADDRESS_MATCH_RADIUS_KM`, regardless of
 *   Ortsteil (the polygon doesn't always follow the street centerline).
 * - "Whole street" predicates use the full geometry of all candidate ways.
 * - Ranged predicates are clipped using `addr:housenumber` points snapped
 *   onto the candidate ways; a matched range touching the edge of the known
 *   address data is extended to the way's endpoint (handles open-ended
 *   ranges like "148–Ende"). If the Ortsteil-narrowed ways have no matching
 *   address points (a long street's numbering can cross into a different
 *   admin polygon than the CSV's Ortsteil), clipping retries against all
 *   ways for that street name.
 * - If no candidate way matches the street name at all, the segment is
 *   `unmatched`. If candidate ways exist but no address points are usable
 *   for clipping, the full candidate geometry is used as `approximate`.
 *   Candidate sets spanning multiple villages with no Ortsteil filter are
 *   also marked `approximate`.
 */
export function matchSegments(
  segments: SperrmuellSegment[],
  streets: StreetFeature[],
  addresses: AddressFeature[],
  ortsteile: OrtsteilFeature[],
): MatchResult {
  const streetsByName = buildNameIndex(streets, (s) => s.properties.name);
  const addressesByName = buildNameIndex(addresses, (a) => a.properties["addr:street"]);

  const ortsteilCache = new Map<string, OrtsteilFeature | undefined>();
  const contextCache = new Map<string, StreetContext>();
  const fullContextCache = new Map<string, WayContext[]>();

  function resolveOrtsteil(csvOrtsteil: string): OrtsteilFeature | undefined {
    if (!ortsteilCache.has(csvOrtsteil)) {
      ortsteilCache.set(csvOrtsteil, resolveOrtsteilPolygon(ortsteile, csvOrtsteil));
    }
    return ortsteilCache.get(csvOrtsteil);
  }

  /** All ways/addresses for a street name, regardless of Ortsteil (used as a fallback). */
  function getFullContext(normalizedName: string): WayContext[] {
    let ways = fullContextCache.get(normalizedName);
    if (ways) return ways;
    const candidateWays = streetsByName.get(normalizedName) ?? [];
    const candidateAddresses = addressesByName.get(normalizedName) ?? [];
    ways = buildStreetContext(candidateWays, candidateAddresses);
    fullContextCache.set(normalizedName, ways);
    return ways;
  }

  function getContext(normalizedName: string, ortsteil: OrtsteilFeature | undefined): StreetContext {
    const key = `${normalizedName}|${ortsteil?.properties.id ?? ""}`;
    let ctx = contextCache.get(key);
    if (ctx) return ctx;

    let candidateWays = streetsByName.get(normalizedName) ?? [];
    const candidateAddresses = addressesByName.get(normalizedName) ?? [];
    let ortsteilApplied = false;

    if (ortsteil) {
      const ortsteilFeature = turf.feature(ortsteil.geometry);
      const filteredWays = candidateWays.filter((w) =>
        turf.booleanIntersects(turf.feature(w.geometry), ortsteilFeature),
      );
      if (filteredWays.length > 0) {
        candidateWays = filteredWays;
        ortsteilApplied = true;
      }
    }

    const ambiguous = !ortsteilApplied && bboxDiagonalKm(candidateWays) > AMBIGUOUS_SPAN_KM;

    // Addresses are not pre-filtered by Ortsteil: buildStreetContext already
    // assigns each address to its nearest candidate way within
    // ADDRESS_MATCH_RADIUS_KM, which correctly handles addresses that sit
    // just across an administrative boundary from the way they belong to
    // (Ortsteil polygons don't always follow street centerlines).
    ctx = { ways: buildStreetContext(candidateWays, candidateAddresses), ambiguous, ortsteilApplied };
    contextCache.set(key, ctx);
    return ctx;
  }

  /** Try to clip `segment`'s house-number range against `ways`. Empty if no address points match. */
  function clipWithWays(segment: SperrmuellSegment, ways: WayContext[], openTo: boolean): LineString[] {
    const clippedLines: LineString[] = [];

    for (const wctx of ways) {
      if (wctx.points.length === 0) continue;
      const matchedPts = wctx.points.filter((p) => addressMatchesPredicate(segment.predicate, p.houseNumber, p.suffix));
      if (matchedPts.length === 0) continue;

      const minAllLoc = wctx.points[0].location;
      const maxAllLoc = wctx.points[wctx.points.length - 1].location;
      const minMatchedLoc = Math.min(...matchedPts.map((p) => p.location));
      const maxMatchedLoc = Math.max(...matchedPts.map((p) => p.location));

      const lowExtend = minMatchedLoc - minAllLoc < EDGE_EPSILON_KM;
      const highExtend = openTo || maxAllLoc - maxMatchedLoc < EDGE_EPSILON_KM;

      let sliceStart = lowExtend ? 0 : minMatchedLoc;
      let sliceEnd = highExtend ? wctx.length : maxMatchedLoc;

      if (sliceEnd - sliceStart < MIN_SLICE_LENGTH_KM) {
        if (!lowExtend && !highExtend) {
          sliceStart = 0;
          sliceEnd = wctx.length;
        } else {
          sliceStart = Math.max(0, sliceStart - MIN_SLICE_LENGTH_KM / 2);
          sliceEnd = Math.min(wctx.length, sliceEnd + MIN_SLICE_LENGTH_KM / 2);
        }
      }

      const sliced = turf.lineSliceAlong(wctx.line, sliceStart, sliceEnd, { units: "kilometers" });
      clippedLines.push(sliced.geometry);
    }

    return clippedLines;
  }

  function clipSegment(
    segment: SperrmuellSegment,
    context: StreetContext,
    normalizedName: string,
  ): { geometry: LineString | MultiLineString; confidence: GeometryConfidence; note?: string } {
    const { ways, ambiguous, ortsteilApplied } = context;
    const ambiguousNote =
      "Straßenname kommt mehrfach in Bonn vor und konnte keinem Ortsteil zugeordnet werden; " +
      "Geometrie kann unvollständig oder zu groß sein.";

    if (segment.predicate.wholeStreet) {
      const geometry = combineLines(ways.map((w) => w.way.geometry));
      return ambiguous
        ? { geometry, confidence: "approximate", note: ambiguousNote }
        : { geometry, confidence: "exact" };
    }

    const openTo = segment.predicate.ranges.some((r) => r.to === null);
    let clippedLines = clipWithWays(segment, ways, openTo);

    // If the Ortsteil-narrowed ways don't cover this house-number range (the
    // city's Ortsteil assignment and OSM's admin_level=10 polygon don't
    // always agree on where a long street's numbering crosses the
    // boundary), retry against all ways for this street name. A match here
    // is still based on real addr:housenumber data, so it's still `exact`.
    if (clippedLines.length === 0 && ortsteilApplied) {
      clippedLines = clipWithWays(segment, getFullContext(normalizedName), openTo);
    }

    if (clippedLines.length > 0) {
      const geometry = combineLines(clippedLines);
      return ambiguous
        ? { geometry, confidence: "approximate", note: ambiguousNote }
        : { geometry, confidence: "exact" };
    }

    const geometry = combineLines(ways.map((w) => w.way.geometry));
    return {
      geometry,
      confidence: "approximate",
      note: ambiguous
        ? ambiguousNote
        : "Keine Hausnummern-Daten in OpenStreetMap für diesen Abschnitt; ganze Straße angezeigt.",
    };
  }

  const features: MatchedFeature[] = [];
  const unmatchedSegments: SperrmuellSegment[] = [];
  let matchedExact = 0;
  let matchedApproximate = 0;

  for (const segment of segments) {
    const normalizedName = normalizeStreetName(segment.street);
    const ortsteil = segment.ortsteil ? resolveOrtsteil(segment.ortsteil) : undefined;
    const context = getContext(normalizedName, ortsteil);

    const routeCluster: RouteInfo = segment.route;
    const baseProperties = {
      segmentId: segment.id,
      street: segment.street,
      ortsteil: segment.ortsteil,
      plz: segment.plz,
      rangeLabel: segment.rangeLabel,
      predicate: segment.predicate,
      dates: segment.dates,
      routeCluster,
    };

    if (context.ways.length === 0) {
      unmatchedSegments.push(segment);
      features.push({
        type: "Feature",
        geometry: null,
        properties: {
          ...baseProperties,
          geometryConfidence: "unmatched",
          confidenceNote: "Kein Straßenname in OpenStreetMap (Bonn) gefunden.",
        },
      });
      continue;
    }

    const { geometry, confidence, note } = clipSegment(segment, context, normalizedName);
    if (confidence === "exact") matchedExact++;
    else matchedApproximate++;

    features.push({
      type: "Feature",
      geometry,
      properties: {
        ...baseProperties,
        geometryConfidence: confidence,
        ...(note ? { confidenceNote: note } : {}),
      },
    });
  }

  return {
    features,
    stats: {
      totalSegments: segments.length,
      matchedExact,
      matchedApproximate,
      unmatched: unmatchedSegments.length,
    },
    unmatchedSegments,
  };
}
