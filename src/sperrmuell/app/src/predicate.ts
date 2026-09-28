import type { AddressPredicate, HouseNumberRange, Parity } from "./types.js";

function inRanges(ranges: HouseNumberRange[], number: number): boolean {
  const parity: Parity = number % 2 === 0 ? "even" : "odd";
  return ranges.some((r) => {
    if (r.parity !== parity) return false;
    if (number < r.from) return false;
    if (r.to !== null && number > r.to) return false;
    return true;
  });
}

/**
 * Does this predicate cover the given house number (+ optional letter
 * suffix, e.g. "12A" -> number=12, suffix="A")?
 *
 * Kept in sync with `etl/src/predicate.ts`.
 */
export function addressMatchesPredicate(predicate: AddressPredicate, number: number, suffix = ""): boolean {
  const baseMatch = predicate.wholeStreet ? true : inRanges(predicate.ranges, number);
  const normSuffix = suffix.trim().toUpperCase();
  const toggled = predicate.toggles.some((t) => t.number === number && t.suffix === normSuffix);
  return toggled ? !baseMatch : baseMatch;
}
