/**
 * Normalize a German street name for fuzzy matching between user search
 * input and the `street` property in segments.geojson (which mirrors the
 * bonnorange CSV's STRASSE1 column).
 *
 * Examples that should all normalize to the same value:
 *   "Trierer Str."   -> "triererstrasse"
 *   "Trierer Straße" -> "triererstrasse"
 *   "trierer strasse" -> "triererstrasse"
 *   "Johannes-v.-Hanstein-Str." -> "johannesvonhansteinstrasse"
 *
 * Kept in sync with `etl/src/streetName.ts`.
 */
export function normalizeStreetName(name: string): string {
  let s = name.trim().toLowerCase();
  s = s
    .replace(/ß/g, "ss")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u");
  s = s.replace(/\bv\.\s*/g, "von ");
  s = s.replace(/str\.?(\s|$)/g, "strasse$1");
  s = s.replace(/[^a-z0-9]/g, "");
  return s;
}
