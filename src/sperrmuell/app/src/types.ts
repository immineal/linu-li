/**
 * Types mirroring the ETL output in `data/` (see `etl/src/types.ts`).
 * Kept as plain types here so the frontend doesn't depend on the etl package.
 */

export type IsoDate = string;

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

/** Predicate describing exactly which house numbers on a street belong to a segment. */
export interface AddressPredicate {
  wholeStreet: boolean;
  ranges: HouseNumberRange[];
  toggles: HouseNumberToken[];
}

export type GeometryConfidence = "exact" | "approximate" | "unmatched";

export interface RouteInfo {
  kreis: string;
  kreisBez: string;
  bezirk: string;
  bezirkBez: string;
  gebiet: string;
  gebietBez: string;
}

export interface SegmentGeometryProperties {
  segmentId: string;
  street: string;
  ortsteil: string;
  plz: string;
  rangeLabel: string;
  predicate: AddressPredicate;
  dates: [IsoDate, IsoDate, IsoDate];
  routeCluster: RouteInfo;
  geometryConfidence: GeometryConfidence;
  confidenceNote?: string;
}

export interface RoutePolygonProperties {
  date: IsoDate;
  segmentCount: number;
  geometrySegmentCount: number;
}

export interface OrtsteilProperties {
  id: string;
  name: string;
  admin_level: string;
}

export interface BuildIndex {
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
  availableDates: IsoDate[];
  counts: {
    segments: number;
    routes: number;
    ortsteile: number;
  };
}
