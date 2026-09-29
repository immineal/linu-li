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
 * How the OpenStreetMap tiles are drawn under each theme. The standard tiles
 * are light only; the dark theme flips them via MapLibre's own raster paint:
 * brightness-min above brightness-max reverses the ramp (black pixels come
 * out light-grey, white pixels come out near-black), and a 180° hue rotate
 * puts colours back the right way round after the inversion — so water
 * reads as blue again and parks as green, on a dark ground. The collection
 * streets stay in their accent colours and keep contrast against both.
 */
export function basemapPaint(theme: Theme): Record<string, number> {
  return theme === "dark"
    ? {
        "raster-brightness-min": 0.32,
        "raster-brightness-max": 0.04,
        "raster-hue-rotate": 180,
        "raster-saturation": -0.2,
        "raster-contrast": 0.15,
      }
    : {
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
