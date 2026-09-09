import { describe, expect, it } from "vitest";
import { normalizeStreetName } from "../src/streetName.js";

describe("normalizeStreetName", () => {
  it("treats 'Str.' and 'Straße' as equivalent", () => {
    expect(normalizeStreetName("Trierer Str.")).toBe(normalizeStreetName("Trierer Straße"));
    expect(normalizeStreetName("trierer strasse")).toBe(normalizeStreetName("Trierer Str."));
  });

  it("normalizes umlauts and ß", () => {
    expect(normalizeStreetName("Gerastr.")).toBe("gerastrasse");
    expect(normalizeStreetName("Königstraße")).toBe("konigstrasse");
  });

  it("expands 'v.' to 'von'", () => {
    expect(normalizeStreetName("Johannes-v.-Hanstein-Str.")).toBe(
      normalizeStreetName("Johannes-von-Hanstein-Straße"),
    );
  });
});
