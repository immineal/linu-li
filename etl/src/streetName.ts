/**
 * Normalize a German street name for fuzzy matching between the bonnorange
 * CSV (which often abbreviates "...straße" as "...str.") and OpenStreetMap
 * (which spells it out), and for matching free-text user search input.
 *
 * Examples that should all normalize to the same value:
 *   "Trierer Str."   -> "triererstrasse"
 *   "Trierer Straße" -> "triererstrasse"
 *   "trierer strasse" -> "triererstrasse"
 *   "Gerastr."        -> "gerastrasse"
 *   "Johannes-v.-Hanstein-Str." -> "johannesvonhansteinstrasse"
 */
export function normalizeStreetName(name: string): string {
  let s = name.trim().toLowerCase();
  s = s
    .replace(/ß/g, "ss")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u");
  // "v." as an abbreviation of "von" (e.g. "Johannes-v.-Hanstein-Str.")
  s = s.replace(/\bv\.\s*/g, "von ");
  // "...str." or "...str" at the end of a word -> "...strasse"
  s = s.replace(/str\.?(\s|$)/g, "strasse$1");
  // Strip everything that isn't a letter or digit (spaces, hyphens, dots).
  s = s.replace(/[^a-z0-9]/g, "");
  return s;
}
