import { describe, expect, it } from "vitest";
import { mattersBlock } from "./primer-matters";
import type { Snapshot } from "./snapshot";

// The primer's "what matters most": the scan's suggestions first, then the ranked list, and the
// open findings, all with figures the guardrails will allow.

const snap = (over: Partial<Snapshot> = {}) =>
  ({
    asOf: "2026-10-19",
    safeToSpend: null,
    comingUp: [],
    waitingOnYou: [],
    findings: [
      {
        findingId: "f1",
        type: "subscription_review",
        title: "Review your Hulu subscription",
        annualSavingsCents: 21_588,
        savings: "Could save about $215.88 a year",
        fingerprint: "fp",
        urgent: false,
        pick: null,
        confidence: "high",
      },
    ],
    plan: { items: 0, annualSavingsCents: 0, safeItems: 0 },
    ruleApprovals: [],
    finished: [],
    deadlines: [],
    budgetsOver: [],
    goalsBehind: [],
    urgentAlerts: [],
    budgetProgress: [],
    autopilot: "safe",
    setupProposals: [],
    agentSteps: [],
    assetPrompts: [],
    ...over,
  }) as unknown as Snapshot;

describe("what matters most, for the primer", () => {
  it("is empty without a snapshot", () => {
    expect(mattersBlock(null)).toEqual({ text: "", cents: [] });
  });

  it("lists the top three and the open findings, with their figures as allowed cents", () => {
    const block = mattersBlock(snap());
    expect(block.text).toMatch(/^what_matters_most: \[/m);
    expect(block.text).toContain("Review your Hulu subscription");
    expect(block.text).toMatch(/open_findings_summary: .*"count":1/);
    expect(block.text).toContain("$215.88 a year");
    expect(block.cents).toContain(21_588);
  });

  it("puts the scan's suggestions first, with how sure Jane is", () => {
    const block = mattersBlock(
      snap({
        suggestions: [
          {
            id: "x",
            key: "cost:bank_fees",
            topic: "bank_fees",
            title: "Stop paying overdraft and bank fees",
            headline: "Stop paying overdraft and bank fees, save $105 a year",
            short: "You paid $105.00.",
            why: "You paid $105.00.",
            worthCents: 10_500,
            worthKind: "saves",
            confidencePercent: 82,
            confidenceReason: "3 bank fees in 12 months of data",
            actionLabel: "See the fees",
            actionHref: "/insights",
            more: [],
            advice: false,
          },
        ],
      }),
    );
    const first = block.text.split("\n")[0];
    expect(first.indexOf("Stop paying overdraft")).toBeLessThan(first.indexOf("Hulu"));
    expect(first).toContain("82% sure, based on 3 bank fees in 12 months of data");
    expect(block.cents).toEqual(expect.arrayContaining([10_500]));
  });
});
