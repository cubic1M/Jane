import { describe, expect, it } from "vitest";
import { investingTree, type InvestingTreeInput } from "@/lib/area-pages/investing";
import { demoInvestments } from "@/lib/investments/__fixtures__/demo";
import { holdingsReply } from "./replies";

// Debug 2, fourth desktop sweep (11-17, Plaid sandbox checking sending $500 a month to Fidelity):
// after saving "What's in your Fidelity account today?" as $1,560, the chat answered "How much
// have I invested?" with "Your Fidelity has $1,560.00. Your bank reports the balance but not
// what's in it.", and Investing's tree said the same, though no bank reported it: they typed it.

const typed = () => {
  const data = demoInvestments();
  const fidelity = {
    ...data.accounts[0],
    name: "Fidelity",
    balanceCents: 156_000,
    holdings: [],
    institution: "Your upload",
  };
  return { ...data, accounts: [fidelity] };
};

describe("a brokerage balance the person typed", () => {
  it("is theirs in the chat, not the bank's", () => {
    expect(holdingsReply(typed(), null).body).toBe(
      "Your Fidelity has $1,560.00, the figure you gave me. I don't know what's in it.",
    );
  });

  it("is theirs on Investing's tree", () => {
    const input: InvestingTreeInput = {
      suggestions: [],
      accounts: [{ id: "f1", name: "Fidelity", balanceCents: 156_000, holdings: 0, told: true }],
      totalCents: 156_000,
      byType: 0,
      cryptoCents: 0,
      profile: { complete: false, label: null },
      returns: { periods: 0 },
      months: false,
      practice: null,
    };
    expect(investingTree(input).summaries["owned:f1"]).toBe(
      "The figure you gave. Jane doesn't know what's in it.",
    );
  });

  it("stays the bank's when a bank reports it", () => {
    const data = typed();
    const linked = { ...data, accounts: [{ ...data.accounts[0], institution: "Fidelity" }] };
    expect(holdingsReply(linked, null).body).toBe(
      "Your Fidelity has $1,560.00. Your bank reports the balance but not what's in it.",
    );
  });
});
