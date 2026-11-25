import { afterEach, describe, expect, it } from "vitest";
import { PLAID_TRIAL_ITEM_LIMIT, plaidItemLimit, plaidItemWarnAt } from "./plaid-items";

// CodeRabbit sweep 1c, cfg-03 #1: a limit from the environment is a safe whole number or the
// fallback, never Infinity.

afterEach(() => {
  delete process.env.PLAID_TRIAL_ITEM_LIMIT;
});

describe("plaidItemLimit", () => {
  it("falls back for a number too long to be safe", () => {
    process.env.PLAID_TRIAL_ITEM_LIMIT = "9".repeat(309);
    expect(plaidItemLimit()).toBe(PLAID_TRIAL_ITEM_LIMIT);
    process.env.PLAID_TRIAL_ITEM_LIMIT = "9007199254740993";
    expect(plaidItemLimit()).toBe(PLAID_TRIAL_ITEM_LIMIT);
    expect(Number.isFinite(plaidItemWarnAt(plaidItemLimit()))).toBe(true);
  });

  it("keeps valid limits, zero included", () => {
    process.env.PLAID_TRIAL_ITEM_LIMIT = "25";
    expect(plaidItemLimit()).toBe(25);
    process.env.PLAID_TRIAL_ITEM_LIMIT = "0";
    expect(plaidItemLimit()).toBe(0);
    process.env.PLAID_TRIAL_ITEM_LIMIT = "abc";
    expect(plaidItemLimit()).toBe(PLAID_TRIAL_ITEM_LIMIT);
  });
});
