import { describe, expect, it } from "vitest";
import { debtBook, type DebtAccountInput } from "@/insights/debts";
import { debtDetailReply } from "./debt-replies";

// Debugger 11-17 (r335, a Chase card uploaded on a phone with its balance skipped): "how much do I
// owe on my chase card?" answered "Your Chase card: I don't know what's left on it or its rate
// yet. A card has no end date: when it's paid off depends on what you pay each month." with "See
// every debt": the second line answers something not asked, and nothing said where to give it.
// The import page asks an uploaded card's balance.

const AS_OF = "2026-11-17";
const card = (currentBalanceCents: number | null): DebtAccountInput => ({
  id: "chase",
  name: "Chase card",
  mask: null,
  type: "credit",
  subtype: "credit card",
  currentBalanceCents,
  liability: null,
});
const ask = (balance: number | null) =>
  debtDetailReply(
    "chase card",
    debtBook({ accounts: [card(balance)], plans: [], typed: [] }, AS_OF),
  );

describe("what's owed on a card the file doesn't give", () => {
  it("says where to add it", () => {
    const reply = ask(null);
    expect(reply.body.split("\n")).toEqual([
      "Your Chase card: I don't know what's left on it or its rate yet.",
      "Add what you owe on the import page and I'll count it.",
    ]);
    expect(reply.actions).toEqual([
      { id: "open", label: "Add what you owe", kind: "link", href: "/import" },
    ]);
  });

  it("still says a card has no end date once it's known", () => {
    const reply = ask(124_000);
    expect(reply.body).toContain("A card has no end date");
    expect(reply.actions.map((a) => a.label)).toEqual(["See every debt"]);
  });
});
