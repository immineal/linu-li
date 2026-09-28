import type { IsoDate } from "./types.js";

/**
 * Deterministic color for a collection date, used consistently for a date's
 * street segments, its zone polygon, and its badge in the address-search
 * result. Adjacent dates get visually distinct hues (small string changes
 * are amplified by the multiplicative hash).
 */
export function colorForDate(date: IsoDate): string {
  let hash = 0;
  for (let i = 0; i < date.length; i++) {
    hash = (hash * 31 + date.charCodeAt(i)) % 360;
  }
  if (hash < 0) hash += 360;
  return `hsl(${hash}, 65%, 45%)`;
}
