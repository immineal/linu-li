import type { BuildIndex } from "./types.js";

const GENERATED_FORMAT = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

/**
 * Default content for the bottom sheet: source attribution (CC BY 4.0 + OSM
 * ODbL). This is shown until an address search or map selection replaces it.
 */
export function renderInfoPanel(index: BuildIndex): void {
  const container = document.getElementById("bottom-sheet-content");
  if (!container) return;

  const { sourceCsv, generatedAt } = index;

  container.innerHTML = `
    <h2>Quellen</h2>
    <p>
      Abfuhrtermine: <a href="${sourceCsv.url}" rel="noopener" target="_blank">bonnorange AöR / opendata.bonn.de</a><br />
      Lizenz: ${sourceCsv.license}<br />
      Gültig: ${sourceCsv.dataDate}
    </p>
    <p>
      Straßen- und Ortsteilgeometrie: © OpenStreetMap-Mitwirkende,
      <a href="https://www.openstreetmap.org/copyright" rel="noopener" target="_blank">ODbL</a>
    </p>
    <p>Stand: ${GENERATED_FORMAT.format(new Date(generatedAt))}</p>
  `;
}
