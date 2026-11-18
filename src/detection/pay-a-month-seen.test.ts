import { describe, expect, it } from "vitest";
import { heroView } from "@/lib/hub/view";
import { CHECKING, input, tx } from "./__fixtures__/build";
import { unevenPay } from "./forecast";

// Debugger 11-18 (r342, Plaid S5: a checking account opened a month ago, $1,100 from Target every
// two weeks, twice so far): Home's safe to spend said "Not counted: your pay comes at uneven times,
// about this a month $733". Two paychecks are too few for a schedule, but they came in one month:
// that's $2,200 in the month, not a third of it, and two weeks apart isn't uneven.

const pay = (date: string) =>
  tx({
    date,
    amountCents: -110_000,
    description: "TARGET STORES PAYROLL",
    merchantName: null,
    pfcPrimary: "INCOME",
    pfcDetailed: "INCOME_WAGES",
  });
const coffee = (date: string) =>
  tx({ date, amountCents: 1_300, description: "STARBUCKS", pfcPrimary: "FOOD_AND_DRINK" });

describe("pay seen for only a month", () => {
  // The account's first row a month before AS_OF (Oct 15), then two paychecks two weeks apart.
  const data = input({
    accounts: [{ ...CHECKING, currentBalanceCents: 86_000 }],
    transactions: [coffee("2026-09-15"), pay("2026-09-20"), pay("2026-10-04")],
  });

  it("is that month's pay, not a third of it", () => {
    expect(unevenPay(data, CHECKING.id)).toBe(220_000);
  });

  it("isn't said to come at uneven times", () => {
    const line = heroView({
      safe: {
        payday: null,
        balanceCents: 86_000,
        billsCents: 0,
        budgetsLeftCents: 0,
        goalsCents: 0,
        setAsideCents: 0,
        safeCents: 86_000,
        unevenPayMonthlyCents: 220_000,
      },
    } as Parameters<typeof heroView>[0]).safe?.why.find((l) =>
      l.label.startsWith("Not counted: your pay"),
    );
    expect(line?.label).not.toMatch(/uneven/);
  });
});
