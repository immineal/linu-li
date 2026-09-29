import maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { geometryBounds } from "./geom.js";
import type { OrtsteilFeature, RouteFeature, SegmentFeature } from "./dataLoader.js";
import { basemapPaint, inkFor, styleFor, type Theme } from "./theme.js";

export const BONN_CENTER: [number, number] = [7.0982, 50.7374];

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

export const ORTSTEIL_LAYERS = ["ortsteile-fill", "ortsteile-line"];
export const ROUTE_LAYERS = ["route-fill", "route-line"];

/**
 * Thin wrapper around the MapLibre map.
 *
 * Themes have different basemaps (OSM raster for light, OpenFreeMap vector
 * for dark), so a theme switch is a full setStyle() that wipes every source
 * and layer. Everything the app draws on top — Ortsteile, routes, segments,
 * highlight — is remembered on the instance and re-added after the new
 * style loads. From the outside, callers of setSegments/setRoute/etc. and
 * the layer-visibility API do not need to know a style swap happened.
 */
export class SperrmuellMap {
  readonly map: maplibregl.Map;
  private theme: Theme;
  private ortsteile: OrtsteilFeature[] = [];
  private ortsteileReady = false;
  private segments: SegmentFeature[] = [];
  private segmentsColor = "#c44d3c";
  private route: RouteFeature | undefined = undefined;
  private routeColor = "#c44d3c";
  private highlight: SegmentFeature | undefined = undefined;
  private layerVisibility: Record<string, boolean> = {
    "ortsteile-fill": false,
    "ortsteile-line": false,
    "route-fill": false,
    "route-line": false,
  };

  constructor(container: HTMLElement, initialTheme: Theme) {
    this.theme = initialTheme;
    this.map = new maplibregl.Map({
      container,
      style: styleFor(initialTheme),
      center: BONN_CENTER,
      zoom: 12,
      attributionControl: { compact: true },
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  }

  /**
   * Run `cb` once the map has loaded for the first time. The "load" event
   * doesn't always fire promptly once `loaded()` becomes true (e.g. on
   * mobile, when the render loop is throttled), so poll as a fallback
   * alongside the event.
   */
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

  /**
   * Switch basemap and re-apply everything on top of it.
   *
   * If the theme actually changed, we call setStyle() and, once the new
   * style has finished loading, rebuild the app's own sources/layers and
   * restore the current data on them. If the theme is the same as before
   * (e.g. the initial applyTheme() the app runs before data arrives), we
   * just re-apply the paint touch-ups: the style itself is already right.
   */
  setTheme(newTheme: Theme): void {
    const changed = newTheme !== this.theme;
    this.theme = newTheme;
    if (!changed) {
      this.applyThemeTints();
      return;
    }
    this.map.setStyle(styleFor(newTheme), { diff: false });
    // MapLibre fires several `styledata` events during a setStyle, but on
    // switching to the vector dark style the listener stops firing before
    // `isStyleLoaded()` ever turns true — the map goes on loading tiles
    // and glyphs without further style events. Poll instead: try every
    // 100 ms until the style reports loaded, up to 10 s (after which the
    // network is presumed dead and the fallback is a page reload).
    let attempts = 0;
    const rebuild = (): void => {
      attempts += 1;
      if (this.map.isStyleLoaded() !== true) {
        if (attempts < 100) setTimeout(rebuild, 100);
        return;
      }
      if (this.map.getLayer("segments-exact")) return;
      this.buildOverlays();
      if (!this.map.getLayer("segments-exact")) return;
      this.restoreOverlayState();
      this.applyThemeTints();
    };
    rebuild();
  }

  /**
   * First-time overlay setup. Called by main.ts once the initial style has
   * loaded and the data has arrived. Subsequent theme switches replay the
   * same setup automatically.
   */
  setupLayers(ortsteile: OrtsteilFeature[]): void {
    this.ortsteile = ortsteile;
    this.ortsteileReady = true;
    this.buildOverlays();
    this.applyThemeTints();
  }

  private buildOverlays(): void {
    if (!this.ortsteileReady) return;
    const map = this.map;

    if (!map.getSource("ortsteile")) {
      map.addSource("ortsteile", {
        type: "geojson",
        data: { type: "FeatureCollection", features: this.ortsteile },
      });
    }
    if (!map.getLayer("ortsteile-fill")) {
      map.addLayer({
        id: "ortsteile-fill",
        type: "fill",
        source: "ortsteile",
        paint: { "fill-color": inkFor(this.theme), "fill-opacity": 0.04 },
        layout: { visibility: "none" },
      });
    }
    if (!map.getLayer("ortsteile-line")) {
      map.addLayer({
        id: "ortsteile-line",
        type: "line",
        source: "ortsteile",
        paint: { "line-color": inkFor(this.theme), "line-width": 1, "line-opacity": 0.4 },
        layout: { visibility: "none" },
      });
    }

    if (!map.getSource("route")) {
      map.addSource("route", { type: "geojson", data: EMPTY_FC });
    }
    if (!map.getLayer("route-fill")) {
      map.addLayer({
        id: "route-fill",
        type: "fill",
        source: "route",
        paint: { "fill-color": this.routeColor, "fill-opacity": 0.12 },
        layout: { visibility: "none" },
      });
    }
    if (!map.getLayer("route-line")) {
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: { "line-color": this.routeColor, "line-width": 1, "line-opacity": 0.5 },
        layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
      });
    }

    if (!map.getSource("segments")) {
      map.addSource("segments", { type: "geojson", data: EMPTY_FC });
    }
    // Full opacity on both segment layers: with a semi-transparent line,
    // the round caps at the join between two neighbouring segment features
    // stack and read as a brighter dot at every junction. Fully opaque
    // strokes overlap to the same colour and the dots go away without
    // giving up the rounded ends.
    if (!map.getLayer("segments-approximate")) {
      map.addLayer({
        id: "segments-approximate",
        type: "line",
        source: "segments",
        filter: ["==", ["get", "geometryConfidence"], "approximate"],
        paint: {
          "line-color": this.segmentsColor,
          "line-width": 4,
          "line-dasharray": [2, 1.6],
          "line-opacity": 1,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
    }
    if (!map.getLayer("segments-exact")) {
      map.addLayer({
        id: "segments-exact",
        type: "line",
        source: "segments",
        filter: ["==", ["get", "geometryConfidence"], "exact"],
        paint: {
          "line-color": this.segmentsColor,
          "line-width": 4,
          "line-opacity": 1,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
    }

    if (!map.getSource("highlight")) {
      map.addSource("highlight", { type: "geojson", data: EMPTY_FC });
    }
    if (!map.getLayer("highlight-line")) {
      map.addLayer({
        id: "highlight-line",
        type: "line",
        source: "highlight",
        paint: {
          "line-color": "#ffb703",
          "line-width": 7,
          "line-opacity": 0.95,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });
    }
  }

  private restoreOverlayState(): void {
    // The GeoJSON sources came back empty from buildOverlays(); pour the
    // in-memory selection back in so a theme switch does not clear it.
    this.setSegments(this.segments, this.segmentsColor);
    this.setRoute(this.route, this.routeColor);
    this.setHighlight(this.highlight);
    for (const [id, visible] of Object.entries(this.layerVisibility)) {
      if (this.map.getLayer(id)) {
        this.map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      }
    }
  }

  private applyThemeTints(): void {
    // Only the light theme's OSM raster layer takes paint touch-ups. The
    // dark theme's vector style already carries its own paint.
    if (this.map.getLayer("osm")) {
      for (const [name, value] of Object.entries(basemapPaint(this.theme))) {
        this.map.setPaintProperty("osm", name as "raster-saturation", value);
      }
    }
    if (this.map.getLayer("ortsteile-line")) {
      this.map.setPaintProperty("ortsteile-fill", "fill-color", inkFor(this.theme));
      this.map.setPaintProperty("ortsteile-line", "line-color", inkFor(this.theme));
    }
    // Building outline sits between the building fill (rgb 10,10,10) and
    // the smallest visible street (`#181818` = rgb 24,24,24) in OpenFreeMap
    // Dark. The stock outline (rgb 27,27,29) is *above* the street tone and
    // reads as a bright halo around each block under our brightness boost;
    // this puts it back into the middle, so blocks have a soft edge without
    // shouting.
    if (this.map.getLayer("building")) {
      this.map.setPaintProperty("building", "fill-outline-color", "#111111");
    }
    // OpenFreeMap Dark's `highway_path` layer draws footpaths, cycle paths
    // and tracks as fine dashed lines. There are a lot of them, they add
    // no signal for a bulky-waste map, and the dashes read as visual
    // static — hide them in the dark theme.
    if (this.map.getLayer("highway_path")) {
      this.map.setLayoutProperty("highway_path", "visibility", "none");
    }
  }

  /** Replace the segments shown for the currently selected date, in a single shared color. */
  setSegments(features: SegmentFeature[], color: string): void {
    this.segments = features;
    this.segmentsColor = color;
    const source = this.map.getSource("segments") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData({ type: "FeatureCollection", features: features as never });
    this.map.setPaintProperty("segments-exact", "line-color", color);
    this.map.setPaintProperty("segments-approximate", "line-color", color);
  }

  /** Replace the collection-zone polygon for the currently selected date. */
  setRoute(feature: RouteFeature | undefined, color: string): void {
    this.route = feature;
    this.routeColor = color;
    const source = this.map.getSource("route") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData(feature ? { type: "FeatureCollection", features: [feature] } : EMPTY_FC);
    this.map.setPaintProperty("route-fill", "fill-color", color);
    this.map.setPaintProperty("route-line", "line-color", color);
  }

  /** Highlight a single segment's geometry (used for address search results). */
  setHighlight(feature: SegmentFeature | undefined): void {
    this.highlight = feature;
    const source = this.map.getSource("highlight") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData(feature && feature.geometry ? { type: "FeatureCollection", features: [feature as never] } : EMPTY_FC);
  }

  setLayersVisible(layerIds: string[], visible: boolean): void {
    for (const id of layerIds) {
      this.layerVisibility[id] = visible;
      if (this.map.getLayer(id)) {
        this.map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
      }
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
