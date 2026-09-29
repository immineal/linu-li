import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { join } from "node:path";
import { writeCache } from "./cache.js";
import { parseCsv } from "./csv.js";
import { parseGermanDate } from "./dates.js";
import { CSV_URL, loadCsv } from "./fetchCsv.js";
import { fetchAddresses, fetchOrtsteile, fetchStreets } from "./fetchOsm.js";
import { buildClusters, validateClusters } from "./clusters.js";
import { matchSegments } from "./match.js";
import { parseSperrmuellSegments } from "./parseSegments.js";
import { DATA_DIR } from "./paths.js";
import { buildRoutePolygons } from "./routePolygons.js";
import type { BuildStats } from "./types.js";

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

  console.log("[build] loading CSV...");
  const csvText = await loadCsv(inputPath);
  const { rows } = parseCsv(csvText);
  const segments = parseSperrmuellSegments(rows);
  console.log(`[build] parsed ${segments.length} Sperrmüll segments from ${rows.length} CSV rows`);

  const planRow = rows.find((r) => r.PLAN_BEZ === "Sperrmüll" && r.PLAN_AB && r.PLAN_BIS);
  const dataDate = planRow
    ? `${parseGermanDate(planRow.PLAN_AB)} – ${parseGermanDate(planRow.PLAN_BIS)}`
    : "unknown";

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
  const clusterValidation = validateClusters(segments, clusters);
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
      url: CSV_URL,
      license: "Creative Commons Attribution 4.0 (CC BY 4.0) — bonnorange AöR / opendata.bonn.de",
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
