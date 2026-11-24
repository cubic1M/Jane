import { describe, expect, it } from "vitest";
import {
  CARD,
  CHECKING,
  GEICO,
  SAVINGS,
  input,
  monthsAgo,
  tx,
} from "@/detection/__fixtures__/build";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { readRetirementTaxes } from "./retirement-taxes-read";
import { addMonths } from "./short-term";
import { lastsToAge } from "./retirement-income";
import { safeToSpend } from "./safe-to-spend";
import { stateEstimated } from "./state-estimated";

// CodeRabbit sweep, part 1 (money figures), src/planning chunk 7: each case is a finding
// reproduced against the code first (failing), then fixed.

describe("safe to spend: the next payday is into an account it counts", () => {
  const payInto = (accountId: string, day: number, name: string) =>
    [3, 2, 1, 0].map((m) =>
      tx({
        accountId,
        date: monthsAgo(m, day),
        amountCents: -300_000,
        description: name,
        merchantName: name,
        pfcPrimary: "INCOME",
        pfcDetailed: "INCOME_SALARY",
      }),
    );
  it("does not stop at an excluded account's earlier payday", () => {
    // Checking is paid on the 1st; a savings account (not counted) is paid on the 20th, the day
    // Geico comes out of checking.
    const geico = [3, 2, 1].map((m) =>
      tx({ ...GEICO, date: monthsAgo(m, 20), amountCents: 9_800 }),
    );
    const data = input({
      accounts: [{ ...CHECKING, currentBalanceCents: 150_000 }, SAVINGS, CARD],
      transactions: [
        ...payInto(CHECKING.id, 1, "ACME PAYROLL"),
        ...payInto(SAVINGS.id, 20, "SIDE GIG PAYROLL"),
        ...geico,
      ],
    });
    const safe = safeToSpend(data, { budgetsLeftCents: 0, goalsCents: 0 });
    expect(safe.payday).toBe("2026-11-01");
    expect(safe.bills.map((b) => b.merchant)).toEqual(["Geico"]);
  });
});

describe("short-term plans: a month later", () => {
  it("clamps to the end of a short month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2026-10-15", 2)).toBe("2026-12-15");
  });
});

describe("state estimated payments", () => {
  it("never go negative or past the year's amount, and add up to it", () => {
    const out = stateEstimated("NY", 2, 2026);
    if (!("payments" in out)) throw new Error("expected payments");
    expect(out.payments.every((p) => p.cents >= 0)).toBe(true);
    expect(out.payments.reduce((s, p) => s + p.cents, 0)).toBe(2);
  });
});

describe("how long the money lasts for someone already past their retirement age", () => {
  const base = {
    age: 70,
    retireAge: 65,
    balances: { taxableCents: 10_000_000, preTaxCents: 0, rothCents: 0 },
    yearlySavingCents: 0,
    spendMonthlyCents: 500_000,
    ssMonthlyCents: 0,
    ssStartAge: 67,
    taxRate: 0,
  };
  it("starts the draw at today's age, not at an age already gone", () => {
    // $100,000 at $60,000 a year with no growth: gone in 1.67 years from age 70, not from 65.
    expect(lastsToAge(base, 0)).toBeCloseTo(71.67, 1);
  });
});

describe("retirement taxes: an IRA draw filed as a pension", () => {
  it("is counted once, as the draw, not also as a pension", () => {
    const d = inputFor("retiree");
    const draw = {
      date: "2026-09-10",
      amountCents: -1_200_000,
      description: "IRA DISTRIBUTION",
      pfc: "INCOME_RETIREMENT_PENSION",
      accountId: d.accounts[0]!.id,
    };
    const withDraw = { ...d, transactions: [...d.transactions, draw] };
    const before = readRetirementTaxes(buildProfile(d), d);
    const after = readRetirementTaxes(buildProfile(withDraw), withDraw);
    expect(after.pensionCents).toBe(before.pensionCents);
    expect(after.iraDrawCents).toBeGreaterThan(before.iraDrawCents);
  });
});
