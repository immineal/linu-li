import { describe, expect, it } from "vitest";
import {
  addressMatchesPredicate,
  buildAddressPredicate,
  describePredicate,
  parseHnrNeg,
  parseHouseNumberToken,
} from "../src/predicate.js";

describe("parseHouseNumberToken", () => {
  it("splits a number and an optional letter suffix", () => {
    expect(parseHouseNumberToken("8B")).toEqual({ raw: "8B", number: 8, suffix: "B" });
    expect(parseHouseNumberToken("138")).toEqual({ raw: "138", number: 138, suffix: "" });
    expect(parseHouseNumberToken(" 25A ")).toEqual({ raw: "25A", number: 25, suffix: "A" });
  });
});

describe("parseHnrNeg", () => {
  it("returns [] for empty input", () => {
    expect(parseHnrNeg("")).toEqual([]);
    expect(parseHnrNeg("   ")).toEqual([]);
  });

  it("splits a comma-separated list", () => {
    expect(parseHnrNeg("1, 1A, 1B, 1C, 1D")).toEqual([
      { raw: "1", number: 1, suffix: "" },
      { raw: "1A", number: 1, suffix: "A" },
      { raw: "1B", number: 1, suffix: "B" },
      { raw: "1C", number: 1, suffix: "C" },
      { raw: "1D", number: 1, suffix: "D" },
    ]);
  });
});

describe("buildAddressPredicate", () => {
  it("builds even+odd ranges with open ends from 9998/9999 sentinels", () => {
    const p = buildAddressPredicate({
      hnrGeAb: "2",
      hnrGeBis: "9998",
      hnrUgAb: "1",
      hnrUgBis: "9999",
      hnrNeg: "",
    });
    expect(p.wholeStreet).toBe(false);
    expect(p.ranges).toEqual([
      { parity: "even", from: 2, to: null },
      { parity: "odd", from: 1, to: null },
    ]);
    expect(p.toggles).toEqual([]);
  });

  it("treats both ranges empty as 'whole street'", () => {
    const p = buildAddressPredicate({
      hnrGeAb: "",
      hnrGeBis: "",
      hnrUgAb: "",
      hnrUgBis: "",
      hnrNeg: "",
    });
    expect(p.wholeStreet).toBe(true);
    expect(p.ranges).toEqual([]);
  });

  it("supports a one-sided range (only odd numbers covered)", () => {
    const p = buildAddressPredicate({
      hnrGeAb: "",
      hnrGeBis: "",
      hnrUgAb: "105",
      hnrUgBis: "9999",
      hnrNeg: "",
    });
    expect(p.wholeStreet).toBe(false);
    expect(p.ranges).toEqual([{ parity: "odd", from: 105, to: null }]);
    expect(addressMatchesPredicate(p, 105)).toBe(true);
    expect(addressMatchesPredicate(p, 200)).toBe(false); // even side not covered
    expect(addressMatchesPredicate(p, 103)).toBe(false); // below range start
  });
});

describe("addressMatchesPredicate", () => {
  it("matches plain even/odd ranges by parity and bounds", () => {
    const p = buildAddressPredicate({
      hnrGeAb: "128",
      hnrGeBis: "136",
      hnrUgAb: "77",
      hnrUgBis: "115",
      hnrNeg: "",
    });
    expect(addressMatchesPredicate(p, 128)).toBe(true);
    expect(addressMatchesPredicate(p, 136)).toBe(true);
    expect(addressMatchesPredicate(p, 138)).toBe(false); // outside even range
    expect(addressMatchesPredicate(p, 77)).toBe(true);
    expect(addressMatchesPredicate(p, 117)).toBe(false); // outside odd range
    expect(addressMatchesPredicate(p, 130)).toBe(true); // even, within even range
    expect(addressMatchesPredicate(p, 126)).toBe(false); // even, below even range
  });

  it("HNR_NEG excludes an address that would otherwise be in range", () => {
    // Real example: Sedanstr. GE 2-8, NEG "8B, 8C" -> 8 itself stays in,
    // but 8B/8C (sub-addresses of building 8) are handled elsewhere.
    const p = buildAddressPredicate({
      hnrGeAb: "2",
      hnrGeBis: "8",
      hnrUgAb: "1",
      hnrUgBis: "11",
      hnrNeg: "8B, 8C",
    });
    expect(addressMatchesPredicate(p, 8)).toBe(true);
    expect(addressMatchesPredicate(p, 8, "B")).toBe(false);
    expect(addressMatchesPredicate(p, 8, "C")).toBe(false);
    expect(addressMatchesPredicate(p, 8, "Z")).toBe(true); // not toggled, base range still applies
  });

  it("HNR_NEG additionally includes an address outside the normal range", () => {
    // Real example: Friesdorfer Str. GE 186-240, UG 141-187, NEG "258"
    // -> 258 is outside the even range but explicitly added.
    const p = buildAddressPredicate({
      hnrGeAb: "186",
      hnrGeBis: "240",
      hnrUgAb: "141",
      hnrUgBis: "187",
      hnrNeg: "258",
    });
    expect(addressMatchesPredicate(p, 200)).toBe(true); // normal even range
    expect(addressMatchesPredicate(p, 242)).toBe(false); // outside range, not toggled
    expect(addressMatchesPredicate(p, 258)).toBe(true); // outside range, but toggled in
  });

  it("'whole street' predicate matches any number, with toggles still applying", () => {
    const p = buildAddressPredicate({
      hnrGeAb: "",
      hnrGeBis: "",
      hnrUgAb: "",
      hnrUgBis: "",
      hnrNeg: "1, 1A",
    });
    expect(p.wholeStreet).toBe(true);
    expect(addressMatchesPredicate(p, 2)).toBe(true);
    expect(addressMatchesPredicate(p, 999)).toBe(true);
    expect(addressMatchesPredicate(p, 1)).toBe(false);
    expect(addressMatchesPredicate(p, 1, "A")).toBe(false);
    expect(addressMatchesPredicate(p, 1, "Z")).toBe(true);
  });
});

describe("describePredicate", () => {
  it("describes a two-sided open-ended range", () => {
    const p = buildAddressPredicate({
      hnrGeAb: "2",
      hnrGeBis: "9998",
      hnrUgAb: "1",
      hnrUgBis: "9999",
      hnrNeg: "",
    });
    expect(describePredicate(p)).toBe("gerade 2–Ende; ungerade 1–Ende");
  });

  it("describes the whole-street case", () => {
    const p = buildAddressPredicate({
      hnrGeAb: "",
      hnrGeBis: "",
      hnrUgAb: "",
      hnrUgBis: "",
      hnrNeg: "",
    });
    expect(describePredicate(p)).toBe("ganze Straße");
  });

  it("describes excluded and additionally-included numbers separately", () => {
    const excluded = buildAddressPredicate({
      hnrGeAb: "2",
      hnrGeBis: "8",
      hnrUgAb: "1",
      hnrUgBis: "11",
      hnrNeg: "8B, 8C",
    });
    expect(describePredicate(excluded)).toBe("gerade 2–8; ungerade 1–11; außer 8B, 8C");

    const included = buildAddressPredicate({
      hnrGeAb: "186",
      hnrGeBis: "240",
      hnrUgAb: "141",
      hnrUgBis: "187",
      hnrNeg: "258",
    });
    expect(describePredicate(included)).toBe(
      "gerade 186–240; ungerade 141–187; zusätzlich 258",
    );
  });
});
