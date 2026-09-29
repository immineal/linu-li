import osmtogeojson from "osmtogeojson";
import type { Feature, FeatureCollection, LineString, MultiPolygon, Point, Polygon } from "geojson";
import { join } from "node:path";
import { fetchOverpass } from "./overpass.js";
import { OSM_CACHE_DIR } from "./paths.js";

/**
 * Bonn's OSM relation id (boundary=administrative, admin_level=6,
 * de:amtlicher_gemeindeschluessel=05314000). Looked up once via Overpass
 * and cached; hardcoded here as a stable fallback since city boundaries
 * essentially never change relation id.
 */
const BONN_RELATION_ID = 62508;
const BONN_AREA_ID = 3600000000 + BONN_RELATION_ID;

export interface OsmStreetProperties {
  id: string;
  name: string;
  highway: string;
}

export interface OsmAddressProperties {
  id: string;
  "addr:housenumber": string;
  "addr:street": string;
  "addr:postcode"?: string;
  "addr:suburb"?: string;
}

export interface OsmOrtsteilProperties {
  id: string;
  name: string;
  admin_level: string;
}

export type StreetFeature = Feature<LineString, OsmStreetProperties>;
export type AddressFeature = Feature<Point, OsmAddressProperties>;
export type OrtsteilFeature = Feature<Polygon | MultiPolygon, OsmOrtsteilProperties>;

function toFeatureCollection<G, P>(raw: string): FeatureCollection<any, any> {
  const data = JSON.parse(raw);
  return osmtogeojson(data) as FeatureCollection<any, any>;
}

/** Fetch all named highway ways within Bonn's administrative boundary. */
export async function fetchStreets(): Promise<StreetFeature[]> {
  const query = `[out:json][timeout:180];\narea(${BONN_AREA_ID})->.bonn;\nway(area.bonn)["highway"]["name"];\nout geom;\n`;
  const raw = await fetchOverpass(query, {
    cachePath: join(OSM_CACHE_DIR, "streets.json"),
    label: "streets",
  });
  return streetsFromOverpass(raw);
}

/**
 * Named highways as lines. A square mapped as a pedestrian area (a closed way
 * with area=yes, such as Moltkeplatz in Bad Godesberg since summer 2026)
 * comes out of osmtogeojson as a polygon; its outline is where the houses
 * stand, so it counts as the street. Dropping it had taken the square off
 * the map.
 */
export function streetsFromOverpass(raw: string): StreetFeature[] {
  const fc = toFeatureCollection(raw);
  const streets: StreetFeature[] = [];
  for (const f of fc.features) {
    let geometry: LineString;
    if (f.geometry?.type === "LineString") geometry = f.geometry as LineString;
    else if (f.geometry?.type === "Polygon") geometry = { type: "LineString", coordinates: (f.geometry as Polygon).coordinates[0] };
    else continue;
    streets.push({
      type: "Feature",
      geometry,
      properties: {
        id: String(f.id ?? f.properties.id),
        name: f.properties.name,
        highway: f.properties.highway,
      },
    });
  }
  return streets;
}

/**
 * Fetch all address points (nodes and building outlines with
 * addr:housenumber + addr:street) within Bonn. Building ways are reduced
 * to their centroid via Overpass `out center`.
 */
export async function fetchAddresses(): Promise<AddressFeature[]> {
  const query = `[out:json][timeout:180];\narea(${BONN_AREA_ID})->.bonn;\n(\n  node(area.bonn)["addr:housenumber"]["addr:street"];\n  way(area.bonn)["addr:housenumber"]["addr:street"];\n);\nout center tags;\n`;
  const raw = await fetchOverpass(query, {
    cachePath: join(OSM_CACHE_DIR, "addresses.json"),
    label: "addresses",
  });
  const fc = toFeatureCollection(raw);
  return fc.features
    .filter((f) => f.geometry?.type === "Point")
    .map((f) => ({
      type: "Feature",
      geometry: f.geometry as Point,
      properties: {
        id: String(f.id ?? f.properties.id),
        "addr:housenumber": f.properties["addr:housenumber"],
        "addr:street": f.properties["addr:street"],
        "addr:postcode": f.properties["addr:postcode"],
        "addr:suburb": f.properties["addr:suburb"],
      },
    }));
}

/** Fetch Ortsteil (admin_level=10) boundaries within Bonn for the context layer. */
export async function fetchOrtsteile(): Promise<OrtsteilFeature[]> {
  const query = `[out:json][timeout:180];\narea(${BONN_AREA_ID})->.bonn;\nrelation(area.bonn)["boundary"="administrative"]["admin_level"="10"];\nout geom;\n`;
  const raw = await fetchOverpass(query, {
    cachePath: join(OSM_CACHE_DIR, "ortsteile.json"),
    label: "ortsteile",
  });
  const fc = toFeatureCollection(raw);
  return fc.features
    .filter((f) => f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon")
    .map((f) => ({
      type: "Feature",
      geometry: f.geometry as Polygon | MultiPolygon,
      properties: {
        id: String(f.id ?? f.properties.id),
        name: f.properties.name,
        admin_level: f.properties.admin_level,
      },
    }));
}
