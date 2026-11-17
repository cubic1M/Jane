import { describe, expect, it } from "vitest";
import type { Equivalent, FeeSummary } from "@/insights/investment-fees";
import { switchSummary } from "./fees-copy";
import { feesReply } from "./replies";

// Debugger 11-16 (r320, a Chase checking upload and a Fidelity positions file, chat on a phone):
// "what do my funds cost me in fees?" → "Over 30 years that's roughly $1,626.09 to $3,719.68 with
// growth, depending on returns." A rough 30-year range is said in whole dollars.

const fund = (name: string, bps: number, cents: number) => ({
  holding: { name } as FeeSummary["funds"][number]["holding"],
  accountName: "Fidelity Individual …5678",
  expenseRatioBps: bps,
  yearlyCents: cents,
  overYears: { lowCents: 0, highCents: 0 },
});
const summary: FeeSummary = {
  funds: [fund("Fidelity Contrafund", 74, 1_888), fund("Fidelity 500 Index", 1, 32)],
  unknown: [],
  fundsYearlyCents: 1_920,
  advisoryCents: 0,
  accountFeesCents: 0,
  totalYearlyCents: 1_920,
  overYears: { lowCents: 162_609, highCents: 371_968 },
  equivalents: [],
  years: 30,
};

describe("a fee range over the years", () => {
  it("is whole dollars in the chat", () => {
    expect(feesReply(summary, false).body.split("\n")[0]).toBe(
      "Your investments cost about $19.20 a year in fund costs. Over 30 years that's roughly $1,626 to $3,720 with growth, depending on returns.",
    );
  });

  it("is whole dollars in what switching could save", () => {
    const equivalent = {
      holding: { name: "Fidelity Contrafund" },
      accountName: "Fidelity Individual …5678",
      name: "Fidelity 500 Index",
      category: "S&P 500 index fund",
      expenseRatioBps: 1,
      yearlySavingCents: 1_862,
      overYears: { lowCents: 157_701, highCents: 360_744 },
      inPlanMenu: false,
    } as unknown as Equivalent;
    expect(switchSummary([equivalent], 30)).toContain("roughly $1,577 to $3,607 over 30 years");
  });
});
