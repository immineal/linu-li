import { describe, expect, it } from "vitest";
import { addDays, compareIsoDates, parseGermanDate } from "../src/dates.js";

describe("parseGermanDate", () => {
  it("parses DD.MM.YYYY into ISO YYYY-MM-DD", () => {
    expect(parseGermanDate("15.06.2026")).toBe("2026-06-15");
    expect(parseGermanDate("26.02.2026")).toBe("2026-02-26");
    expect(parseGermanDate("03.11.2026")).toBe("2026-11-03");
    expect(parseGermanDate(" 01.01.2026 ")).toBe("2026-01-01");
  });

  it("rejects malformed input", () => {
    expect(() => parseGermanDate("2026-06-15")).toThrow();
    expect(() => parseGermanDate("15/06/2026")).toThrow();
    expect(() => parseGermanDate("")).toThrow();
  });

  it("rejects calendar-invalid dates", () => {
    expect(() => parseGermanDate("31.02.2026")).toThrow();
    expect(() => parseGermanDate("32.01.2026")).toThrow();
    expect(() => parseGermanDate("00.01.2026")).toThrow();
  });
});

describe("addDays", () => {
  it("adds and subtracts days across month/year boundaries", () => {
    expect(addDays("2026-06-15", 1)).toBe("2026-06-16");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01"); // 2026 is not a leap year
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("compareIsoDates", () => {
  it("orders dates lexicographically (which is chronological for ISO)", () => {
    expect(compareIsoDates("2026-02-26", "2026-06-15")).toBeLessThan(0);
    expect(compareIsoDates("2026-11-03", "2026-06-15")).toBeGreaterThan(0);
    expect(compareIsoDates("2026-06-15", "2026-06-15")).toBe(0);
  });
});
