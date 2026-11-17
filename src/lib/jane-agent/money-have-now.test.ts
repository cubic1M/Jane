import { describe, expect, it } from "vitest";
import { netWorth } from "@/insights/net-worth";
import { parseIntent } from "./intents";
import { netWorthReply } from "./replies-networth";

// Debugger 11-17 (r326, an old Capital One 360 statement ending Sep 28, chat on a phone): "how
// much money do I have right now?" answered "I can't answer that one yet", and so did "what's my
// balance". They're what you have, as net worth says it; and from statements that end weeks ago,
// the figure says when it's from.

const TODAY = "2026-11-17";

describe("how much money do I have", () => {
  it("is asked for", () => {
    for (const text of [
      "how much money do I have right now?",
      "how much money do i have",
      "what's my balance",
      "what is my bank balance",
      "how much is in my checking",
    ]) {
      expect(parseIntent(text, TODAY)).toEqual({ kind: "net_worth" });
    }
    // Still the ones they were.
    expect(parseIntent("how much money do i have left", TODAY).kind).toBe("safe_to_spend");
    expect(parseIntent("how much is netflix", TODAY).kind).toBe("cost");
  });

  it("says when the figure is from, when the statements are old", () => {
    const worth = netWorth([
      { id: "a1", name: "Capital One 360", type: "depository", balanceCents: 195_016 },
    ]);
    expect(netWorthReply(worth, [], { statementsEnd: "2026-09-28" }).body).toBe(
      "Your net worth is $1,950.16: you have $1,950.16, and I don't see any debts. That's from your statements, which end on Sep 28: upload newer ones for today's.",
    );
    expect(netWorthReply(worth, []).body).not.toContain("statements");
  });
});
