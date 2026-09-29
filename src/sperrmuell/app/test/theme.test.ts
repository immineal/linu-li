import { describe, expect, it } from "vitest";
import { basemapPaint, inkFor, readTheme, storeTheme } from "../src/theme.js";

const store = (value: string | null) => ({ getItem: () => value });

describe("theme", () => {
  it("is dark unless light was chosen on the site, like the rest of linu.li", () => {
    expect(readTheme(store(null))).toBe("dark");
    expect(readTheme(store("dark"))).toBe("dark");
    expect(readTheme(store("light"))).toBe("light");
    expect(readTheme(store("something else"))).toBe("dark");
  });

  it("falls back to dark when storage is blocked", () => {
    expect(readTheme(null)).toBe("dark");
    expect(readTheme({ getItem: () => { throw new Error("SecurityError"); } })).toBe("dark");
  });

  it("stores the choice under the key the site reads, and survives blocked storage", () => {
    const saved: Record<string, string> = {};
    storeTheme({ setItem: (k, v) => { saved[k] = v; } }, "light");
    expect(saved).toEqual({ theme: "light" });
    expect(() => storeTheme({ setItem: () => { throw new Error("QuotaExceeded"); } }, "dark")).not.toThrow();
  });

  it("dims the tiles in the dark and leaves them at full brightness in the light", () => {
    expect(basemapPaint("dark")["raster-brightness-max"]).toBeLessThan(1);
    expect(basemapPaint("light")["raster-brightness-max"]).toBe(1);
    expect(Object.keys(basemapPaint("dark")).sort()).toEqual(Object.keys(basemapPaint("light")).sort());
  });

  it("draws district outlines in the site's ink", () => {
    expect(inkFor("light")).toBe("#2a2621");
    expect(inkFor("dark")).toBe("#e8e6e3");
  });
});
