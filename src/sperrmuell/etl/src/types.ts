/**
 * Shared types for the Sperrmüll ETL pipeline.
 *
 * These describe both the parsed CSV domain model (segments, predicates,
 * dates) and the GeoJSON-ish output artifacts written to `data/`.
 */

export type Parity = "even" | "odd";

/** An inclusive house-number range for one side of the street. */
export interface HouseNumberRange {
  parity: Parity;
  /** Inclusive lower bound. */
  from: number;
  /** Inclusive upper bound, or `null` for "to end of street" (9998/9999 sentinels). */
  to: number | null;
}

/** A single entry from HNR_NEG, e.g. "8B" -> { number: 8, suffix: "B" }. */
export interface HouseNumberToken {
  raw: string;
  number: number;
  suffix: string;
}

/**
 * Predicate describing exactly which house numbers on a street belong to a
 * segment.
 *
 * - `wholeStreet === true` means every house number on the street belongs
 *   (HNR_GE_* and HNR_UG_* were both empty).
 * - Otherwise a house number belongs iff it falls into one of `ranges`
 *   (matching parity, and within [from, to] with `to === null` meaning open
 *   ended).
 * - `toggles` (from HNR_NEG) flip membership for an exact number+suffix
 *   match: numbers normally inside the range become excluded, numbers
 *   normally outside become additionally included.
 */
export interface AddressPredicate {
  wholeStreet: boolean;
  ranges: HouseNumberRange[];
  toggles: HouseNumberToken[];
}

export interface RouteInfo {
  kreis: string;
  kreisBez: string;
  bezirk: string;
  bezirkBez: string;
  gebiet: string;
  gebietBez: string;
}

/** ISO 8601 date string, e.g. "2026-06-15". */
export type IsoDate = string;

export interface SperrmuellSegment {
  /** Stable id, taken from ID_TERMINE in the source CSV. */
  id: string;
  street: string;
  ortsteil: string;
  plz: string;
  /** STR_BEM1 — free-text note on the bounding cross streets, if any. */
  crossStreets: string;
  predicate: AddressPredicate;
  /** Human-readable summary of `predicate`, e.g. "gerade 2–Ende, ungerade 1–Ende". */
  rangeLabel: string;
  /**
   * Collection dates, ascending: three per year's schedule, so three or,
   * once next year's is out, six.
   */
  dates: IsoDate[];
  route: RouteInfo;
}

export type GeometryConfidence = "exact" | "approximate" | "unmatched";

export interface SegmentGeometryProperties {
  segmentId: string;
  street: string;
  ortsteil: string;
  plz: string;
  rangeLabel: string;
  /** Needed by the frontend to match a searched house number to this segment. */
  predicate: AddressPredicate;
  dates: IsoDate[];
  routeCluster: RouteInfo;
  geometryConfidence: GeometryConfidence;
  /** Human-readable reason when confidence is not "exact". */
  confidenceNote?: string;
}

export interface BuildStats {
  generatedAt: string;
  sourceCsv: {
    url: string;
    license: string;
    dataDate: string;
  };
  totals: {
    sperrmuellSegmentsParsed: number;
    matchedExact: number;
    matchedApproximate: number;
    unmatched: number;
  };
  clusterValidation: {
    pass: boolean;
    uniqueDates: number;
    totalDateAssignments: number;
    expectedDateAssignments: number;
    details: string;
  };
  unmatchedSegments: Array<{
    id: string;
    street: string;
    ortsteil: string;
    plz: string;
    rangeLabel: string;
  }>;
}
