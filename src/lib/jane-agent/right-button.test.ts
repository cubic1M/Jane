import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import type { DecisionCard } from "@/lib/cards";
import type { Comparison } from "@/planning/compare";
import { nextStep } from "./actions/finding";
import { optionsReply, whyReply } from "./explain-replies";
import { budgetButton, budgetSuggestion } from "./replies";
import type { MessageAction } from "./types";

// Spec step 90: the right button, every time. "Why?" and "Show options" answer from the
// card's own wording (no Claude needed), "Set a budget" comes prefilled, and after a Yes
// Jane says what happens next and when.

const card: DecisionCard = {
  findingId: "f1",
  findingType: "price_increase",
  actionType: "fight_price_increase",
  title: "Netflix went up from $15.49 to $17.99",
  explanation: "Netflix raised your price by $2.50 a month in September",
  whatChanges: "I ask Netflix to keep your old price",
  annualSavingsCents: 3_000,
  giveUp: "Nothing",
  alternatives: ["Switch to the plan with ads", "Cancel it yourself"],
  evidence: [
    { date: "2026-08-14", label: "Netflix", amountCents: 1_549 },
    { date: "2026-09-14", label: "Netflix", amountCents: 1_799 },
  ],
  referralPartner: null,
  referralDisclosure: null,
};
const actions: MessageAction[] = [
  { id: "finding.yes", label: "Yes", kind: "primary" },
  { id: "finding.no", label: "No", kind: "secondary" },
  { id: "finding.why", label: "Why?", kind: "quick" },
  { id: "open", label: "Open", kind: "link", href: "/report/f1" },
];

describe("whyReply", () => {
  it("gives the reason, the evidence and what changes, with the decision buttons", () => {
    const reply = whyReply(card, actions);
    expect(reply.body).toBe(
      [
        "Netflix raised your price by $2.50 a month in September.",
        "- Aug 14: Netflix, $15.49",
        "- Sep 14: Netflix, $17.99",
        "If you say yes: I ask Netflix to keep your old price. You'd give up: Nothing.",
      ].join("\n"),
    );
    expect(reply.actions.map((a) => a.id)).toEqual(["finding.yes", "finding.no", "open"]);
  });
});

describe("optionsReply", () => {
  it("lists the other ways when nothing was compared", () => {
    expect(optionsReply(card, null, actions).body).toBe(
      "Besides saying yes, you could:\n- Switch to the plan with ads.\n- Cancel it yourself.",
    );
  });

  it("compares Jane's pick and the runners-up with what they pay now", () => {
    const option = (provider: string, name: string) =>
      ({ provider, name }) as Comparison["pick"]["option"];
    const comparison = {
      current: { kind: "bill" },
      currentYearCents: 174_000,
      pick: {
        option: option("Pine", "Unlimited"),
        firstYearCents: 42_000,
        savingCents: 132_000,
        notes: [],
      },
      runnersUp: [
        {
          option: option("Mint", "Unlimited"),
          firstYearCents: 36_000,
          savingCents: 138_000,
          notes: ["12-month prepay"],
        },
      ],
      why: "It has the coverage you use, for less",
    } as unknown as Comparison;
    expect(optionsReply(card, comparison, actions).body.split("\n")).toEqual([
      "My pick is Pine Unlimited. It has the coverage you use, for less.",
      "You pay about $1,740.00 a year now.",
      "- Pine Unlimited: $420.00 in the first year, saving about $1,320.00",
      "- Mint Unlimited: $360.00 in the first year, saving about $1,380.00 (12-month prepay)",
    ]);
  });
});

describe("Set a budget", () => {
  it("comes prefilled with a usual month, rounded up to whole dollars", () => {
    const { budget } = budgetSuggestion("Food and drink", 43_450);
    expect(budget).toEqual({ category: "Food and drink", amountCents: 43_500 });
    expect(budgetButton(budget)).toEqual({
      id: "budget.set",
      label: "Set a $435.00 budget",
      kind: "primary",
    });
  });
});

describe("nextStep", () => {
  it("says what happens next and when, for each kind of action", () => {
    expect(nextStep("cancel_subscription")).toBe(
      "Got it. I'll write to them today to cancel, and tell you here when they confirm. If they don't answer, I follow up after 3 days.",
    );
    expect(nextStep("request_refund")).toMatch(/^Got it\. I'll ask for the money back today/);
    expect(nextStep("negotiate_bill")).toMatch(/before saying yes to it\.$/);
    expect(nextStep("insurance_reshop")).toBe(
      "Got it. Our team starts on it within 1 business day, and I'll tell you here what's next.",
    );
  });
});
