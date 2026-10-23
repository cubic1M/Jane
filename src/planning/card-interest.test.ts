import { describe, expect, it } from "vitest";
import { RATE_ASK_CUT_BPS } from "@/config/card-interest";
import { nextStatementClose } from "./credit-building";
import {
  daysBetween,
  interestCents,
  payEarlySaving,
  promoPlan,
  rateAsk,
  rateStep,
} from "./card-interest";

describe("interest and paying earlier", () => {
  it("charges the daily share of the yearly rate", () => {
    // $2,410.50 at 22.99% for a year, and for 30 days.
    expect(interestCents(241_050, 2_299, 365)).toBe(55_417);
    expect(interestCents(241_050, 2_299, 30)).toBe(4_555);
    expect(interestCents(0, 2_299, 30)).toBe(0);
  });

  it("saves the interest between today and the due date, capped at a month's worth of early days", () => {
    const s = payEarlySaving({
      amountCents: 100_000,
      aprBps: 2_299,
      asOf: "2026-10-18",
      dueOn: "2026-10-28",
    });
    expect(s).toEqual({ days: 10, savedCents: 630 });
    // Never more than 30 days, never negative.
    expect(
      payEarlySaving({
        amountCents: 100_000,
        aprBps: 2_299,
        asOf: "2026-10-18",
        dueOn: "2027-03-01",
      }).days,
    ).toBe(30);
    expect(
      payEarlySaving({
        amountCents: 100_000,
        aprBps: 2_299,
        asOf: "2026-10-18",
        dueOn: "2026-10-10",
      }),
    ).toEqual({
      days: 0,
      savedCents: 0,
    });
  });

  it("knows when the statement closes: a month at a time from the last one", () => {
    expect(nextStatementClose("2026-10-01", "2026-10-18")).toBe("2026-11-01");
    expect(daysBetween("2026-10-18", "2026-11-01")).toBe(14);
  });
});

describe("a 0% promotion's pace", () => {
  const base = {
    startedOn: "2026-06-01",
    endsOn: "2027-02-01",
    goToAprBps: 2_699,
    asOf: "2026-10-18",
  };

  it("is on pace when what's paid a month clears the balance by the end", () => {
    const plan = promoPlan({
      ...base,
      balanceCents: 150_000,
      deferred: true,
      monthlyPaidCents: 85_000,
    });
    expect(plan.monthsLeft).toBe(3);
    expect(plan.monthlyNeededCents).toBe(50_000);
    expect(plan.onPace).toBe(true);
    expect(plan.shortCents).toBe(0);
    expect(plan.costIfMissedCents).toBe(0);
  });

  it("is off pace when it falls short, and a deferred promo says what missing the end costs", () => {
    const plan = promoPlan({
      ...base,
      balanceCents: 500_000,
      deferred: true,
      monthlyPaidCents: 85_000,
    });
    expect(plan.monthlyNeededCents).toBe(166_667);
    expect(plan.onPace).toBe(false);
    expect(plan.shortCents).toBe(81_667);
    // Left unpaid at the end: 5,000 - 3 x 850 = 2,450; interest from the start (245 days) at 26.99%.
    expect(plan.costIfMissedCents).toBe(interestCents(245_000, 2_699, 245));
    expect(plan.costIfMissedCents).toBeGreaterThan(40_000);
  });

  it("charges only a year of the rate after the end when interest isn't deferred", () => {
    const plan = promoPlan({
      ...base,
      balanceCents: 500_000,
      deferred: false,
      monthlyPaidCents: 85_000,
    });
    expect(plan.costIfMissedCents).toBe(interestCents(245_000, 2_699, 365));
  });

  it("is over once the end passes", () => {
    const plan = promoPlan({
      ...base,
      asOf: "2027-02-05",
      balanceCents: 100_000,
      deferred: true,
      monthlyPaidCents: 0,
    });
    expect(plan.ended).toBe(true);
    expect(plan.monthlyNeededCents).toBe(100_000);
  });
});

describe("the request for a lower rate", () => {
  it("cuts the rate by the configured points and counts the yearly saving on the balance", () => {
    const ask = rateAsk({
      cardName: "Demo Credit Card ····0003",
      aprBps: 2_299,
      balanceCents: 241_050,
      onTimeMonths: null,
    });
    expect(ask.newAprBps).toBe(2_299 - RATE_ASK_CUT_BPS);
    expect(ask.savingYearlyCents).toBe(interestCents(241_050, RATE_ASK_CUT_BPS, 365));
    expect(ask.savingYearlyCents).toBe(7_232);
    expect(ask.body).toContain("22.99%");
    expect(ask.script).toContain("Call the number on the back");
    expect(ask.script).toContain("$72.32 a year");
  });
});

// docs/feature-audit.md, cluster 14: the yearly debt review and the monthly check-up read the
// same lower-rate step, so the page never shows "Ask X" next to "Asked Y this month".
describe("the lower-rate step", () => {
  const card = (name: string, sent: boolean) => ({
    name,
    rate: {
      id: `rate-${name}`,
      savingYearlyCents: 9_000,
      sent: sent ? { sentOn: "2026-10-20" } : null,
    },
  });
  const view = (cards: ReturnType<typeof card>[], requests: string[][] = []) => ({
    available: true,
    cards,
    requests: requests.map(([cardName, sentOn]) => ({ cardName, sentOn })),
  });

  it("says the request sent this month first, before the next card to ask", () => {
    const ci = view([card("Visa", true), card("Amex", false)], [["Visa", "2026-10-20"]]);
    expect(rateStep(ci, "2026-10-27")).toEqual({ kind: "asked", cards: ["Visa"] });
  });

  it("offers the next card once the last request is over a month old", () => {
    const ci = view([card("Visa", true), card("Amex", false)], [["Visa", "2026-09-01"]]);
    expect(rateStep(ci, "2026-10-27")).toEqual({
      kind: "next",
      name: "Amex",
      requestId: "rate-Amex",
      savingYearlyCents: 9_000,
    });
  });

  it("has nothing to say when no card is worth asking, or rate requests aren't available", () => {
    expect(rateStep(view([card("Visa", true)], [["Visa", "2026-08-01"]]), "2026-10-27")).toBeNull();
    expect(rateStep({ ...view([card("Amex", false)]), available: false }, "2026-10-27")).toBeNull();
  });
});
