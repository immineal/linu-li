import { describe, expect, it } from "vitest";
import { normalizeStreetName } from "../src/streetName.js";

describe("normalizeStreetName", () => {
  it("treats 'Str.' and 'Straße' as equivalent", () => {
    expect(normalizeStreetName("Trierer Str.")).toBe("triererstrasse");
    expect(normalizeStreetName("Trierer Straße")).toBe("triererstrasse");
    expect(normalizeStreetName("trierer strasse")).toBe("triererstrasse");
  });

  it("handles 'Str' without a trailing dot, and umlauts/ß", () => {
    expect(normalizeStreetName("Gerastr.")).toBe("gerastrasse");
    expect(normalizeStreetName("Gerastr")).toBe("gerastrasse");
    expect(normalizeStreetName("Königswinterer Straße")).toBe("konigswintererstrasse");
  });

  it("strips spaces and hyphens", () => {
    expect(normalizeStreetName("Bad Godesberg-Allee")).toBe("badgodesbergallee");
  });

  it("expands 'v.' to 'von'", () => {
    expect(normalizeStreetName("Johannes-v.-Hanstein-Str.")).toBe("johannesvonhansteinstrasse");
    expect(normalizeStreetName("Johannes-von-Hanstein-Straße")).toBe("johannesvonhansteinstrasse");
  });
});
