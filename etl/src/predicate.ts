import type {
  AddressPredicate,
  HouseNumberRange,
  HouseNumberToken,
  Parity,
} from "./types.js";

const EVEN_OPEN_END = 9998;
const ODD_OPEN_END = 9999;

/**
 * Parse a house-number token like "8B" -> { raw: "8B", number: 8, suffix: "B" }.
 * Returns `null` for tokens that don't start with a number (e.g. some OSM
 * addr:housenumber values like "12-14" or non-numeric values).
 */
export function tryParseHouseNumberToken(raw: string): HouseNumberToken | null {
  const trimmed = raw.trim();
  const m = /^(\d+)\s*(.*)$/.exec(trimmed);
  if (!m) return null;
  return {
    raw: trimmed,
    number: Number(m[1]),
    suffix: m[2].trim().toUpperCase(),
  };
}

/** Like {@link tryParseHouseNumberToken}, but throws if the token cannot be parsed. */
export function parseHouseNumberToken(raw: string): HouseNumberToken {
  const token = tryParseHouseNumberToken(raw);
  if (token === null) {
    throw new Error(`Cannot parse house number token: ${JSON.stringify(raw)}`);
  }
  return token;
}

/** Parse the comma-separated HNR_NEG column into tokens. Empty input -> []. */
export function parseHnrNeg(value: string): HouseNumberToken[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  return trimmed
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map(parseHouseNumberToken);
}

/**
 * Build one side's range (even or odd) from the GE_/UG_ AB/BIS columns.
 * Returns `null` if both the AB and BIS columns are empty, meaning this
 * side of the street is not covered by the segment at all.
 */
function buildRange(
  parity: Parity,
  ab: string,
  bis: string,
  openEndSentinel: number,
): HouseNumberRange | null {
  const abTrim = ab.trim();
  const bisTrim = bis.trim();
  if (abTrim === "" && bisTrim === "") return null;

  const from = Number(abTrim);
  const bisNum = Number(bisTrim);
  const to = bisNum === openEndSentinel ? null : bisNum;

  if (!Number.isFinite(from) || !Number.isFinite(bisNum)) {
    throw new Error(
      `Invalid house number range (parity=${parity}): ab=${JSON.stringify(ab)} bis=${JSON.stringify(bis)}`,
    );
  }

  return { parity, from, to };
}

export interface AddressPredicateInput {
  hnrGeAb: string;
  hnrGeBis: string;
  hnrUgAb: string;
  hnrUgBis: string;
  hnrNeg: string;
}

/**
 * Build an {@link AddressPredicate} from the raw HNR_* columns of a CSV row.
 *
 * - Even side comes from HNR_GE_AB/HNR_GE_BIS (9998 = open ended).
 * - Odd side comes from HNR_UG_AB/HNR_UG_BIS (9999 = open ended).
 * - If *both* sides are empty, the whole street (any house number) belongs.
 * - HNR_NEG entries toggle membership for the exact number+suffix.
 */
export function buildAddressPredicate(input: AddressPredicateInput): AddressPredicate {
  const evenRange = buildRange("even", input.hnrGeAb, input.hnrGeBis, EVEN_OPEN_END);
  const oddRange = buildRange("odd", input.hnrUgAb, input.hnrUgBis, ODD_OPEN_END);

  const ranges: HouseNumberRange[] = [];
  if (evenRange) ranges.push(evenRange);
  if (oddRange) ranges.push(oddRange);

  return {
    wholeStreet: ranges.length === 0,
    ranges,
    toggles: parseHnrNeg(input.hnrNeg),
  };
}

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
 */
export function addressMatchesPredicate(
  predicate: AddressPredicate,
  number: number,
  suffix = "",
): boolean {
  const baseMatch = predicate.wholeStreet ? true : inRanges(predicate.ranges, number);
  const normSuffix = suffix.trim().toUpperCase();
  const toggled = predicate.toggles.some(
    (t) => t.number === number && t.suffix === normSuffix,
  );
  return toggled ? !baseMatch : baseMatch;
}

/** Render a predicate as a short German-language summary for the UI. */
export function describePredicate(predicate: AddressPredicate): string {
  const parts: string[] = [];

  if (predicate.wholeStreet) {
    parts.push("ganze Straße");
  } else {
    for (const r of predicate.ranges) {
      const label = r.parity === "even" ? "gerade" : "ungerade";
      const to = r.to === null ? "Ende" : String(r.to);
      parts.push(`${label} ${r.from}–${to}`);
    }
  }

  if (predicate.toggles.length > 0) {
    const inside: string[] = [];
    const outside: string[] = [];
    for (const t of predicate.toggles) {
      const base = predicate.wholeStreet ? true : inRanges(predicate.ranges, t.number);
      (base ? inside : outside).push(t.raw);
    }
    if (inside.length > 0) parts.push(`außer ${inside.join(", ")}`);
    if (outside.length > 0) parts.push(`zusätzlich ${outside.join(", ")}`);
  }

  return parts.join("; ");
}
