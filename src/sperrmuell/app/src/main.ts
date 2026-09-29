import "./style.css";
import { ORTSTEIL_LAYERS, ROUTE_LAYERS, SperrmuellMap } from "./map.js";
import { loadAppData } from "./dataLoader.js";
import { compareIsoDates, formatDateLabel, pickDefaultDate, relativeDayLabel, todayIso } from "./dateUtils.js";
import { colorForDate } from "./colors.js";
import { renderInfoPanel } from "./infoPanel.js";
import { findSegments, parseAddressQuery, renderSearchResult } from "./search.js";
import { THEME_COLOR, readTheme, storeTheme, type Theme } from "./theme.js";
import type { IsoDate } from "./types.js";

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

function setStatus(message: string | null): void {
  const banner = requireElement<HTMLElement>("status-banner");
  if (message === null) {
    banner.hidden = true;
    banner.textContent = "";
  } else {
    banner.hidden = false;
    banner.textContent = message;
  }
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  // The initial theme has to be known before the map is created, because
  // the two themes have different basemaps (OSM raster vs OpenFreeMap
  // vector) — flipping later would repaint the whole style, which is what
  // sperrmuellMap.setTheme() handles from the second call onwards.
  let theme: Theme = readTheme(storage());
  const sperrmuellMap = new SperrmuellMap(requireElement("map"), theme);

  // The switch works from the start, before the data has arrived
  function applyTheme(): void {
    document.documentElement.classList.toggle("light", theme === "light");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
    sperrmuellMap.setTheme(theme);
  }
  applyTheme();
  requireElement<HTMLButtonElement>("theme-toggle").addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    storeTheme(storage(), theme);
    applyTheme();
  });

  const data = await loadAppData();

  const today = todayIso();
  const availableDates: IsoDate[] = [...data.index.availableDates].sort(compareIsoDates);

  const dateLabel = requireElement<HTMLElement>("date-label");
  const dateRelative = requireElement<HTMLElement>("date-relative");
  const datePrev = requireElement<HTMLButtonElement>("date-prev");
  const dateNext = requireElement<HTMLButtonElement>("date-next");

  let dateIndex = 0;
  const defaultDate = pickDefaultDate(availableDates, today);
  if (defaultDate) dateIndex = Math.max(0, availableDates.indexOf(defaultDate));

  function showDate(index: number): void {
    dateIndex = index;
    const date = availableDates[dateIndex];
    const color = colorForDate(date);
    sperrmuellMap.setSegments(data.segmentsByDate.get(date) ?? [], color);
    sperrmuellMap.setRoute(data.routesByDate.get(date), color);
    dateLabel.textContent = formatDateLabel(date);
    dateRelative.textContent = relativeDayLabel(date, today);
    datePrev.disabled = dateIndex === 0;
    dateNext.disabled = dateIndex === availableDates.length - 1;
  }

  datePrev.addEventListener("click", () => {
    if (dateIndex > 0) showDate(dateIndex - 1);
  });
  dateNext.addEventListener("click", () => {
    if (dateIndex < availableDates.length - 1) showDate(dateIndex + 1);
  });

  sperrmuellMap.onLoad(() => {
    sperrmuellMap.setupLayers(data.ortsteile);
    sperrmuellMap.setTheme(theme);
    if (availableDates.length > 0) showDate(dateIndex);
  });

  const searchForm = requireElement<HTMLFormElement>("search-form");
  const searchInput = requireElement<HTMLInputElement>("search-input");
  const searchResult = requireElement<HTMLElement>("search-result");
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = searchInput.value.trim();
    if (!query) {
      searchResult.innerHTML = "";
      sperrmuellMap.setHighlight(undefined);
      return;
    }

    const address = parseAddressQuery(query);
    if (!address) {
      searchResult.innerHTML = "";
      const p = document.createElement("p");
      p.textContent = "Bitte Straße und Hausnummer eingeben, z. B. „Trierer Str. 130“.";
      searchResult.appendChild(p);
      sperrmuellMap.setHighlight(undefined);
      return;
    }

    const matches = findSegments(data, address);
    renderSearchResult(
      searchResult,
      address,
      matches,
      today,
      (date) => {
        const index = availableDates.indexOf(date);
        if (index >= 0) showDate(index);
      },
      () => {
        sperrmuellMap.setHighlight(undefined);
        searchResult.innerHTML = "";
      },
    );

    const withGeometry = matches.find((m) => m.geometry !== null);
    sperrmuellMap.setHighlight(withGeometry);
    if (withGeometry) sperrmuellMap.flyToFeature(withGeometry);
  });

  const routesCheckbox = requireElement<HTMLInputElement>("layer-routes");
  routesCheckbox.addEventListener("change", () => {
    sperrmuellMap.setLayersVisible(ROUTE_LAYERS, routesCheckbox.checked);
  });

  const ortsteileCheckbox = requireElement<HTMLInputElement>("layer-ortsteile");
  ortsteileCheckbox.addEventListener("change", () => {
    sperrmuellMap.setLayersVisible(ORTSTEIL_LAYERS, ortsteileCheckbox.checked);
  });

  const layersToggle = requireElement<HTMLButtonElement>("layers-toggle");
  const layersPanel = requireElement<HTMLElement>("layers-panel");
  layersToggle.addEventListener("click", () => {
    const expanded = layersToggle.getAttribute("aria-expanded") === "true";
    layersToggle.setAttribute("aria-expanded", String(!expanded));
    layersPanel.hidden = expanded;
  });
  function closeLayersPanel(): void {
    layersPanel.hidden = true;
    layersToggle.setAttribute("aria-expanded", "false");
  }
  document.addEventListener("click", (event) => {
    if (layersPanel.hidden) return;
    const target = event.target;
    if (target instanceof Node && (layersPanel.contains(target) || layersToggle.contains(target))) return;
    closeLayersPanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !layersPanel.hidden) {
      closeLayersPanel();
      layersToggle.focus();
    }
  });

  const bottomSheet = requireElement<HTMLElement>("bottom-sheet");
  const bottomSheetHandle = requireElement<HTMLElement>("bottom-sheet-handle");
  function toggleBottomSheet(): void {
    const expanded = bottomSheet.classList.toggle("expanded");
    bottomSheetHandle.setAttribute("aria-expanded", String(expanded));
  }
  bottomSheetHandle.addEventListener("click", toggleBottomSheet);
  bottomSheetHandle.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleBottomSheet();
    }
  });

  renderInfoPanel(data.index);
}

main().catch((err) => {
  setStatus(`Daten konnten nicht geladen werden: ${(err as Error).message}`);
});

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // Offline support is best-effort; failure here shouldn't block the app.
    });
  });
}
