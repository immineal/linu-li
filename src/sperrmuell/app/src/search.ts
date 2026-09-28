import type { AppData, SegmentFeature } from "./dataLoader.js";
import { normalizeStreetName } from "./streetName.js";
import { addressMatchesPredicate } from "./predicate.js";
import { colorForDate } from "./colors.js";
import { formatDateLabel, relativeDayLabel } from "./dateUtils.js";
import type { GeometryConfidence, IsoDate } from "./types.js";

export interface ParsedAddress {
  street: string;
  number: number;
  suffix: string;
}

/** Parse "Trierer Str. 130" / "Trierer Straße 130 a" -> street + house number + suffix. */
export function parseAddressQuery(query: string): ParsedAddress | null {
  const trimmed = query.trim();
  const m = /^(.+?)\s+(\d+)\s*([a-zA-Z]?)$/.exec(trimmed);
  if (!m) return null;
  const street = m[1].trim();
  if (!street) return null;
  return { street, number: Number(m[2]), suffix: m[3].toUpperCase() };
}

/** Find every segment whose street name and house-number predicate match the given address. */
export function findSegments(data: AppData, address: ParsedAddress): SegmentFeature[] {
  const normalized = normalizeStreetName(address.street);
  if (!normalized) return [];
  return data.segments.filter(
    (f) =>
      normalizeStreetName(f.properties.street) === normalized &&
      addressMatchesPredicate(f.properties.predicate, address.number, address.suffix),
  );
}

const CONFIDENCE_LABEL: Record<GeometryConfidence, string> = {
  exact: "Lage exakt",
  approximate: "Lage ungefähr",
  unmatched: "Lage unbekannt",
};

/**
 * Render the search result panel. `onDateClick` lets the user jump the date
 * scrubber to one of the matched segment's three collection dates.
 * `onHide` (if there is a highlighted match) lets the user remove the
 * highlight from the map again without clearing the search input.
 */
export function renderSearchResult(
  container: HTMLElement,
  address: ParsedAddress,
  matches: SegmentFeature[],
  today: IsoDate,
  onDateClick: (date: IsoDate) => void,
  onHide?: () => void,
): void {
  container.innerHTML = "";
  const suffixLabel = address.suffix;
  const queryLabel = `${address.street} ${address.number}${suffixLabel}`;

  if (matches.length === 0) {
    const p = document.createElement("p");
    p.textContent = `Keine Abholtermine gefunden für „${queryLabel}“.`;
    container.appendChild(p);
    return;
  }

  for (const match of matches) {
    const card = document.createElement("div");
    card.className = "search-match";

    const heading = document.createElement("p");
    heading.className = "search-match-heading";
    heading.textContent = match.properties.ortsteil
      ? `${queryLabel} · ${match.properties.ortsteil}`
      : queryLabel;
    card.appendChild(heading);

    const dateList = document.createElement("ul");
    dateList.className = "search-dates";
    for (const date of match.properties.dates) {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-date-button";
      const swatch = document.createElement("span");
      swatch.className = "confidence-dot";
      swatch.style.background = colorForDate(date);
      swatch.setAttribute("aria-hidden", "true");
      button.appendChild(swatch);
      button.appendChild(document.createTextNode(`${formatDateLabel(date)} (${relativeDayLabel(date, today)})`));
      button.addEventListener("click", () => onDateClick(date));
      li.appendChild(button);
      dateList.appendChild(li);
    }
    card.appendChild(dateList);

    if (match.properties.geometryConfidence !== "exact") {
      const note = document.createElement("p");
      note.className = "search-confidence-note";
      note.textContent = match.properties.confidenceNote
        ? `${CONFIDENCE_LABEL[match.properties.geometryConfidence]}: ${match.properties.confidenceNote}`
        : CONFIDENCE_LABEL[match.properties.geometryConfidence];
      card.appendChild(note);
    }

    container.appendChild(card);
  }

  if (onHide && matches.some((m) => m.geometry !== null)) {
    const hideButton = document.createElement("button");
    hideButton.type = "button";
    hideButton.className = "search-hide-button";
    hideButton.textContent = "Markierung ausblenden";
    hideButton.addEventListener("click", onHide);
    container.appendChild(hideButton);
  }
}
