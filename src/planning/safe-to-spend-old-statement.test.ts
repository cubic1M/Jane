import { describe, expect, it } from "vitest";
import { CHECKING, input, tx } from "@/detection/__fixtures__/build";
import { expectedIncome, forecastAccounts, unevenPay } from "@/detection/forecast";
import type { DetectionInput } from "@/detection/types";
import { safeToSpend } from "./safe-to-spend";

// A statement that ended a month ago still has its pay on a schedule (debug 2, desktop sweep 11, upload
// S7, 11-20): $1,500 on the 1st and the 15th through Oct 15, a statement to Oct 20, read on Nov 20.
// Whether the employer still pays was judged from today, 36 days after the last paycheck, so the
// schedule read as stopped: Home said "Not counted: your pay, which has no set schedule yet, about
// this a month $2,000", safe to spend had no payday, and the chat "I don't see a regular paycheck yet",
// while the same balance walked forward counted Nov 1's and Nov 15's pay.

const PAY = 150_000;
const RENT = 98_000;
const stanford = (date: string) =>
  tx({
    date,
    amountCents: -PAY,
    description: "STANFORD UNIV DES:PAYROLL ID:X",
    merchantName: "Stanford University",
    pfcPrimary: "INCOME",
    pfcDetailed: "INCOME_SALARY",
  });
const PAYDAYS = ["06-01", "06-15", "07-01", "07-15", "08-01", "08-15", "09-01", "09-15"];
const rent = ["2026-07-03", "2026-08-03", "2026-09-03", "2026-10-03"].map((date) =>
  tx({ date, amountCents: RENT, description: "ESSEX PROPERTY DES:RENT", merchantName: "Essex" }),
);

const BALANCE = 1_059_707;
const statement = (asOf: string, paydays: string[]): DetectionInput =>
  input({
    asOf,
    accounts: [{ ...CHECKING, currentBalanceCents: BALANCE, balanceAsOf: "2026-10-20" }],
    transactions: [...paydays.map((d) => stanford(`2026-${d}`)), ...rent],
  });
const safe = (data: DetectionInput) => safeToSpend(data, { budgetsLeftCents: 0, goalsCents: 0 });

describe("a statement that ended a month ago", () => {
  const data = statement("2026-11-20", [...PAYDAYS, "10-01", "10-15"]);

  it("still expects the pay on its schedule after today", () => {
    expect(expectedIncome(data, "2026-12-20").map((p) => p.date)).toEqual([
      "2026-12-01",
      "2026-12-15",
    ]);
    expect(safe(data)).toMatchObject({ payday: "2026-12-01", payDue: [], payMissed: [] });
    expect(unevenPay(data, CHECKING.id)).toBeNull();
  });

  it("counts the paydays between the statement and today once, in the walk", () => {
    const [account] = forecastAccounts(data, 30);
    expect(account!.todayCents).toBe(BALANCE + 2 * PAY - RENT);
    expect(account!.income.map((p) => p.date)).toEqual(["2026-12-01", "2026-12-15"]);
  });

  it("pay that stopped before the statement ended still reads as stopped", () => {
    const stopped = statement("2026-11-20", PAYDAYS);
    expect(expectedIncome(stopped, "2026-12-20")).toEqual([]);
    expect(safe(stopped)).toMatchObject({ payday: null });
  });
});
