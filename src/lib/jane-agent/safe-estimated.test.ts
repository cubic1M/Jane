import { describe, expect, it } from "vitest";
import { safeReply } from "./replies";

// The chat's safe to spend, from checking walked forward from a statement (debug 3, 11-19): the
// two-uploads person heard "That's your whole checking balance" of $10,714.84, where the statement
// said $8,450.00, with nothing saying it's an estimate. Home says it (#2142); the chat does too.

const safe = {
  safeCents: 1_071_484,
  payday: "2026-11-15",
  billsCents: 0,
  budgetsLeftCents: 0,
  goalsCents: 0,
  setAsideCents: 0,
};

describe("safe to spend from a walked balance", () => {
  it("says checking is estimated, with what was added since the statement", () => {
    const { body } = safeReply(
      { ...safe, sinceStatement: { day: "2026-10-31", cents: 226_484 } },
      "2026-11-12",
    );
    expect(body).toContain(
      "Checking is estimated: +$2,265 of pay and bills expected since your Oct 31 statement.",
    );
  });

  it("says nothing of it when the balance is as the bank shows it", () => {
    expect(safeReply({ ...safe, sinceStatement: null }, "2026-11-12").body).not.toContain(
      "estimated",
    );
  });
});
