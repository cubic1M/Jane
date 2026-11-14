import { describe, expect, it } from "vitest";
import { cashCushionOf, idleCashOf, type IdleTx } from "./idle-cash";

// Debugger 11-14: a student uploaded one Bank of America statement (Sep 29 to Oct 24) on Nov 14.
// Jane said "You keep $8,343.37 in cash and spend about $1,826.14 a month, so about $2,864.95 is
// more than 3 months of spending": 26 days of spending ($2,759.83, a $2,356.18 check among it)
// spread over the 46 days to today. Spending is averaged to where the account's data ends.

const tx = (date: string, cents: number, pfc: string | null, description: string): IdleTx => ({
  date,
  amountCents: cents,
  accountId: "chk",
  pfc,
  description,
});

const statement: IdleTx[] = [
  tx("2026-09-29", 525, "FOOD_AND_DRINK_COFFEE", "CHECKCARD 0928 DUTCH BROS #221 CHICAGO IL"),
  tx("2026-10-01", 235_618, null, "Check 1142"),
  tx("2026-10-01", 525, "FOOD_AND_DRINK_COFFEE", "CHECKCARD 0930 DUTCH BROS #221 CHICAGO IL"),
  tx("2026-10-02", -210_406, "INCOME_SALARY", "MASSIVE DYNAMIC DES:PAYROLL"),
  tx("2026-10-04", 20_713, "TRANSFER_OUT_SAVINGS", "Online Banking transfer to SAV 9161"),
  tx(
    "2026-10-05",
    6_694,
    "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS",
    "FID BKG SVC LLC MONEYLINE",
  ),
  tx("2026-10-06", 4_590, "FOOD_AND_DRINK_RESTAURANT", "CHECKCARD 1005 GRUBHUB*THAIHOUSE"),
  tx("2026-10-07", 11_892, "FOOD_AND_DRINK_GROCERIES", "CHECKCARD 1006 RALEYS #112"),
  tx("2026-10-08", 7_110, "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY", "EVERSOURCE DES:BILL PAY"),
  tx("2026-10-08", 130_441, "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", "CHASE CREDIT CRD EPAY DES:PMT"),
  tx("2026-10-09", 3_410, "TRANSPORTATION_TAXIS_AND_RIDE_SHARES", "CHECKCARD 1008 UBER *TRIP"),
  tx("2026-10-16", -233_774, "INCOME_SALARY", "MASSIVE DYNAMIC DES:PAYROLL"),
  tx("2026-10-17", 3_164, null, "CHECKCARD 1016 MARATHON PETRO44 CHICAGO IL"),
  tx("2026-10-18", 4_099, "FOOD_AND_DRINK_GROCERIES", "CHECKCARD 1017 RALEYS #112"),
  tx("2026-10-21", 1_250, "FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK", "CHECKCARD 1020 SUNRISE BAKERY"),
  tx("2026-10-24", 3_800, "FOOD_AND_DRINK_RESTAURANT", "CHECKCARD 1023 KINGS HEAD PUB"),
];
const input = (asOf: string) => ({
  asOf,
  accounts: [{ id: "chk", type: "depository", subtype: "checking", balanceCents: 834_337 }],
  transactions: statement,
});

describe("spending from a statement that ended weeks ago", () => {
  it("is a month of what the statement shows, not spread over the weeks since", () => {
    // $2,759.83 in 26 days: a month at the least, not 46 days ($1,826.14).
    expect(cashCushionOf(input("2026-11-14"))?.monthlyCents).toBe(275_983);
  });

  it("leaves no idle cash when three months of it is about what's there", () => {
    expect(idleCashOf(input("2026-11-14"))).toBeNull();
  });
});
