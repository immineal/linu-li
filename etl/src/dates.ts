import type { IsoDate } from "./types.js";

const GERMAN_DATE_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;

/**
 * Parse a German "DD.MM.YYYY" date into an ISO "YYYY-MM-DD" string.
 * Throws on malformed input or dates that don't round-trip (e.g. 31.02.2026).
 */
export function parseGermanDate(value: string): IsoDate {
  const m = GERMAN_DATE_RE.exec(value.trim());
  if (!m) {
    throw new Error(`Not a German DD.MM.YYYY date: ${JSON.stringify(value)}`);
  }
  const [, dd, mm, yyyy] = m;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);

  // Validate via UTC Date round-trip so e.g. 31.02.2026 is rejected.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${JSON.stringify(value)}`);
  }

  return `${yyyy}-${mm}-${dd}`;
}

/** Today's date as an ISO "YYYY-MM-DD" string (UTC). */
export function todayIso(): IsoDate {
  return new Date().toISOString().slice(0, 10);
}

/** Add `days` (may be negative) to an ISO date string, returning ISO. */
export function addDays(iso: IsoDate, days: number): IsoDate {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Compare two ISO date strings; -1/0/1 like Array#sort comparators. */
export function compareIsoDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
