import { describe, expect, it } from "vitest";
import { buildReview, type ReviewInput } from "./yearly-review";

// CodeRabbit sweep 1c, pl-09 #9: "Your mix is on target." only when a plan was computed.

const base: ReviewInput = {
  year: 2026,
  reason: "yearly",
  limits: [],
  match: null,
  iraTap: null,
  oldPlans: [],
  rebalance: null,
  harvest: null,
  fees: null,
  goals: [],
  did: [],
  asked: [],
};

describe("rebalance line", () => {
  it("is left out when no plan was computed", () => {
    expect(buildReview(base).some((i) => i.key === "rebalance")).toBe(false);
  });

  it("says on target for a computed plan with no orders", () => {
    const items = buildReview({ ...base, rebalance: { orders: 0, summary: "" } });
    expect(items.find((i) => i.key === "rebalance")).toMatchObject({
      status: "ok",
      line: "Your mix is on target.",
    });
  });
});
