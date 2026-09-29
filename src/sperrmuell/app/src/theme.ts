import type { StyleSpecification } from "maplibre-gl";

/**
 * Light or dark, the way the rest of linu.li decides it: dark, unless light
 * was picked with the switch in the site's header, which stores "light"
 * under "theme" in localStorage. The map shares that origin, so the choice
 * made on one page holds on the other.
 */
export type Theme = "light" | "dark";

export const THEME_COLOR: Record<Theme, string> = { light: "#faf6f2", dark: "#1a1918" };

export function readTheme(storage: Pick<Storage, "getItem"> | null): Theme {
  try {
    return storage?.getItem("theme") === "light" ? "light" : "dark";
  } catch {
    // Storage blocked (private window, site data off): the site's default
    return "dark";
  }
}

export function storeTheme(storage: Pick<Storage, "setItem"> | null, theme: Theme): void {
  try {
    storage?.setItem("theme", theme);
  } catch {
    // Blocked: the switch still works for this visit
  }
}

/**
 * The MapLibre style for each theme.
 *
 * Light stays on OpenStreetMap's standard raster tiles (no key, low volume
 * under OSMF's tile-usage policy). A slight desaturation, applied through
 * basemapPaint(), keeps the collection-day polygons on top from having to
 * shout over the paper.
 *
 * Dark uses OpenFreeMap's public "dark" vector-tile style, which was
 * designed for dark UI — labels are legible, motorways don't dominate,
 * water and parks recede. This was the shortest route to a dark map that
 * looks like a dark map rather than a light one dimmed grey. Free, no key,
 * community-funded (openfreemap.org). Filters over the light tiles cannot
 * touch how the light theme was designed; the choice of tone happens in
 * whoever draws the tiles, and here that is a different cartographer.
 *
 * If OpenFreeMap ever goes down, dark falls back to the light style so the
 * page still shows the map. This is handled inside SperrmuellMap.
 */
const OSM_LIGHT_STYLE: StyleSpecification = {
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

const OPENFREEMAP_DARK_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

export function styleFor(theme: Theme): StyleSpecification | string {
  return theme === "dark" ? OPENFREEMAP_DARK_STYLE_URL : OSM_LIGHT_STYLE;
}

/**
 * Paint touch-ups on the OSM raster: only applies to the light theme, where
 * the raster layer called "osm" is present. The dark theme's vector style
 * carries its own paint.
 */
export function basemapPaint(theme: Theme): Record<string, number> {
  if (theme === "dark") return {};
  return {
    "raster-brightness-min": 0,
    "raster-brightness-max": 1,
    "raster-hue-rotate": 0,
    "raster-saturation": -0.25,
    "raster-contrast": 0,
  };
}

/** The site's ink, for the district outlines drawn on top of the tiles. */
export function inkFor(theme: Theme): string {
  return theme === "dark" ? "#e8e6e3" : "#2a2621";
}
