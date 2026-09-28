import { describe, expect, it } from "vitest";
import { colorForDate } from "../src/colors.js";

describe("colorForDate", () => {
  it("is deterministic for the same date", () => {
    expect(colorForDate("2026-06-15")).toBe(colorForDate("2026-06-15"));
  });

  it("returns a valid hsl() string", () => {
    expect(colorForDate("2026-06-15")).toMatch(/^hsl\(\d+(\.\d+)?, 65%, 45%\)$/);
  });

  it("gives different hues to different dates", () => {
    const colors = new Set(
      ["2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19"].map(colorForDate),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});
