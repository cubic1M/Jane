import { describe, expect, it } from "vitest";
import { AS_OF, CHECKING, SAVINGS, input, monthsAgo, tx } from "./__fixtures__/build";
import { forecastAccounts, nextUnevenPayBy, unevenPay } from "./forecast";
import { lowBalanceRisk } from "./rules/low-balance-risk";
import { buildStreams } from "./streams";
import { addDays } from "./units";
import { FORECAST_DAYS } from "@/config/detection";

// CodeRabbit sweep, open 46: a paycheck on the calendar into another account (savings) hid the
// uneven-pay cutoff of the account being looked at, and checking was said to go below zero on a day
// by which its next payout would have come.
//
// By hand, on Oct 15: checking holds $400.00 and rent of $1,200.00 leaves on the 28th. Payouts came
// into it on 12 days of the last 90, so the next is expected within ceil(90 / 12) = 8 days: by Oct
// 23. The days from Oct 23 on carry the rent and none of that pay, so nothing is said from them, and
// the lowest checking is known to reach is the $400.00 it holds.

const payouts = (
  [
    [2, 21_000],
    [7, 34_500],
    [16, 18_250],
    [21, 40_000],
    [30, 27_500],
    [33, 15_000],
    [42, 36_000],
    [50, 22_750],
    [57, 31_000],
    [66, 19_500],
    [71, 28_000],
    [83, 24_500],
  ] as const
).map(([back, cents]) =>
  tx({
    date: addDays(AS_OF, -back),
    amountCents: -cents,
    description: "STRIPE TRANSFER",
    merchantName: "Stripe",
    pfcPrimary: "INCOME",
    pfcDetailed: "INCOME_OTHER",
  }),
);
const rent = [3, 2, 1].map((m) =>
  tx({
    date: monthsAgo(m, 28),
    amountCents: 120_000,
    description: "MAPLE COURT RENT",
    merchantName: "Maple Court",
    pfcPrimary: "RENT_AND_UTILITIES",
    pfcDetailed: "RENT_AND_UTILITIES_RENT",
  }),
);
// Every two weeks, so the next is on the calendar.
const salary = (accountId: string) =>
  [6, 20, 34, 48, 62, 76].map((back) =>
    tx({
      accountId,
      date: addDays(AS_OF, -back),
      amountCents: -200_000,
      description: "HARBOR CO PAYROLL",
      merchantName: "Harbor Co",
      pfcPrimary: "INCOME",
      pfcDetailed: "INCOME_SALARY",
    }),
  );

const person = (salaryInto: string, checkingCents = 40_000) =>
  input({
    accounts: [{ ...CHECKING, currentBalanceCents: checkingCents }, SAVINGS],
    transactions: [...payouts, ...rent, ...salary(salaryInto)],
  });
const checkingOf = (data: ReturnType<typeof person>) =>
  forecastAccounts(data, FORECAST_DAYS).find((f) => f.accountId === CHECKING.id)!;

const warnings = (data: ReturnType<typeof person>) =>
  lowBalanceRisk(data, buildStreams(data))
    .filter((f) => f.key.includes(CHECKING.id))
    .map((f) => [f.title, f.amountCents, f.confidence]);

describe("uneven pay beside a paycheck into another account", () => {
  const data = person(SAVINGS.id);

  it("still has its cutoff: the day the next payout is likely by", () => {
    expect(nextUnevenPayBy(data, [CHECKING.id])).toBe("2026-10-23");
    expect(unevenPay(data, CHECKING.id)).not.toBeNull();
  });

  it("says nothing from the days past it: no overdraft on rent day", () => {
    const checking = checkingOf(data);
    expect(checking.lowest.balanceCents).toBe(40_000);
    expect(checking.lowest.date < "2026-10-23").toBe(true);
    // The series still shows rent leaving; it just isn't what's said.
    expect(checking.days.find((d) => d.date === "2026-10-28")!.balanceCents).toBe(-80_000);
    // Main said "could drop to -$800.00 around Oct 28".
    expect(warnings(data)).toEqual([]);
  });

  it("still warns of what is low before then, and says it counts no pay", () => {
    const low = person(SAVINGS.id, 5_000);
    expect(warnings(low)).toEqual([
      ["Everyday Checking could drop to $50.00 around Oct 15 if no pay comes in", 5_000, "low"],
    ]);
  });

  // The sweep's two-uploads person: checking's paychecks read as "uneven pay, $8,522.50 a month"
  // once the latest ones showed on another account.
  it("doesn't call a salary that moved to the other account uneven pay", () => {
    const [latest, previous, ...older] = salary(SAVINGS.id);
    const moved = input({
      accounts: [{ ...CHECKING, currentBalanceCents: 40_000 }, SAVINGS],
      transactions: [
        ...rent,
        latest!,
        previous!,
        ...older.map((t) => ({ ...t, accountId: CHECKING.id })),
      ],
    });
    expect(unevenPay(moved, CHECKING.id)).toBeNull();
    expect(nextUnevenPayBy(moved, [CHECKING.id])).toBeNull();
    expect(warnings(moved).map(([, cents]) => cents)).toEqual([-80_000]);
  });

  it("loses the cutoff to a payday into the account itself", () => {
    const paid = person(CHECKING.id);
    expect(nextUnevenPayBy(paid, [CHECKING.id])).toBeNull();
    expect(unevenPay(paid, CHECKING.id)).toBeNull();
  });

  it("loses it to a payday into any account asked about together", () => {
    expect(nextUnevenPayBy(data, [CHECKING.id, SAVINGS.id])).toBeNull();
    expect(unevenPay(data, CHECKING.id, [CHECKING.id, SAVINGS.id])).toBeNull();
  });
});
