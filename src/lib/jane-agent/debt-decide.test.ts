import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { decisionIdFor } from "./debt-decide";

// The loans sector's share of "should I ...?" (docs/decisions.md): which straight answer a
// question gets, read from what the router calls the thing.

describe("which loans decision a 'should I' question is", () => {
  it.each([
    ["payoff_or_invest", "paying off debt or investing", "pay_or_invest"],
    ["loan", "consolidate my debt", "consolidate"],
    ["loan", "take a personal loan to pay off my cards", "personal_loan"],
    ["loan", "use my savings to pay off my cards", "savings_or_debt"],
    ["loan", "close a credit card", "close_card"],
    ["loan", "take a payday loan", "payday_loan"],
    ["loan", "pay off my student loan early", "student_early"],
    ["loan", "use buy now pay later", "bnpl"],
  ])("%s / %s", (item, label, id) => {
    expect(decisionIdFor(item, label)).toBe(id);
  });

  it("declines what isn't one of them, so the router gives the general answer", () => {
    expect(decisionIdFor("loan", "get a haircut")).toBeNull();
  });
});
