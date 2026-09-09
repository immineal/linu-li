import type { Feature, FeatureCollection, LineString, MultiLineString, MultiPolygon, Polygon } from "geojson";
import type { BuildIndex, IsoDate, OrtsteilProperties, RoutePolygonProperties, SegmentGeometryProperties } from "./types.js";

export type SegmentFeature = Feature<LineString | MultiLineString | null, SegmentGeometryProperties>;
export type RouteFeature = Feature<Polygon | MultiPolygon, RoutePolygonProperties>;
export type OrtsteilFeature = Feature<Polygon | MultiPolygon, OrtsteilProperties>;

export interface AppData {
  index: BuildIndex;
  segments: SegmentFeature[];
  routes: RouteFeature[];
  ortsteile: OrtsteilFeature[];
  /** Segments scheduled for a given date (only those with usable geometry). */
  segmentsByDate: Map<IsoDate, SegmentFeature[]>;
  /** The collection-zone polygon for a given date. */
  routesByDate: Map<IsoDate, RouteFeature>;
}

async function fetchJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path);
  } catch (err) {
    throw new Error(`Could not load ${path}: ${(err as Error).message}`);
  }
  if (!res.ok) throw new Error(`Could not load ${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** Load the ETL output (`data/*.geojson` + `data/index.json`) and index segments/routes by date. */
export async function loadAppData(): Promise<AppData> {
  const dataUrl = `${import.meta.env.BASE_URL}data`;
  const [index, segmentsFc, routesFc, ortsteileFc] = await Promise.all([
    fetchJson<BuildIndex>(`${dataUrl}/index.json`),
    fetchJson<FeatureCollection>(`${dataUrl}/segments.geojson`),
    fetchJson<FeatureCollection>(`${dataUrl}/routes.geojson`),
    fetchJson<FeatureCollection>(`${dataUrl}/ortsteile.geojson`),
  ]);

  const segments = segmentsFc.features as SegmentFeature[];
  const routes = routesFc.features as RouteFeature[];
  const ortsteile = ortsteileFc.features as OrtsteilFeature[];

  const segmentsByDate = new Map<IsoDate, SegmentFeature[]>();
  for (const feature of segments) {
    if (feature.geometry === null) continue;
    for (const date of feature.properties.dates) {
      let list = segmentsByDate.get(date);
      if (!list) {
        list = [];
        segmentsByDate.set(date, list);
      }
      list.push(feature);
    }
  }

  const routesByDate = new Map<IsoDate, RouteFeature>();
  for (const route of routes) routesByDate.set(route.properties.date, route);

  return { index, segments, routes, ortsteile, segmentsByDate, routesByDate };
}
