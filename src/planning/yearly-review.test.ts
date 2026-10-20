import { describe, expect, it } from "vitest";
import { buildReview, reviewIntro, type ReviewInput } from "./yearly-review";

// Spec step 216: one review, every item with where it stands.

const BASE: ReviewInput = {
  year: 2026,
  reason: "yearly",
  limits: [
    { label: "401(k) at work", usedCents: 1_632_000, limitCents: 2_450_000, roomCents: 818_000 },
    { label: "IRAs", usedCents: 750_000, limitCents: 750_000, roomCents: 0 },
  ],
  match: { missedCents: 81_600, tapAvailable: true },
  iraTap: null,
  oldPlans: [{ employer: "Globex Industries", savedCents: 41_638 }],
  rebalance: { orders: 3, summary: "Sell $1,000 of bonds." },
  harvest: { count: 2, lossCents: 54_000 },
  fees: { yearlyCents: 90_000, savingCents: 40_000 },
  goals: [{ name: "House", percent: 62, monthlyCents: 85_000, monthsLeft: 14 }],
  did: ["Invested $250.00 of new cash"],
  asked: ["Rebalanced $5,000.00 to your target mix"],
};

describe("buildReview", () => {
  it("lists every item with its status, and gives each tap its own action", () => {
    const items = buildReview(BASE);
    expect(items.map((i) => [i.key, i.status, i.action ?? null])).toEqual([
      ["did", "done", null],
      ["asked", "tap", null],
      ["contributions", "info", null],
      ["match", "tap", "retire.match"],
      ["rollover", "tap", "oldplan.rollover"],
      ["rebalance", "tap", "invest.rebalance"],
      ["harvest", "tap", "review.harvest"],
      ["fees", "info", null],
      ["goals", "info", null],
    ]);
    expect(items[0].line).toBe("What I did within your caps: Invested $250.00 of new cash.");
    expect(items[1].line).toBe(
      "Over your caps, so waiting for you: Rebalanced $5,000.00 to your target mix.",
    );
    expect(items.find((i) => i.key === "match")!.line).toMatch(
      /\$816\.00 a year of employer match/,
    );
    expect(items.find((i) => i.key === "goals")!.line).toBe(
      "Your goals: House 62% there, $850.00 a month for 14 months finishes it.",
    );
  });

  it("says what is fine as fine: nothing to do is not a tap", () => {
    const items = buildReview({
      ...BASE,
      match: { missedCents: 0, tapAvailable: true },
      oldPlans: [],
      rebalance: null,
      harvest: null,
      fees: null,
      goals: [],
      did: [],
      asked: [],
      limits: [{ label: "IRAs", usedCents: 750_000, limitCents: 750_000, roomCents: 0 }],
    });
    expect(items.map((i) => [i.key, i.status])).toEqual([
      ["contributions", "ok"],
      ["match", "ok"],
      ["rebalance", "ok"],
    ]);
  });

  it("offers the IRA tap when there is room and an IRA, and the intro names a raise", () => {
    const items = buildReview({ ...BASE, iraTap: { cents: 550_000 } });
    expect(items.find((i) => i.key === "contributions")).toMatchObject({
      status: "tap",
      action: "retire.ira",
    });
    expect(reviewIntro({ year: 2026, reason: "yearly" })).toBe(
      "Your 2026 investing review, all in one place:",
    );
    expect(reviewIntro({ year: 2026, reason: "raise" })).toMatch(/Congratulations on the raise/);
  });
});
