import type { BuildStats, IsoDate, SperrmuellSegment } from "./types.js";

/**
 * A "route cluster" is the set of segments that are collected on the same
 * date. Within one year's schedule every segment contributes to exactly
 * three clusters (one per TERMIN date); the build checks that per year,
 * before the years are merged.
 */
export interface RouteCluster {
  date: IsoDate;
  segmentIds: string[];
}

/** Group segments by collection date. */
export function buildClusters(segments: SperrmuellSegment[]): RouteCluster[] {
  const byDate = new Map<IsoDate, string[]>();
  for (const segment of segments) {
    for (const date of segment.dates) {
      let list = byDate.get(date);
      if (!list) {
        list = [];
        byDate.set(date, list);
      }
      list.push(segment.id);
    }
  }
  return Array.from(byDate.entries())
    .map(([date, segmentIds]) => ({ date, segmentIds }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Validate the "segments sharing a date form one route cluster" invariant:
 *
 * - Every segment has exactly 3 distinct dates (enforced during parsing,
 *   re-checked here defensively).
 * - The total number of (segment, date) assignments across all clusters
 *   equals 3 * segmentCount, i.e. no assignment was lost or duplicated
 *   while building clusters.
 * - Every cluster is non-empty.
 */
export function validateClusters(
  segments: SperrmuellSegment[],
  clusters: RouteCluster[],
): BuildStats["clusterValidation"] {
  const expectedDateAssignments = segments.length * 3;
  const totalDateAssignments = clusters.reduce((sum, c) => sum + c.segmentIds.length, 0);

  const problems: string[] = [];

  if (totalDateAssignments !== expectedDateAssignments) {
    problems.push(
      `total date assignments ${totalDateAssignments} != expected ${expectedDateAssignments}`,
    );
  }

  const emptyClusters = clusters.filter((c) => c.segmentIds.length === 0);
  if (emptyClusters.length > 0) {
    problems.push(`${emptyClusters.length} empty cluster(s)`);
  }

  for (const segment of segments) {
    const distinct = new Set(segment.dates);
    if (distinct.size !== 3) {
      problems.push(`segment ${segment.id} does not have 3 distinct dates`);
      break;
    }
  }

  const pass = problems.length === 0;
  const details = pass
    ? `${clusters.length} route clusters from ${segments.length} segments x 3 dates each (${totalDateAssignments} assignments).`
    : `FAILED: ${problems.join("; ")}`;

  return {
    pass,
    uniqueDates: clusters.length,
    totalDateAssignments,
    expectedDateAssignments,
    details,
  };
}
