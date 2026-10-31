import { describe, expect, it } from "vitest";
import {
  CARD,
  CHECKING,
  GEICO,
  NETFLIX,
  input,
  monthsAgo,
  tx,
} from "@/detection/__fixtures__/build";
import { forecastAccounts, upcomingBills } from "@/detection/forecast";
import type { DetectionInput } from "@/detection/types";
import { safeToSpend } from "./safe-to-spend";

// AS_OF is Oct 15. Pay on the 1st; Geico from checking on the 20th; Netflix on the card.
const pay = [3, 2, 1, 0].map((m) =>
  tx({
    date: monthsAgo(m, 1),
    amountCents: -300_000,
    description: "ACME PAYROLL",
    merchantName: "Acme",
    pfcPrimary: "INCOME",
    pfcDetailed: "INCOME_SALARY",
  }),
);
const geico = [3, 2, 1].map((m) => tx({ ...GEICO, date: monthsAgo(m, 20), amountCents: 9_800 }));
const netflix = [3, 2, 1].map((m) =>
  tx({ ...NETFLIX, accountId: CARD.id, date: monthsAgo(m, 18), amountCents: 1_549 }),
);
const data = (transactions = [...pay, ...geico, ...netflix]): DetectionInput =>
  input({ accounts: [{ ...CHECKING, currentBalanceCents: 150_000 }, CARD], transactions });

describe("safeToSpend", () => {
  it("takes checking bills before payday, budgets left and goal amounts from the balance", () => {
    const safe = safeToSpend(data(), { budgetsLeftCents: 20_000, goalsCents: 10_000 });
    expect(safe.payday).toBe("2026-11-01");
    expect(safe.bills.map((b) => [b.merchant, b.date])).toEqual([["Geico", "2026-10-20"]]);
    expect(safe).toMatchObject({
      balanceCents: 150_000,
      billsCents: 9_800,
      budgetsLeftCents: 20_000,
      goalsCents: 10_000,
      setAsideCents: 0,
      safeCents: 150_000 - 9_800 - 20_000 - 10_000,
    });
  });

  it("takes this month's set-aside for yearly bills off as its own line (spec step 70)", () => {
    const safe = safeToSpend(data(), {
      budgetsLeftCents: 20_000,
      goalsCents: 10_000,
      setAsideCents: 2_800,
    });
    expect(safe).toMatchObject({
      setAsideCents: 2_800,
      safeCents: 150_000 - 9_800 - 20_000 - 10_000 - 2_800,
    });
  });

  it("reconciles with the bills forecast", () => {
    const d = data();
    const safe = safeToSpend(d, { budgetsLeftCents: 0, goalsCents: 0 });
    const forecast = upcomingBills(d, 31).filter(
      (b) => b.accountId === CHECKING.id && b.date < (safe.payday ?? "9999"),
    );
    expect(safe.billsCents).toBe(forecast.reduce((sum, b) => sum + b.amountCents, 0));
  });

  it("leaves card bills out: they come off the card, not checking", () => {
    const safe = safeToSpend(data(), { budgetsLeftCents: 0, goalsCents: 0 });
    expect(safe.bills.some((b) => b.merchant === "Netflix")).toBe(false);
  });

  it("says when no deposit is expected, covering the window instead of guessing", () => {
    const safe = safeToSpend(data([...geico, ...netflix]), { budgetsLeftCents: 0, goalsCents: 0 });
    expect(safe.payday).toBeNull();
    // The whole 31-day window (to Nov 15), so only October's bill.
    expect(safe.bills.map((b) => b.date)).toEqual(["2026-10-20"]);
  });

  it("counts a bill due today that hasn't come out yet", () => {
    const today = [3, 2, 1].map((m) =>
      tx({ ...GEICO, date: monthsAgo(m, 15), amountCents: 9_800 }),
    );
    const safe = safeToSpend(data([...pay, ...today, ...netflix]), {
      budgetsLeftCents: 0,
      goalsCents: 0,
    });
    expect(safe.bills.map((b) => [b.merchant, b.date])).toEqual([["Geico", "2026-10-15"]]);
    expect(safe.safeCents).toBe(150_000 - 9_800);
  });

  it("can come out negative", () => {
    expect(
      safeToSpend(data(), { budgetsLeftCents: 200_000, goalsCents: 0 }).safeCents,
    ).toBeLessThan(0);
  });

  // Debugger 10-30: rent paid by Zelle to a person is a transfer until the person says it's
  // rent. The forecast took it out of checking ("lowest about $4,809.21") while safe to spend
  // left it in ($6,209 when $1,400 rent was due before payday).
  const zelle = [3, 2, 1].map((m) =>
    tx({
      date: monthsAgo(m, 25),
      amountCents: 140_000,
      description: "Zelle payment to Marcus Webb",
      merchantName: null,
      pfcPrimary: "TRANSFER_OUT",
      pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER",
    }),
  );

  it("holds back a regular transfer out before payday, as the forecast does", () => {
    const d = data([...pay, ...geico, ...netflix, ...zelle]);
    const safe = safeToSpend(d, { budgetsLeftCents: 0, goalsCents: 0 });
    expect(safe.bills.map((b) => [b.date, b.amountCents, b.transfer ?? false])).toEqual([
      ["2026-10-20", 9_800, false],
      ["2026-10-25", 140_000, true],
    ]);
    expect(safe.safeCents).toBe(150_000 - 9_800 - 140_000);
    // The same money out as the forecast before payday (it adds no income before then).
    const [checking] = forecastAccounts(d, 31);
    const dayBefore = checking.days.find((x) => x.date === "2026-10-31")!;
    expect(safe.safeCents).toBe(dayBefore.balanceCents);
  });
});
