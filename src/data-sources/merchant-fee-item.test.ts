import { describe, expect, it } from "vitest";
import { normalizeMerchant } from "./merchant";

// Debug 2 (11-16, statements uploaded on desktop): an overdraft read "Overdraft Fee For A 14 50
// Item", and every amount was a merchant of its own. A fee for one item is the fee.

describe("a bank's fee for one item", () => {
  it("is the fee, whatever the item's amount", () => {
    expect(normalizeMerchant("OVERDRAFT FEE FOR A $14.50 ITEM")).toEqual({
      name: "Overdraft Fee",
      key: "overdraft fee",
    });
    expect(normalizeMerchant("OVERDRAFT FEE FOR A $6.20 ITEM")?.key).toBe("overdraft fee");
    expect(normalizeMerchant("NSF FEE FOR A $40.00 ITEM")?.name).toBe("Nsf Fee");
    expect(normalizeMerchant("RETURNED ITEM FEE FOR A $125.00 ITEM")?.name).toBe(
      "Returned Item Fee",
    );
  });

  it('leaves other lines with "for" alone', () => {
    expect(normalizeMerchant("OVERDRAFT FEE")?.name).toBe("Overdraft Fee");
    expect(normalizeMerchant("PAYMENT FOR A $25.00 ITEM")?.name).toBe("Payment For A 25 00 Item");
  });
});
