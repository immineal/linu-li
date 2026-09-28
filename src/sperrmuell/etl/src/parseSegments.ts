import { parseGermanDate } from "./dates.js";
import { buildAddressPredicate, describePredicate } from "./predicate.js";
import type { IsoDate, SperrmuellSegment } from "./types.js";

const SPERRMUELL_PLAN_BEZ = "Sperrmüll";

/** All TERMIN column names in source order, TERMIN000..TERMIN180. */
const TERMIN_COLUMNS = Array.from(
  { length: 181 },
  (_, i) => `TERMIN${String(i).padStart(3, "0")}`,
);

export class SegmentParseError extends Error {
  constructor(
    message: string,
    readonly row: Record<string, string>,
  ) {
    super(message);
    this.name = "SegmentParseError";
  }
}

/**
 * Extract the three collection dates for one row, in ascending order.
 * Sperrmüll rows always have exactly three non-empty TERMIN* values
 * (conventionally TERMIN001-003); we scan generically so other layouts
 * still work.
 */
function extractDates(row: Record<string, string>): [IsoDate, IsoDate, IsoDate] {
  const raw: string[] = [];
  for (const col of TERMIN_COLUMNS) {
    const v = row[col]?.trim();
    if (v) raw.push(v);
  }
  if (raw.length !== 3) {
    throw new SegmentParseError(
      `Expected exactly 3 TERMIN dates, found ${raw.length}: [${raw.join(", ")}]`,
      row,
    );
  }
  const isoDates = raw.map(parseGermanDate).sort();
  const unique = new Set(isoDates);
  if (unique.size !== 3) {
    throw new SegmentParseError(
      `Expected 3 distinct dates, got duplicates: [${isoDates.join(", ")}]`,
      row,
    );
  }
  return [isoDates[0], isoDates[1], isoDates[2]];
}

/** Parse a single CSV row into a {@link SperrmuellSegment}, or `null` if it's not a Sperrmüll row. */
export function parseSegmentRow(row: Record<string, string>): SperrmuellSegment | null {
  if (row.PLAN_BEZ !== SPERRMUELL_PLAN_BEZ) return null;

  const predicate = buildAddressPredicate({
    hnrGeAb: row.HNR_GE_AB ?? "",
    hnrGeBis: row.HNR_GE_BIS ?? "",
    hnrUgAb: row.HNR_UG_AB ?? "",
    hnrUgBis: row.HNR_UG_BIS ?? "",
    hnrNeg: row.HNR_NEG ?? "",
  });

  const dates = extractDates(row);

  return {
    id: row.ID_TERMINE,
    street: row.STRASSE1,
    ortsteil: row.ORTSTEIL1,
    plz: row.PLZ1,
    crossStreets: row.STR_BEM1 ?? "",
    predicate,
    rangeLabel: describePredicate(predicate),
    dates,
    route: {
      kreis: row.KREV ?? "",
      kreisBez: row.KREVBEZ ?? "",
      bezirk: row.MREV ?? "",
      bezirkBez: row.MREVBEZ ?? "",
      gebiet: row.GREV ?? "",
      gebietBez: row.GREVBEZ ?? "",
    },
  };
}

/** Parse all Sperrmüll segments out of the full set of CSV rows. */
export function parseSperrmuellSegments(rows: Record<string, string>[]): SperrmuellSegment[] {
  const segments: SperrmuellSegment[] = [];
  for (const row of rows) {
    const segment = parseSegmentRow(row);
    if (segment) segments.push(segment);
  }
  return segments;
}
