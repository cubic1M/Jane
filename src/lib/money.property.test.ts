import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { centsToInput, formatCents, parseMoneyToCents } from "./money";

const cents = fc.integer({ min: -100_000_000_00, max: 100_000_000_00 });

describe("money, for any amount", () => {
  it("reads back what a form field wrote", () => {
    fc.assert(
      fc.property(cents, (c) => {
        expect(parseMoneyToCents(centsToInput(c))).toBe(c);
      }),
    );
  });

  it("reads back what the page shows", () => {
    fc.assert(
      fc.property(cents, (c) => {
        expect(parseMoneyToCents(formatCents(c))).toBe(c);
      }),
    );
  });

  it("reads an accounting negative the same as a minus sign", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000_000_00 }), (c) => {
        expect(parseMoneyToCents(`(${centsToInput(c)})`)).toBe(-c);
      }),
    );
  });

  it("never gives anything but a whole number of cents or null", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const value = parseMoneyToCents(text);
        expect(value === null || Number.isSafeInteger(value)).toBe(true);
        expect(Object.is(value, -0)).toBe(false);
      }),
    );
  });
});
