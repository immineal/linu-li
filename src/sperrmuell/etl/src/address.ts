import { addressMatchesPredicate } from "./predicate.js";
import { normalizeStreetName } from "./streetName.js";
import type { SperrmuellSegment } from "./types.js";

export interface AddressQuery {
  street: string;
  houseNumber: number;
  suffix?: string;
}

/** Parse free-text like "Trierer Str. 12a" into a street + house number query. */
export function parseAddressInput(input: string): AddressQuery | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // House number (+ optional letter suffix) at the very end of the string.
  const m = /^(.*\S)\s+(\d+)\s*([a-zA-Z]?)$/.exec(trimmed);
  if (!m) return null;

  const [, street, numStr, suffix] = m;
  return {
    street,
    houseNumber: Number(numStr),
    suffix: suffix ? suffix.toUpperCase() : "",
  };
}

/**
 * Find all segments whose street name matches (after normalization) and
 * whose address predicate covers the given house number.
 */
export function findMatchingSegments(
  segments: SperrmuellSegment[],
  query: AddressQuery,
): SperrmuellSegment[] {
  const target = normalizeStreetName(query.street);
  return segments.filter(
    (segment) =>
      normalizeStreetName(segment.street) === target &&
      addressMatchesPredicate(segment.predicate, query.houseNumber, query.suffix ?? ""),
  );
}
