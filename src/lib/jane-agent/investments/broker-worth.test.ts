import { describe, expect, it } from "vitest";
import { parseIntent } from "../intents";

// Debugger 11-19 (r360, upload S4 on a phone: Chase checking and a Fidelity positions download,
// $7,634.78): "how much is my fidelity account worth?" answered "I couldn't find spending on
// "fidelity account worth"", though "how much is my brokerage worth?" listed the holdings. A
// brokerage named by its company asks the same.

const ASOF = "2026-11-19";

describe("what an account at a named brokerage is worth", () => {
  it.each([
    "how much is my fidelity account worth?",
    "how much is my fidelity worth",
    "what's my fidelity account worth",
    "what is my robinhood worth?",
    "how much is in my fidelity account?",
    "how much do i have in vanguard?",
  ])("%s is about the holdings", (question) => {
    expect(parseIntent(question, ASOF)).toMatchObject({ kind: "investments", topic: "holdings" });
  });

  it("leaves what's been sent there to its own answer", () => {
    expect(parseIntent("how much do i put into fidelity?", ASOF)).toMatchObject({
      kind: "investments",
      sent: true,
    });
  });
});
