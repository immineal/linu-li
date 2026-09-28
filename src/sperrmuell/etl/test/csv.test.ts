import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/csv.js";

const fixturePath = fileURLToPath(
  new URL("./fixtures/sample-sperrmuell.csv", import.meta.url),
);

describe("parseCsv", () => {
  it("strips the UTF-8 BOM and parses the header", () => {
    const raw = readFileSync(fixturePath, "utf-8");
    expect(raw.charCodeAt(0)).toBe(0xfeff); // sanity: fixture really has a BOM

    const { header } = parseCsv(raw);
    expect(header.length).toBe(221);
    expect(header[0]).toBe("ID_TERMINE"); // no leftover BOM char
    expect(header[2]).toBe("PLAN_BEZ");
    expect(header[40]).toBe("TERMIN000");
    expect(header[220]).toBe("TERMIN180");
  });

  it("parses CRLF-separated rows into column maps", () => {
    const raw = readFileSync(fixturePath, "utf-8");
    const { rows } = parseCsv(raw);

    expect(rows.length).toBe(22);
    for (const row of rows) {
      expect(Object.keys(row).length).toBe(221);
    }

    const trier = rows.find(
      (r) => r.STRASSE1 === "Trierer Str." && r.HNR_GE_AB === "128",
    );
    expect(trier).toBeDefined();
    expect(trier?.PLAN_BEZ).toBe("Sperrmüll");
    expect(trier?.ORTSTEIL1).toBe("Ippendorf (BN)");
    expect(trier?.PLZ1).toBe("53115");
    expect(trier?.TERMIN002).toBe("15.06.2026");
  });

  it("handles empty trailing lines and BOM-free input", () => {
    const { header, rows } = parseCsv("A;B;C\nfoo;;bar\n\n");
    expect(header).toEqual(["A", "B", "C"]);
    expect(rows).toEqual([{ A: "foo", B: "", C: "bar" }]);
  });
});
