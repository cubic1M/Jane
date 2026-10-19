import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

// Spec step 185: requests that need several actions, read as one plan.

const ASOF = "2026-10-19";

describe("requests that span sectors", () => {
  it("reads two actions as one plan, in order", () => {
    expect(
      parseIntent("Switch my car insurance and put the savings in my emergency fund.", ASOF),
    ).toEqual({
      kind: "multi",
      parts: [
        { kind: "insurance", ask: "quotes", policyKind: "auto" },
        { kind: "move_to_goal", amountCents: "savings", goal: "emergency fund" },
      ],
    });
  });

  it("carries the verb to a name on its own", () => {
    expect(parseIntent("cancel netflix and hulu", ASOF)).toEqual({
      kind: "multi",
      parts: [
        { kind: "act", verb: "cancel", target: "netflix" },
        { kind: "act", verb: "cancel", target: "hulu" },
      ],
    });
    expect(parseIntent("cancel Hulu, then move $50 to my vacation goal", ASOF)).toMatchObject({
      kind: "multi",
      parts: [
        { kind: "act", target: "hulu" },
        { kind: "move_to_goal", amountCents: 5_000, goal: "vacation" },
      ],
    });
  });

  it("reads money into a goal on its own", () => {
    expect(parseIntent("put $200 into my emergency fund", ASOF)).toEqual({
      kind: "move_to_goal",
      amountCents: 20_000,
      goal: "emergency fund",
    });
  });

  it("leaves a question with 'and' in it alone", () => {
    expect(parseIntent("what's due this week and next", ASOF).kind).not.toBe("multi");
    expect(parseIntent("cancel Hulu and tell me what's due", ASOF).kind).not.toBe("multi");
    expect(parseIntent("cancel Hulu", ASOF).kind).toBe("act");
  });
});
