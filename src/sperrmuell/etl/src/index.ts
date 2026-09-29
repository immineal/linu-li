import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeCache } from "./cache.js";
import { parseCsv } from "./csv.js";
import { parseGermanDate } from "./dates.js";
import { fetchAddresses, fetchOrtsteile, fetchStreets } from "./fetchOsm.js";
import { buildClusters, validateClusters } from "./clusters.js";
import { matchSegments } from "./match.js";
import { parseSperrmuellSegments } from "./parseSegments.js";
import { DATA_DIR } from "./paths.js";
import { buildRoutePolygons } from "./routePolygons.js";
import { LICENSE, loadSchedules, windowYears, type Schedule } from "./schedules.js";
import type { BuildStats, SperrmuellSegment } from "./types.js";
import { mergeYears } from "./years.js";

/** Minimum fraction of segments that must be matched (exact or approximate), or the build fails. */
const MIN_MATCH_RATE = 0.95;
/** Minimum fraction of segments that must be matched with "exact" confidence, or the build fails. */
const MIN_EXACT_RATE = 0.75;

/** Coordinate precision (decimal places, ~1.1m at Bonn's latitude) for output GeoJSON. */
const COORDINATE_PRECISION = 5;

/** Round coordinates to {@link COORDINATE_PRECISION} to keep output files small; leaves null geometry as-is. */
function truncate<G extends Geometry | null, P>(feature: Feature<G, P>): Feature<G, P> {
  if (feature.geometry === null) return feature;
  return turf.truncate(feature as never, {
    precision: COORDINATE_PRECISION,
    coordinates: 2,
    mutate: false,
  }) as Feature<G, P>;
}

function parseArgs(argv: string[]): { inputPath?: string } {
  const idx = argv.indexOf("--input");
  if (idx !== -1 && argv[idx + 1]) return { inputPath: argv[idx + 1] };
  return {};
}

async function main(): Promise<void> {
  const { inputPath } = parseArgs(process.argv.slice(2));

  const schedules: Schedule[] = inputPath
    ? [{ year: 0, url: inputPath, text: readFileSync(inputPath, "utf-8") }]
    : loadSchedules(windowYears(new Date()));
  if (schedules.length === 0) {
    throw new Error("No schedule in etl/termine/. Run `npm run schedules` first.");
  }

  // Each year is parsed and checked on its own: the "three dates per
  // segment" rule holds within one schedule, not across two.
  const years = schedules.map((schedule) => {
    const { rows } = parseCsv(schedule.text);
    const segments = parseSperrmuellSegments(rows);
    const validation = validateClusters(segments, buildClusters(segments));
    const plan = rows.find((r) => r.PLAN_BEZ === "Sperrmüll" && r.PLAN_AB && r.PLAN_BIS);
    console.log(`[build] ${schedule.year || schedule.url}: ${segments.length} Sperrmüll segments from ${rows.length} rows`);
    return {
      ...schedule,
      segments,
      validation,
      from: plan ? parseGermanDate(plan.PLAN_AB) : undefined,
      to: plan ? parseGermanDate(plan.PLAN_BIS) : undefined,
    };
  });
  const segments: SperrmuellSegment[] = mergeYears(years);
  console.log(`[build] ${segments.length} segments over ${years.map((y) => y.year).join(", ")}`);

  const froms = years.map((y) => y.from).filter(Boolean).sort();
  const tos = years.map((y) => y.to).filter(Boolean).sort();
  const dataDate = froms.length && tos.length ? `${froms[0]} – ${tos[tos.length - 1]}` : "unknown";

  console.log("[build] fetching OpenStreetMap data for Bonn (this can take a while)...");
  const [streets, addresses, ortsteile] = await Promise.all([
    fetchStreets(),
    fetchAddresses(),
    fetchOrtsteile(),
  ]);
  console.log(`[build] OSM data: ${streets.length} streets, ${addresses.length} addresses, ${ortsteile.length} Ortsteile`);

  console.log("[build] matching segments to street geometry...");
  const { features, stats, unmatchedSegments } = matchSegments(segments, streets, addresses, ortsteile);
  console.log(
    `[build] matched ${stats.matchedExact} exact, ${stats.matchedApproximate} approximate, ` +
      `${stats.unmatched} unmatched (of ${stats.totalSegments})`,
  );

  console.log("[build] building route clusters...");
  const clusters = buildClusters(segments);
  const clusterValidation: BuildStats["clusterValidation"] = {
    pass: years.every((y) => y.validation.pass),
    uniqueDates: clusters.length,
    totalDateAssignments: years.reduce((n, y) => n + y.validation.totalDateAssignments, 0),
    expectedDateAssignments: years.reduce((n, y) => n + y.validation.expectedDateAssignments, 0),
    details: years.map((y) => (years.length > 1 ? `${y.year}: ` : "") + y.validation.details).join(" "),
  };
  console.log(`[build] ${clusterValidation.details}`);

  console.log("[build] building route-cluster polygons...");
  const routeFeatures = buildRoutePolygons(clusters, features);

  const segmentsGeoJson: FeatureCollection = {
    type: "FeatureCollection",
    features: features.map(truncate) as never,
  };
  const routesGeoJson: FeatureCollection = {
    type: "FeatureCollection",
    features: routeFeatures.map(truncate) as never,
  };
  const ortsteileGeoJson: FeatureCollection = {
    type: "FeatureCollection",
    features: ortsteile.map(truncate) as never,
  };

  writeCache(join(DATA_DIR, "segments.geojson"), JSON.stringify(segmentsGeoJson));
  writeCache(join(DATA_DIR, "routes.geojson"), JSON.stringify(routesGeoJson));
  writeCache(join(DATA_DIR, "ortsteile.geojson"), JSON.stringify(ortsteileGeoJson));

  const matchRate = (stats.matchedExact + stats.matchedApproximate) / stats.totalSegments;
  const exactRate = stats.matchedExact / stats.totalSegments;

  const buildStats: BuildStats = {
    generatedAt: new Date().toISOString(),
    sourceCsv: {
      url: years[years.length - 1].url,
      license: LICENSE,
      dataDate,
    },
    totals: {
      sperrmuellSegmentsParsed: segments.length,
      matchedExact: stats.matchedExact,
      matchedApproximate: stats.matchedApproximate,
      unmatched: stats.unmatched,
    },
    clusterValidation,
    unmatchedSegments: unmatchedSegments.map((s) => ({
      id: s.id,
      street: s.street,
      ortsteil: s.ortsteil,
      plz: s.plz,
      rangeLabel: s.rangeLabel,
    })),
  };

  const index = {
    ...buildStats,
    availableDates: clusters.map((c) => c.date),
    counts: { segments: features.length, routes: routeFeatures.length, ortsteile: ortsteile.length },
  };

  writeCache(join(DATA_DIR, "index.json"), JSON.stringify(index, null, 2));

  console.log(`[build] wrote segments.geojson, routes.geojson, ortsteile.geojson and index.json to ${DATA_DIR}`);
  console.log(
    `[build] match rate: ${(matchRate * 100).toFixed(1)}% (exact: ${(exactRate * 100).toFixed(1)}%, ` +
      `approximate: ${((stats.matchedApproximate / stats.totalSegments) * 100).toFixed(1)}%, ` +
      `unmatched: ${((stats.unmatched / stats.totalSegments) * 100).toFixed(1)}%)`,
  );

  let ok = true;
  if (matchRate < MIN_MATCH_RATE) {
    console.error(
      `[build] ERROR: match rate ${(matchRate * 100).toFixed(1)}% is below the minimum ${(MIN_MATCH_RATE * 100).toFixed(1)}%`,
    );
    ok = false;
  }
  if (exactRate < MIN_EXACT_RATE) {
    console.error(
      `[build] ERROR: exact-match rate ${(exactRate * 100).toFixed(1)}% is below the minimum ${(MIN_EXACT_RATE * 100).toFixed(1)}%`,
    );
    ok = false;
  }
  if (!clusterValidation.pass) {
    console.error(`[build] ERROR: route cluster validation failed: ${clusterValidation.details}`);
    ok = false;
  }

  if (!ok) {
    process.exitCode = 1;
    return;
  }
  console.log("[build] OK");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
