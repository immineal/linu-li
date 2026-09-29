import type { OrtsteilFeature } from "./fetchOsm.js";

/**
 * Normalize an Ortsteil name for comparison: lowercase, fold umlauts/ß,
 * strip everything that isn't a letter or digit. This makes "Pützchen/
 * Bechlinghoven" and "Pützchen-Bechlinghoven" compare equal, for example.
 */
export function normalizeOrtsteilName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Explicit aliases for CSV ORTSTEIL1 values whose normalized form does not
 * exactly or substring-match the corresponding OSM admin_level=10 boundary
 * name. Keyed by the normalized CSV value.
 */
const ALIASES: Record<string, string> = {
  beuelzentrum: "beuelmitte",
  badgodesbergvillenviert: "villenviertel",
};

/**
 * Resolve a CSV ORTSTEIL1 value to an OSM admin_level=10 boundary polygon,
 * for spatial disambiguation of street names that occur in multiple parts
 * of Bonn. Returns undefined if no confident match is found (callers must
 * then fall back to an unfiltered candidate set).
 */
export function resolveOrtsteilPolygon(
  ortsteile: OrtsteilFeature[],
  csvOrtsteil: string,
): OrtsteilFeature | undefined {
  const stripped = csvOrtsteil.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (stripped === "") return undefined;

  const normalized = ALIASES[normalizeOrtsteilName(stripped)] ?? normalizeOrtsteilName(stripped);

  const named = ortsteile.filter((f) => typeof f.properties.name === "string" && f.properties.name);

  const exact = named.find((f) => normalizeOrtsteilName(f.properties.name) === normalized);
  if (exact) return exact;

  const substring = named.find((f) => {
    const osmNorm = normalizeOrtsteilName(f.properties.name);
    return osmNorm.includes(normalized) || normalized.includes(osmNorm);
  });
  return substring;
}
