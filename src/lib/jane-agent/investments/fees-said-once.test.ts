import { describe, expect, it } from "vitest";
import type { FeeSummary } from "@/insights/investment-fees";
import { feesReply } from "./replies";

// Debug 2 re-walk (11-16, one Fidelity positions upload, the side chat at 1280 light): "what are
// my fund fees?" → "Your investments cost about $0.51 a year: $0.51 in fund costs. … The costliest:
// - Fidelity 500 Index: 0.01%, $0.51 a year": one figure three times. The split is said only when
// there's more than fund costs, and the list only with more than one fund.

const fund = (name: string, bps: number, cents: number) => ({
  holding: { name } as FeeSummary["funds"][number]["holding"],
  accountName: "Fidelity Individual …5678",
  expenseRatioBps: bps,
  yearlyCents: cents,
  overYears: { lowCents: 0, highCents: 0 },
});
const summary = (over: Partial<FeeSummary>): FeeSummary => ({
  funds: [fund("Fidelity 500 Index", 1, 51)],
  unknown: [],
  fundsYearlyCents: 51,
  advisoryCents: 0,
  accountFeesCents: 0,
  totalYearlyCents: 51,
  overYears: { lowCents: 4_762, highCents: 10_863 },
  equivalents: [],
  years: 30,
  ...over,
});

describe("what the fund fees come to, in the chat", () => {
  it("says one fund's cost once", () => {
    expect(feesReply(summary({}), false).body).toBe(
      "Your investments cost about $0.51 a year in fund costs. Over 30 years that's roughly $48 to $109 with growth, depending on returns.\nThat's Fidelity 500 Index, at 0.01% a year.",
    );
  });

  it("splits the total when there are other fees too", () => {
    const body = feesReply(
      summary({ advisoryCents: 12_000, totalYearlyCents: 12_051 }),
      false,
    ).body;
    expect(body.split("\n")[0]).toMatch(
      /^Your investments cost about \$120\.51 a year: \$0\.51 in fund costs, \$120\.00 in advisory fees\./,
    );
  });
});
