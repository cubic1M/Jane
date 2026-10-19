import { describe, expect, it } from "vitest";
import { demoInvestments } from "@/lib/investments/__fixtures__/demo";
import { portfolioNote } from "./portfolio-note";
import { reviewPortfolio } from "./portfolio-review";

// Spec step 137: the monthly note. Facts about the past; never a prediction.

const PREDICTION =
  /\b(?:will|expect\w*|forecast\w*|predict\w*|outlook|likely|should rise|should fall)\b/i;
const review = reviewPortfolio(demoInvestments().accounts, 3);
const base = {
  month: "2026-11",
  totalCents: 9_673_055,
  previousCents: 9_500_000,
  contributedCents: 48_960,
  feesYearlyCents: 100_000,
  review,
  ordersReady: 9,
};

describe("portfolioNote", () => {
  it("says where things stand, what changed, what went in and what it costs", () => {
    const { body, decision } = portfolioNote(base);
    expect(body).toBe(
      "Your investments start November at $96,730.55. That's up $1,730.55 from a month ago, counting what went in. $489.60 went in last month. Fees run about $1,000.00 a year. Your mix has drifted from your moderate target: 69% US stocks against 40%. I've got the orders ready to bring it back.",
    );
    expect(decision).toBe("rebalance");
  });

  it("asks at most one thing, and nothing when on target or without orders", () => {
    expect(portfolioNote({ ...base, review: { ...review, offTarget: false } })).toMatchObject({
      decision: null,
      body: expect.stringContaining("Your mix is on your moderate target."),
    });
    expect(portfolioNote({ ...base, ordersReady: 0 }).decision).toBeNull();
    expect(portfolioNote({ ...base, review: null }).body).not.toMatch(/mix/);
  });

  it("leaves out what it doesn't know, and says a fall plainly", () => {
    expect(
      portfolioNote({
        ...base,
        previousCents: null,
        contributedCents: 0,
        feesYearlyCents: 0,
        review: null,
      }).body,
    ).toBe("Your investments start November at $96,730.55.");
    expect(portfolioNote({ ...base, previousCents: 10_000_000 }).body).toMatch(
      /down \$3,269\.45 from a month ago/,
    );
  });

  it("never predicts", () => {
    for (const variant of [
      base,
      { ...base, previousCents: 10_000_000 },
      { ...base, review: null },
    ]) {
      expect(portfolioNote(variant).body).not.toMatch(PREDICTION);
    }
  });
});
