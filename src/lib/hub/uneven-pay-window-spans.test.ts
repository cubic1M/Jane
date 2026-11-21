import { describe, expect, it } from "vitest";
import { AS_OF, CHECKING, input, tx } from "@/detection/__fixtures__/build";
import { addDays } from "@/detection/units";
import { buildProfile, rateMonthsOf, type ProfileInput } from "@/profile/build";
import { inputFor, SAMPLE_TODAY } from "@/profile/sample";
import { incomeReply } from "@/lib/jane-agent/replies-income";
import { safeToSpend } from "@/planning/safe-to-spend";
import { heroView } from "./view";

// The window each says is the one it read (manager, 11-21): with less history than the window, the
// real span, never "3 months" or "12 months" the data doesn't cover. And pay on a schedule sees no
// change. From the data, not from a given number of months: Home through safeToSpend, the chat as
// the chat's income answer builds its facts (src/lib/jane-agent/capabilities/money.ts).

// Payouts on no schedule into checking, from `days` days before AS_OF, the account's first row.
const payouts = (days: number) => {
  const gaps = [3, 11, 9, 17, 6, 13, 21, 8, 15, 10, 19, 12];
  const dates: string[] = [];
  for (
    let day = addDays(AS_OF, -days), i = 0;
    day <= AS_OF;
    day = addDays(day, gaps[i % gaps.length]!), i += 1
  )
    dates.push(day);
  return input({
    accounts: [{ ...CHECKING, currentBalanceCents: 250_000 }],
    transactions: dates.map((date, i) =>
      tx({
        date,
        amountCents: -(90_000 + i * 7_311),
        description: "UPWORK ESCROW PAYOUT",
        merchantName: "Upwork",
        pfcPrimary: "INCOME",
        pfcDetailed: "INCOME_OTHER_INCOME",
      }),
    ),
  });
};
const homeLine = (days: number) => {
  const safe = safeToSpend(payouts(days), { budgetsLeftCents: 0, goalsCents: 0 });
  return heroView({
    asOf: AS_OF,
    safe,
    netWorth: null,
    foundCents: 0,
    savedCents: 0,
  }).safe?.why.find((l) => l.label.startsWith("Not counted: your pay"))?.label;
};

describe("Home's month of pay on no schedule says the span it read", () => {
  it("a short history: the last month", () => {
    expect(homeLine(24)).toMatch(/about this a month over the last month$/);
  });
  it("a mid history: the last 2 months", () => {
    expect(homeLine(62)).toMatch(/about this a month over the last 2 months$/);
  });
  it("a full one: the last 3 months, however long the history", () => {
    expect(homeLine(95)).toMatch(/about this a month over the last 3 months$/);
    expect(homeLine(300)).toMatch(/about this a month over the last 3 months$/);
  });
});

// The freelancer's year, cut to the last `days` days.
const freelancer = (days: number): ProfileInput => {
  const full = inputFor("freelancer");
  const since = addDays(SAMPLE_TODAY, -days);
  return { ...full, transactions: full.transactions.filter((t) => t.date > since) };
};
const chatMonth = (data: ProfileInput) => {
  const profile = buildProfile(data);
  const fact = profile.facts.monthly_income;
  return incomeReply("month", {
    monthCents: typeof fact.value === "number" ? fact.value : null,
    told: false,
    schedules: profile.paySchedules ?? [],
    months: Math.max(1, Math.round(rateMonthsOf(profile))),
    yearGrossCents: 0,
    taxYear: 2026,
    statementsEnd: null,
  }).body;
};

describe("the chat's month of pay on no schedule says the span it read", () => {
  it("a short history: an estimate from the month there is", () => {
    const body = chatMonth(freelancer(32));
    expect(body).toMatch(/It's from 1 month of data, so it's an estimate\.$/);
    expect(body).not.toMatch(/average over/);
  });
  it("a mid history: the 5 months there are", () => {
    expect(chatMonth(freelancer(155))).toMatch(/That's an average over the last 5 months\.$/);
  });
  it("a full year: 12 months", () => {
    expect(chatMonth(inputFor("freelancer"))).toMatch(
      /That's an average over the last 12 months\.$/,
    );
  });
});

describe("pay on a schedule", () => {
  it("sees no change: no window on Home, none in the chat", () => {
    const renter = inputFor("renter");
    expect(buildProfile(renter).paySchedules?.length).toBeGreaterThan(0);
    expect(chatMonth(renter)).not.toMatch(/average over|over the last/);
    const biweekly = input({
      accounts: [{ ...CHECKING, currentBalanceCents: 250_000 }],
      transactions: Array.from({ length: 8 }, (_, i) =>
        tx({
          date: addDays("2026-10-09", -14 * i),
          amountCents: -150_000,
          description: "ACME CORP PAYROLL",
          merchantName: "Acme",
          pfcPrimary: "INCOME",
          pfcDetailed: "INCOME_SALARY",
        }),
      ),
    });
    const safe = safeToSpend(biweekly, { budgetsLeftCents: 0, goalsCents: 0 });
    expect(safe.payday).not.toBeNull();
    expect(safe.unevenPayMonthlyCents).toBeNull();
    const why = heroView({ asOf: AS_OF, safe, netWorth: null, foundCents: 0, savedCents: 0 }).safe
      ?.why;
    expect(why?.some((l) => /over the last/.test(l.label))).toBe(false);
  });
});
