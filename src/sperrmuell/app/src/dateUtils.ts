import type { IsoDate } from "./types.js";

/** Today's date as "YYYY-MM-DD" in the browser's local timezone. */
export function todayIso(date: Date = new Date()): IsoDate {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Compare two ISO date strings; -1/0/1 like Array#sort comparators. */
export function compareIsoDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Pick the date to show by default: the next collection date on or after
 * `today` ("today" if there's a collection today, otherwise the next
 * upcoming one). If every available date is in the past (e.g. the data is
 * for a previous year), fall back to the most recent one so the app still
 * shows something rather than an empty map.
 */
export function pickDefaultDate(availableDates: IsoDate[], today: IsoDate): IsoDate | undefined {
  if (availableDates.length === 0) return undefined;
  const sorted = [...availableDates].sort(compareIsoDates);
  const upcoming = sorted.find((d) => compareIsoDates(d, today) >= 0);
  return upcoming ?? sorted[sorted.length - 1];
}

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("de-DE", { weekday: "long" });
const DATE_FORMAT = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" });

function parseIsoDate(date: IsoDate): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** "Montag, 15. Juni 2026" */
export function formatDateLabel(date: IsoDate): string {
  const d = parseIsoDate(date);
  return `${WEEKDAY_FORMAT.format(d)}, ${DATE_FORMAT.format(d)}`;
}

/** Number of days between two ISO dates (b - a), using local-time midnight. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((parseIsoDate(b).getTime() - parseIsoDate(a).getTime()) / msPerDay);
}

/** "Heute" / "Morgen" / "Gestern" / "in 5 Tagen" / "vor 3 Tagen". */
export function relativeDayLabel(date: IsoDate, today: IsoDate): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return "Heute";
  if (diff === 1) return "Morgen";
  if (diff === -1) return "Gestern";
  if (diff > 1) return `in ${diff} Tagen`;
  return `vor ${-diff} Tagen`;
}
