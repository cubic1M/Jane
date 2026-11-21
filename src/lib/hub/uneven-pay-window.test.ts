import { describe, expect, it } from "vitest";
import { incomeReply } from "@/lib/jane-agent/replies-income";
import { heroView, type HeroInput } from "./view";

// Two figures for one thing, neither saying its window (debug 2's #2211, scoped out): for the
// freelancer Home said "Not counted: your pay, which has no set schedule yet, about this a month
// $8,461.89", the last 3 months' deposits, while the chat said "You take home about $5,868.06 a
// month", the year's. Both are true of their windows; each now says which it is.

const safe = (unevenPayMonths: number): HeroInput => ({
  asOf: "2026-11-21",
  safe: {
    payday: null,
    balanceCents: 300_000,
    billsCents: 120_000,
    budgetsLeftCents: 0,
    goalsCents: 0,
    setAsideCents: 0,
    safeCents: 180_000,
    unevenPayMonthlyCents: 846_189,
    unevenPayMonths,
  },
  netWorth: null,
  foundCents: 0,
  savedCents: 0,
});
const label = (months: number) => heroView(safe(months)).safe?.why.at(-1)?.label;

describe("uneven pay's month says its window", () => {
  it("on Home: the last 3 months, or the history when it's shorter", () => {
    expect(label(3)).toBe(
      "Not counted: your pay, which has no set schedule yet, about this a month over the last 3 months",
    );
    expect(label(2.2)).toMatch(/about this a month over the last 2 months$/);
    // 24 days of lines: a month's pay, not a third of three months'.
    expect(label(1)).toMatch(/about this a month over the last month$/);
  });

  it("in the chat: the year's average, when there's no pay schedule to give", () => {
    const facts = {
      monthCents: 586_806,
      told: false,
      schedules: [],
      months: 12,
      yearGrossCents: 0,
      taxYear: 2026,
      statementsEnd: null,
    };
    expect(incomeReply("month", facts).body).toBe(
      "You take home about $5,868.06 a month: what comes in regularly. That's an average over the last 12 months.",
    );
  });

  it("in the chat: says nothing more when the month is a pay schedule's", () => {
    const body = incomeReply("month", {
      monthCents: 325_000,
      told: false,
      schedules: [
        {
          employer: "Acme",
          frequency: "BIWEEKLY",
          paycheckCents: 150_000,
          monthCents: 325_000,
          extraCents: 0,
        },
      ],
      months: 12,
      yearGrossCents: 0,
      taxYear: 2026,
      statementsEnd: null,
    }).body;
    expect(body).not.toContain("average over");
  });
});
