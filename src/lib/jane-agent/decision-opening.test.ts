import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { decisionReply, type DecisionFacts } from "./decision";
import type { DecisionIntent } from "./decision-intents";
import { parseIntent } from "./intents";

// The chat's real-account round (11-12) read every rules reply a real account gets: a should-I
// answer says back what was asked after "before", and some of what follows "should I" doesn't
// read there: "before of my company's stock", "before consolidate my student loans".
const facts: DecisionFacts = {
  cardDebtCents: 241_050,
  topRateBps: 2300,
  cashCents: 100_000,
  monthlySpendCents: 400_000,
  cushionTargetCents: 1_200_000,
  cushionMonths: 0.3,
  goalsBehind: [{ name: "Emergency fund", leftCents: 500_000 }],
};
const opening = (text: string, advice: boolean) => {
  const intent = parseIntent(text, "2026-11-12");
  expect(intent.kind, text).toBe("decision");
  return decisionReply(intent as DecisionIntent, null, facts, advice).body.split(/(?<=\.)\s/)[0];
};

describe("a should-I answer's opening", () => {
  it.each([
    ["should I buy more of my company's stock", "my company's stock"],
    ["should i consolidate my student loans", "consolidating my student loans"],
    ["should i buy bitcoin", "bitcoin"],
    ["should i do roth or traditional", "roth or traditional"],
  ])("says %j back as %j", (text, said) => {
    expect(opening(text, false)).toBe(
      `Here is where you stand on the things that matter before ${said}.`,
    );
    expect(opening(text, true)).toBe(`Before ${said}, here is where you stand.`);
  });
});
