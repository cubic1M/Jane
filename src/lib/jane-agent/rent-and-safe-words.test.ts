import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";
import { safeReply } from "./replies";

// Debugger 11-16 (a Plaid checking account, phone): "what do I pay for rent?" listed every regular
// charge with a Netflix pitch, not the rent, and safe to spend until the Nov 27 payday said "I don't
// see any bills coming up", though rent, the phone and two subscriptions come right after payday.

const intent = (text: string) => parseIntent(text, "2026-11-16");

describe("what do I pay for …", () => {
  it("names one thing: that thing", () => {
    expect(intent("what do I pay for rent?")).toEqual({
      kind: "cost",
      target: "rent",
      year: false,
    });
  });

  it("names nothing: everything charged on a schedule", () => {
    for (const text of ["what am I paying for?", "what do I pay for each month"]) {
      expect(intent(text), text).toEqual({ kind: "subscriptions", total: false, all: true });
    }
  });
});

describe("safe to spend with nothing taken off, until payday", () => {
  it("says no bills are due before payday, not that there are none", () => {
    const body = safeReply(
      {
        safeCents: 124_000,
        payday: "2026-11-27",
        billsCents: 0,
        budgetsLeftCents: 0,
        goalsCents: 0,
        setAsideCents: 0,
      },
      "2026-11-16",
    ).body;
    expect(body).not.toContain("I don't see any bills coming up");
    expect(body).toContain("no bills are due before then");
  });
});
