import { describe, expect, it } from "vitest";
import { addressMatchesPredicate } from "../src/predicate.js";
import type { AddressPredicate } from "../src/types.js";

describe("addressMatchesPredicate", () => {
  it("matches any number when wholeStreet is true", () => {
    const predicate: AddressPredicate = { wholeStreet: true, ranges: [], toggles: [] };
    expect(addressMatchesPredicate(predicate, 1)).toBe(true);
    expect(addressMatchesPredicate(predicate, 130)).toBe(true);
  });

  it("matches numbers within an even/odd range", () => {
    const predicate: AddressPredicate = {
      wholeStreet: false,
      ranges: [
        { parity: "even", from: 2, to: 8 },
        { parity: "odd", from: 1, to: null },
      ],
      toggles: [],
    };
    expect(addressMatchesPredicate(predicate, 4)).toBe(true);
    expect(addressMatchesPredicate(predicate, 10)).toBe(false);
    expect(addressMatchesPredicate(predicate, 101)).toBe(true);
  });

  it("toggles membership for an exact number+suffix from HNR_NEG", () => {
    const predicate: AddressPredicate = {
      wholeStreet: false,
      ranges: [{ parity: "even", from: 2, to: 20 }],
      toggles: [{ raw: "8B", number: 8, suffix: "B" }],
    };
    expect(addressMatchesPredicate(predicate, 8, "B")).toBe(false);
    expect(addressMatchesPredicate(predicate, 8)).toBe(true);
  });
});
