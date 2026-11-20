import { describe, expect, it } from "vitest";
import { input, monthly } from "./__fixtures__/build";
import { recurringCharges } from "./subscriptions";

// Walk batch 3's upload S1 (phone, 11-20): "how much is my electric bill?" got "Xcel Energy is
// $57.49 a month, $689.88 a year" over bills of $46.60, $38.72 and $57.49: the chat was handed
// the last bill as the monthly one. A bill that moves with use now carries its range and usual
// amount; the yearly cost the pages show is unchanged.
describe("a recurring bill whose amount moves with use", () => {
  const xcel = monthly(3, [4_660, 3_872, 5_749], {
    description: "XCEL ENERGY",
    merchantName: "Xcel Energy",
    pfcPrimary: "RENT_AND_UTILITIES",
    pfcDetailed: "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
  });

  it("says its lowest, highest and usual amount", () => {
    const row = recurringCharges(input({ transactions: xcel })).find((r) =>
      r.merchant.includes("Xcel"),
    );
    expect(row?.varies).toEqual({ lowCents: 3_872, highCents: 5_749, usualCents: 4_760 });
    // What the pages show is the same as before: the last bill, at its frequency.
    expect(row?.lastAmountCents).toBe(5_749);
    expect(row?.annualCostCents).toBe(5_749 * 12);
  });

  it("leaves a fixed bill, and a subscription whose price went up, as one amount", () => {
    const rows = recurringCharges(
      input({
        transactions: [
          ...monthly(3, 4_500, {
            description: "T-MOBILE",
            merchantName: "T-Mobile",
            pfcPrimary: "RENT_AND_UTILITIES",
            pfcDetailed: "RENT_AND_UTILITIES_TELEPHONE",
          }),
          ...monthly(3, [999, 999, 1_199], {
            description: "HULU 877-8244858 CA",
            merchantName: "Hulu",
            pfcPrimary: "ENTERTAINMENT",
            pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
          }),
        ],
      }),
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) expect(row.varies, row.merchant).toBeUndefined();
  });
});
