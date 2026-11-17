import { describe, expect, it } from "vitest";
import { input, tx } from "@/detection/__fixtures__/build";
import { irregularCosts } from "./irregular";

// Debug 2, third desktop sweep (11-16, upload S6: 14 months of Wells Fargo checking with two
// overdrafts six months apart): Budgets' "Set aside for yearly bills" read "Overdraft Fee: twice a
// year, $70.00 a year. Next about Jan 31, 2027", and the dock offered a "Yearly bills" goal of
// $72.00. A fee that comes from something going wrong is one to stop, not to save for.

const fee = (date: string, detailed: string, description: string) =>
  tx({
    date,
    amountCents: 3_500,
    description,
    merchantName: null,
    pfcPrimary: "BANK_FEES",
    pfcDetailed: detailed,
  });

describe("bills to set aside for", () => {
  it("leave out overdrafts and late fees, however regular", () => {
    const costs = irregularCosts(
      input({
        asOf: "2026-11-16",
        transactions: [
          fee("2026-02-02", "BANK_FEES_OVERDRAFT_FEES", "OVERDRAFT FEE FOR A $9.12 ITEM"),
          fee("2026-07-31", "BANK_FEES_OVERDRAFT_FEES", "OVERDRAFT FEE FOR A $14.50 ITEM"),
          fee("2025-11-20", "BANK_FEES_LATE_FEES", "LATE FEE"),
          fee("2026-11-02", "BANK_FEES_LATE_FEES", "LATE FEE"),
        ],
      }),
    );
    expect(costs.items.map((i) => i.name)).toEqual([]);
    expect(costs.monthlyCents).toBe(0);
  });

  it("keep a card's yearly fee", () => {
    const costs = irregularCosts(
      input({
        asOf: "2026-11-16",
        transactions: [fee("2025-12-01", "BANK_FEES_OTHER_BANK_FEES", "ANNUAL MEMBERSHIP FEE")].map(
          (t) => ({ ...t, amountCents: 9_500 }),
        ),
      }),
    );
    expect(costs.items.map((i) => i.name)).toEqual(["Annual Membership Fee"]);
  });
});
