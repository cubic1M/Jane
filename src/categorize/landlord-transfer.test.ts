import { describe, expect, it } from "vitest";
import { categorizeByRules } from "./rules";

// Debugger 11-16 (a recent grad's 14 months of Wells Fargo checking): $1,650 on the 1st every month,
// "ONLINE TRANSFER TO OAKWOOD RESIDENTIAL REF #IB0X4K2P9", was filed as a transfer between their
// own accounts. Rent was in no bill ("the next month of bills: $797") and the books said it "left
// one of your accounts with no matching deposit… add that account". A transfer to a landlord
// company is rent.

const out = (description: string) =>
  categorizeByRules({ description, amountCents: 165_000, hints: {} })?.detailed;

describe("a bank transfer to a landlord", () => {
  it.each([
    "ONLINE TRANSFER TO OAKWOOD RESIDENTIAL REF #IB0X4K2P9",
    "ONLINE TRANSFER TO PARKSIDE LEASING OFFICE",
    "TRANSFER TO BAYVIEW APARTMENTS",
    "XFER TO SUMMIT PROPERTIES LLC",
  ])("is rent: %s", (description) => {
    expect(out(description)).toBe("RENT_AND_UTILITIES_RENT");
  });

  it.each(["ONLINE TRANSFER TO ALLY BANK SAVINGS", "TRANSFER TO CHECKING 4410", "ZELLE TO ALEX"])(
    "leaves other transfers as they were: %s",
    (description) => {
      expect(out(description)).not.toBe("RENT_AND_UTILITIES_RENT");
    },
  );
});
