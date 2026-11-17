import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";
import { comingUpReply } from "./replies";

// Debugger 11-17 (r321, Plaid sandbox checking + a Discover card, chat on a phone): "what bills are
// due before payday?" answered "6 things are coming up, $1,501.47 in all." with rent on Dec 1 first,
// all of them after the Nov 27 payday. Before payday means before payday.

const rows = [
  { date: "2026-11-24", daysLeft: 7, label: "Verizon", amountCents: 4_000 },
  { date: "2026-12-01", daysLeft: 14, label: "Rent", amountCents: 98_500 },
  { date: "2026-12-08", daysLeft: 21, label: "Netflix", amountCents: 1_549 },
] as Parameters<typeof comingUpReply>[1];

describe("bills due before payday, in the chat", () => {
  it("is asked for", () => {
    for (const text of [
      "what bills are due before payday?",
      "what's due before my next paycheck",
      "what bills are coming up until payday",
    ]) {
      expect(parseIntent(text, "2026-11-17")).toMatchObject({
        kind: "coming_up",
        beforePayday: true,
      });
    }
    expect(parseIntent("what bills are coming up?", "2026-11-17")).not.toHaveProperty(
      "beforePayday",
    );
  });

  it("lists only what's due before the payday", () => {
    const intent = parseIntent("what bills are due before payday?", "2026-11-17");
    if (intent.kind !== "coming_up") throw new Error(intent.kind);
    const body = comingUpReply(intent, rows, { payday: "2026-11-27" }).body;
    expect(body.split("\n")[0]).toBe("1 thing is due before payday (Nov 27), $40.00 in all.");
    expect(body).not.toContain("Rent");
  });

  it("says so when nothing is", () => {
    const intent = parseIntent("what bills are due before payday?", "2026-11-17");
    if (intent.kind !== "coming_up") throw new Error(intent.kind);
    expect(comingUpReply(intent, rows.slice(1), { payday: "2026-11-27" }).body).toBe(
      "Nothing is due before payday (Nov 27) that I can see.",
    );
  });
});
