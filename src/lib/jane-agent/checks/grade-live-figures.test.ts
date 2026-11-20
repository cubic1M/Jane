import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import type { CheckQuestion } from "./bank";
import type { Facts } from "./facts";
import { fixedChecks, type Answer } from "./grade";

// Walk batch 3 (11-20): seven right Claude answers read "the guardrails would refuse it", their
// figures from explain_figure ($1,343.33 a month), calculate ($16,119.96 a year) or a search's
// total, which Jane's own check had allowed on that turn. A Claude answer is now graded by the
// figures its turn was held to, and a made-up figure of the same shape is still refused.

const facts: Facts = {
  asOf: "2026-11-20",
  safeCents: null,
  payday: null,
  // One paycheck: what the no-input lookups give for upload S5.
  allowedCents: [62_000],
  recurring: [],
  months: {},
  findings: [],
};
const question: CheckQuestion = {
  id: "q",
  text: "How much do I make a year?",
  needs: "claude",
  expect: {},
};
const claude = (body: string, allowedCents?: number[]): Answer => ({
  body,
  actions: [],
  source: "claude",
  ...(allowedCents ? { allowedCents } : {}),
});
const guardrails = (answer: Answer) =>
  fixedChecks(question, answer, facts).find((c) => c.name === "guardrails");
const SAID = "You make about $16,119.96 a year: $620.00 every two weeks, $1,343.33 a month.";
// What the turn was held to: the paycheck, explain_figure's month and calculate's year.
const LIVE = [62_000, 134_333, 1_611_996];

describe("grading a Claude answer by the figures its turn was given", () => {
  it("passes figures from the turn's tools", () => {
    expect(guardrails(claude(SAID, LIVE))?.ok).toBe(true);
  });

  it("refuses them with only the grader's own lookups, as before", () => {
    expect(guardrails(claude(SAID))?.reason).toMatch(/would refuse it: unsupported_dollar_figure/);
  });

  it("still refuses a made-up figure of the same shape", () => {
    const madeUp = SAID.replace("$16,119.96", "$16,219.96");
    expect(guardrails(claude(madeUp, LIVE))?.ok).toBe(false);
  });
});
