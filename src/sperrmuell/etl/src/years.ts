import type { SperrmuellSegment } from "./types.js";

/**
 * One list of segments out of several years' schedules.
 *
 * A stretch of street that appears in two years with the same house numbers
 * becomes one segment carrying both years' dates, so a search shows one card
 * and the map draws one line. Anything that changed between the years (a
 * street split differently, a new cross street) stays separate. ID_TERMINE is
 * only unique within one export, so a later year's segment whose id is
 * already taken gets the year appended.
 */
export function mergeYears(
  byYear: Array<{ year: number; segments: SperrmuellSegment[] }>,
): SperrmuellSegment[] {
  const earlier = new Map<string, SperrmuellSegment[]>();
  const ids = new Set<string>();
  const merged: SperrmuellSegment[] = [];

  for (const { year, segments } of [...byYear].sort((a, b) => a.year - b.year)) {
    // The same export can list one stretch twice, with different dates. Those
    // are two segments and stay two, so a key only ever matches segments of
    // an earlier year, and each of those only once per year.
    const claimed = new Set<SperrmuellSegment>();
    const thisYear = new Map<string, SperrmuellSegment[]>();
    for (const segment of segments) {
      const key = [segment.street, segment.ortsteil, segment.plz, JSON.stringify(segment.predicate)].join("|");
      const match = earlier.get(key)?.find((s) => !claimed.has(s));
      let target: SperrmuellSegment;
      if (match) {
        claimed.add(match);
        match.dates = [...new Set([...match.dates, ...segment.dates])].sort();
        match.route = segment.route;
        match.crossStreets = segment.crossStreets || match.crossStreets;
        target = match;
      } else {
        const id = ids.has(segment.id) ? `${segment.id}-${year}` : segment.id;
        ids.add(id);
        target = { ...segment, id, dates: [...segment.dates] };
        merged.push(target);
      }
      thisYear.set(key, [...(thisYear.get(key) ?? []), target]);
    }
    for (const [key, list] of thisYear) {
      earlier.set(key, [...new Set([...(earlier.get(key) ?? []), ...list])]);
    }
  }
  return merged;
}
