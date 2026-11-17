import { describe, expect, it } from "vitest";
import type { Investments } from "@/lib/investments/holdings";
import { parseIntent } from "../intents";
import { holdingsReply } from "./replies";

// Debugger 11-17 (r333, a Chase checking upload sending $200 a month to Fidelity, then a Fidelity
// positions file, chat on a phone): "how much have I put into fidelity?" answered "I can't answer
// that one yet" (also r320), "how much did I send to fidelity" answered with the whole month's
// spending, and "what's in my fidelity account?" had no answer. The first two are what went in, as
// the Investments page says it; the third is the holdings.

const TODAY = "2026-11-17";
const fidelity = {
  accounts: [
    {
      name: "Fidelity Individual …5678",
      label: "Brokerage",
      balanceCents: 763_478,
      institution: "Fidelity",
      holdings: [{ name: "Fidelity 500 Index", ticker: "FXAIX", valueCents: 324_328 }],
    },
  ],
} as unknown as Investments;
const sent = { asks: [], inLast3MonthsCents: 60_000 };

describe("what was put into investing", () => {
  it("is asked for", () => {
    for (const text of [
      "how much have I put into fidelity?",
      "how much did i send to fidelity",
      "how much have i put into investing",
    ]) {
      expect(parseIntent(text, TODAY)).toMatchObject({
        kind: "investments",
        topic: "holdings",
        sent: true,
      });
    }
    expect(parseIntent("what's in my fidelity account?", TODAY)).toMatchObject({
      kind: "investments",
      topic: "holdings",
    });
  });

  it("says what went in and what it's worth now", () => {
    expect(holdingsReply(fidelity, null, sent, { sent: true }).body).toBe(
      "You put $600.00 into investing in the last 3 months, from your bank. Your Fidelity Individual …5678 is worth $7,634.78 now.",
    );
  });

  it("says when nothing went in", () => {
    expect(
      holdingsReply(fidelity, null, { asks: [], inLast3MonthsCents: 0 }, { sent: true }).body,
    ).toBe(
      "I don't see money going from your bank to investing in the last 3 months. Your Fidelity Individual …5678 is worth $7,634.78 now.",
    );
  });
});
