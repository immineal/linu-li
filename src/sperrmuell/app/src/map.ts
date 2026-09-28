import maplibregl from "maplibre-gl";
import type { StyleSpecification } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { geometryBounds } from "./geom.js";
import type { OrtsteilFeature, RouteFeature, SegmentFeature } from "./dataLoader.js";

export const BONN_CENTER: [number, number] = [7.0982, 50.7374];

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Minimal MapLibre style using OpenStreetMap's standard raster tiles as the
 * basemap. No API key required; see https://operations.osmfoundation.org/policies/tiles/
 * for the usage policy this app is expected to honor (low request volume).
 */
const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

export const ORTSTEIL_LAYERS = ["ortsteile-fill", "ortsteile-line"];
export const ROUTE_LAYERS = ["route-fill", "route-line"];

/** Thin wrapper around the MapLibre map: source/layer setup and data updates. */
export class SperrmuellMap {
  readonly map: maplibregl.Map;

  constructor(container: HTMLElement) {
    this.map = new maplibregl.Map({
      container,
      style: STYLE,
      center: BONN_CENTER,
      zoom: 12,
      attributionControl: { compact: true },
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  }

  /** Run `cb` once the map has loaded. The "load" event doesn't always fire
   *  promptly once `loaded()` becomes true (e.g. on mobile, when the render
   *  loop is throttled), so poll as a fallback alongside the event. */
  onLoad(cb: () => void): void {
    if (this.map.loaded()) {
      cb();
      return;
    }
    let done = false;
    const poll = setInterval(() => {
      if (done || !this.map.loaded()) return;
      done = true;
      clearInterval(poll);
      cb();
    }, 100);
    this.map.on("load", () => {
      if (done) return;
      done = true;
      clearInterval(poll);
      cb();
    });
  }

  /** Add all sources/layers. Call once after the style has loaded. */
  setupLayers(ortsteile: OrtsteilFeature[]): void {
    const map = this.map;

    map.addSource("ortsteile", {
      type: "geojson",
      data: { type: "FeatureCollection", features: ortsteile },
    });
    map.addLayer({
      id: "ortsteile-fill",
      type: "fill",
      source: "ortsteile",
      paint: { "fill-color": "#1d3557", "fill-opacity": 0.04 },
      layout: { visibility: "none" },
    });
    map.addLayer({
      id: "ortsteile-line",
      type: "line",
      source: "ortsteile",
      paint: { "line-color": "#1d3557", "line-width": 1, "line-opacity": 0.4 },
      layout: { visibility: "none" },
    });

    map.addSource("route", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "route-fill",
      type: "fill",
      source: "route",
      paint: { "fill-color": "#e63946", "fill-opacity": 0.12 },
      layout: { visibility: "none" },
    });
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      paint: { "line-color": "#e63946", "line-width": 1, "line-opacity": 0.5 },
      layout: { visibility: "none" },
    });

    map.addSource("segments", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "segments-approximate",
      type: "line",
      source: "segments",
      filter: ["==", ["get", "geometryConfidence"], "approximate"],
      paint: {
        "line-color": "#e63946",
        "line-width": 4,
        "line-dasharray": [2, 1.6],
        "line-opacity": 0.85,
      },
    });
    map.addLayer({
      id: "segments-exact",
      type: "line",
      source: "segments",
      filter: ["==", ["get", "geometryConfidence"], "exact"],
      paint: {
        "line-color": "#e63946",
        "line-width": 4,
        "line-opacity": 0.9,
      },
    });

    map.addSource("highlight", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "highlight-line",
      type: "line",
      source: "highlight",
      paint: {
        "line-color": "#ffb703",
        "line-width": 7,
        "line-opacity": 0.95,
      },
    });
  }

  /** Replace the segments shown for the currently selected date, in a single shared color. */
  setSegments(features: SegmentFeature[], color: string): void {
    const source = this.map.getSource("segments") as maplibregl.GeoJSONSource;
    source.setData({ type: "FeatureCollection", features: features as never });
    this.map.setPaintProperty("segments-exact", "line-color", color);
    this.map.setPaintProperty("segments-approximate", "line-color", color);
  }

  /** Replace the collection-zone polygon for the currently selected date. */
  setRoute(feature: RouteFeature | undefined, color: string): void {
    const source = this.map.getSource("route") as maplibregl.GeoJSONSource;
    source.setData(feature ? { type: "FeatureCollection", features: [feature] } : EMPTY_FC);
    this.map.setPaintProperty("route-fill", "fill-color", color);
    this.map.setPaintProperty("route-line", "line-color", color);
  }

  /** Highlight a single segment's geometry (used for address search results). */
  setHighlight(feature: SegmentFeature | undefined): void {
    const source = this.map.getSource("highlight") as maplibregl.GeoJSONSource;
    source.setData(feature && feature.geometry ? { type: "FeatureCollection", features: [feature as never] } : EMPTY_FC);
  }

  setLayersVisible(layerIds: string[], visible: boolean): void {
    for (const id of layerIds) {
      this.map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    }
  }

  /** Zoom/pan so the given feature's geometry is in view. */
  flyToFeature(feature: SegmentFeature): void {
    if (!feature.geometry) return;
    const [minX, minY, maxX, maxY] = geometryBounds(feature.geometry);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.map.fitBounds(
      [
        [minX, minY],
        [maxX, maxY],
      ],
      { padding: 80, maxZoom: 17, duration: reducedMotion ? 0 : 600 },
    );
  }
}
