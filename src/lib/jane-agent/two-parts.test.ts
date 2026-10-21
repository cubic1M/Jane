import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { topicLine } from "./claude";
import { joinReplies, splitQuestions } from "./two-parts";

// Spec step 193: conversations that flow: two questions in one message get both answers, and
// Claude is told what the last answer was about.

const ASOF = "2026-10-19";

describe("two questions in one message", () => {
  it("splits when each part is its own kind of question", () => {
    expect(
      splitQuestions("how much can I spend and when is payday", ASOF)?.map((i) => i.kind),
    ).toEqual(["safe_to_spend", "payday"]);
    expect(
      splitQuestions("what's my net worth, and how much debt do I have", ASOF)?.map((i) => i.kind),
    ).toEqual(["net_worth", "debts"]);
  });

  it("leaves one question, actions and unknown halves alone", () => {
    expect(splitQuestions("what's due this week and next", ASOF)).toBeNull();
    expect(splitQuestions("cancel Hulu and Netflix", ASOF)).toBeNull();
    expect(splitQuestions("what's due this week and blah blah", ASOF)).toBeNull();
    expect(splitQuestions("safe to spend", ASOF)).toBeNull();
  });

  it("puts the answers together, first answer first, buttons once", () => {
    const link = { id: "open" as const, label: "See today", kind: "link" as const, href: "/home" };
    const joined = joinReplies([
      { body: "You have $10.00.", actions: [link], refs: { topic: { kind: "safe_to_spend" } } },
      { body: "Payday is Nov 1.", actions: [link], refs: {} },
    ]);
    expect(joined.body).toBe("You have $10.00.\n\nPayday is Nov 1.");
    expect(joined.actions).toHaveLength(1);
    expect(joined.refs.topic).toEqual({ kind: "safe_to_spend" });
  });
});

describe("what the last answer was about, for Claude", () => {
  it("names the subject and says what 'it' means", () => {
    expect(topicLine({ kind: "act", verb: "cancel", target: "Netflix" })).toBe(
      'Your last answer was about Netflix (they were asking to cancel it). "It", "that one" and "the other one" mean that or what you just said.',
    );
    expect(topicLine({ kind: "spending", category: "Food", month: "2026-09" })).toMatch(
      /about Food, 2026-09\./,
    );
  });
});
