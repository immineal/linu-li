import { describe, expect, it } from "vitest";
import {
  compareIsoDates,
  daysBetween,
  formatDateLabel,
  pickDefaultDate,
  relativeDayLabel,
  todayIso,
} from "../src/dateUtils.js";

describe("compareIsoDates", () => {
  it("orders ISO date strings chronologically", () => {
    expect(compareIsoDates("2026-06-15", "2026-06-16")).toBeLessThan(0);
    expect(compareIsoDates("2026-06-16", "2026-06-15")).toBeGreaterThan(0);
    expect(compareIsoDates("2026-06-15", "2026-06-15")).toBe(0);
  });
});

describe("pickDefaultDate", () => {
  it("picks the next upcoming date on or after today", () => {
    const dates = ["2026-06-10", "2026-06-15", "2026-06-20"];
    expect(pickDefaultDate(dates, "2026-06-12")).toBe("2026-06-15");
    expect(pickDefaultDate(dates, "2026-06-15")).toBe("2026-06-15");
  });

  it("falls back to the most recent date if everything is in the past", () => {
    const dates = ["2026-01-05", "2026-01-10"];
    expect(pickDefaultDate(dates, "2026-06-15")).toBe("2026-01-10");
  });

  it("returns undefined for an empty list", () => {
    expect(pickDefaultDate([], "2026-06-15")).toBeUndefined();
  });
});

describe("formatDateLabel", () => {
  it("formats an ISO date as a German weekday + date", () => {
    expect(formatDateLabel("2026-06-15")).toBe("Montag, 15. Juni 2026");
  });
});

describe("daysBetween", () => {
  it("counts whole days between two ISO dates", () => {
    expect(daysBetween("2026-06-15", "2026-06-16")).toBe(1);
    expect(daysBetween("2026-06-16", "2026-06-15")).toBe(-1);
    expect(daysBetween("2026-06-15", "2026-06-15")).toBe(0);
  });
});

describe("relativeDayLabel", () => {
  it("labels today, tomorrow, yesterday, and other offsets in German", () => {
    expect(relativeDayLabel("2026-06-15", "2026-06-15")).toBe("Heute");
    expect(relativeDayLabel("2026-06-16", "2026-06-15")).toBe("Morgen");
    expect(relativeDayLabel("2026-06-14", "2026-06-15")).toBe("Gestern");
    expect(relativeDayLabel("2026-06-20", "2026-06-15")).toBe("in 5 Tagen");
    expect(relativeDayLabel("2026-06-10", "2026-06-15")).toBe("vor 5 Tagen");
  });
});

describe("todayIso", () => {
  it("formats a Date as local YYYY-MM-DD", () => {
    expect(todayIso(new Date(2026, 5, 15))).toBe("2026-06-15");
  });
});
