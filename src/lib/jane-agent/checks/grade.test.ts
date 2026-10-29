import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import type { CheckQuestion } from "./bank";
import type { Facts } from "./facts";
import { firstSentence, fixedChecks, fixedScore, reasonOf, type Answer } from "./grade";

// Spec step 87: the fixed checks on one of Jane's answers, each with its reason.

const facts: Facts = {
  asOf: "2026-10-18",
  safeCents: 277_612,
  payday: "2026-10-28",
  allowedCents: [277_612, 1_799],
  recurring: [{ merchant: "Netflix", lastCents: 1_799, yearCents: 21_588, subscription: true }],
  months: {},
  findings: [],
};
const q = (text: string, expect: CheckQuestion["expect"] = {}): CheckQuestion => ({
  id: "q",
  text,
  needs: "rules",
  expect,
});
const rules = (body: string, actions: Answer["actions"] = []): Answer => ({
  body,
  actions,
  source: "rules",
});
const failed = (checks: ReturnType<typeof fixedChecks>) =>
  checks.filter((c) => !c.ok).map((c) => c.name);

describe("fixedChecks", () => {
  it("passes a good answer, with a reason", () => {
    const checks = fixedChecks(
      q("safe to spend", { intent: "safe_to_spend", figures: (f) => [f.safeCents] }),
      rules("You have $2,776.12 safe to spend until Oct 28 (in 10 days)."),
      facts,
    );
    expect(failed(checks)).toEqual([]);
    expect(fixedScore(checks)).toBe(100);
    expect(reasonOf(checks)).toBe("Passed every check.");
  });

  it("fails the fallback, a misread, and a missing figure", () => {
    const checks = fixedChecks(
      q("tell me a joke", {
        intent: "safe_to_spend",
        figures: (f) => [f.safeCents],
      }),
      { body: "I didn't catch that.", actions: [], source: "fallback" },
      facts,
    );
    expect(failed(checks)).toEqual(["answered", "understood", "figures"]);
    expect(reasonOf(checks)).toContain("Missing $2,776.12.");
    expect(fixedScore(checks)).toBeLessThan(100);
  });

  it("fails an action button on an informational question, but not a link", () => {
    const ask = q("do i have any debts", { noButtons: true });
    const body = "You have one credit card with a balance, and nothing else to pay off.";
    const withYes = fixedChecks(
      ask,
      { body, actions: [{ id: "finding.yes", label: "Yes", kind: "primary" }], source: "claude" },
      facts,
    );
    expect(failed(withYes)).toEqual(["no_buttons"]);
    const withLink = fixedChecks(
      ask,
      {
        body,
        actions: [{ id: "open", label: "See debts", kind: "link", href: "/debt" }],
        source: "claude",
      },
      facts,
    );
    expect(failed(withLink)).toEqual([]);
  });

  it("counts a blocked answer as unanswered", () => {
    const checks = fixedChecks(
      q("x"),
      { body: "Sorry.", actions: [], source: "claude_blocked" },
      facts,
    );
    expect(checks.find((c) => c.name === "answered")).toMatchObject({
      ok: false,
      reason: "The guardrails blocked Jane's answer.",
    });
  });

  it("holds the shape: answer first, no filler, never only a button, lists only when they fit", () => {
    expect(failed(fixedChecks(q("x"), rules("Sure! You have $1.00."), facts))).toContain("shape");
    expect(failed(fixedChecks(q("x"), rules("If you spend $5.00:\nIt's fine."), facts))).toContain(
      "shape",
    );
    expect(failed(fixedChecks(q("x"), rules("Tap the button below."), facts))).toContain("shape");
    expect(failed(fixedChecks(q("x"), rules("Here:\n- one\n- two"), facts))).toContain("shape");
    expect(
      failed(fixedChecks(q("x", { list: true }), rules("Three things are due.\n- a\n- b"), facts)),
    ).toEqual([]);
  });

  it("wants a written answer: never a button, or a few words, on their own", () => {
    expect(failed(fixedChecks(q("x"), rules("Tap the button below."), facts))).toContain("written");
    expect(failed(fixedChecks(q("x"), rules("OK."), facts))).toContain("written");
    expect(failed(fixedChecks(q("x"), rules("Netflix is $17.99 a month."), facts))).not.toContain(
      "written",
    );
  });

  it("writes money Jane's way", () => {
    expect(failed(fixedChecks(q("x"), rules("Netflix is $17.99/mo."), facts))).toEqual(["tone"]);
    expect(failed(fixedChecks(q("x"), rules("Netflix is $17.99 per month."), facts))).toEqual([
      "tone",
    ]);
    expect(failed(fixedChecks(q("x"), rules("Netflix is $17.99 a month."), facts))).toEqual([]);
  });

  it("wants the right button, link, words and length", () => {
    const expectAll: CheckQuestion["expect"] = {
      button: "finding.yes",
      link: "/subscriptions",
      mentions: /netflix/i,
      avoid: /friend/i,
      maxChars: 20,
    };
    const checks = fixedChecks(
      q("x", expectAll),
      rules("Hulu could save you money, ask a friend."),
      facts,
    );
    expect(failed(checks)).toEqual(["button", "link", "mentions", "avoids", "length"]);
    const good = fixedChecks(
      q("x", { ...expectAll, maxChars: 100 }),
      rules("Netflix is $17.99 a month.", [
        { id: "finding.yes", label: "Yes", kind: "primary" },
        { id: "open", label: "Open", kind: "link", href: "/subscriptions" },
      ]),
      facts,
    );
    expect(failed(good)).toEqual([]);
  });

  it("holds Claude's answers to figures from the person's numbers or the question", () => {
    const claude = (body: string): Answer => ({ body, actions: [], source: "claude" });
    expect(failed(fixedChecks(q("x"), claude("Netflix is $17.99 a month."), facts))).toEqual([]);
    expect(failed(fixedChecks(q("x"), claude("Netflix is $19.99 a month."), facts))).toEqual([
      "guardrails",
    ]);
    expect(failed(fixedChecks(q("is $19.99 a lot?"), claude("$19.99 is a lot."), facts))).toEqual(
      [],
    );
    // An earlier answer isn't evidence (card-chat mismatch): only the lookups and the question.
    expect(failed(fixedChecks(q("x"), claude("It was $19.99 a month."), facts))).toEqual([
      "guardrails",
    ]);
    expect(failed(fixedChecks(q("x"), claude("Buy index funds."), facts))).toEqual(["guardrails"]);
  });
});

describe("firstSentence", () => {
  it("is the first line up to its full stop", () => {
    expect(firstSentence("Yes, you can. It leaves $5.00.")).toBe("Yes, you can.");
    expect(firstSentence("Here's what's due:\n- a")).toBe("Here's what's due:");
    expect(firstSentence("It's $17.99 a month")).toBe("It's $17.99 a month");
  });
});

describe("fixedChecks in demo advice mode (spec step 137)", () => {
  it("checks answers with the guardrails Jane uses for the person", () => {
    const answer: Answer = {
      body: "Your Demo 401(k) has $84,250.40 in 5 holdings.",
      actions: [],
      source: "rules",
    };
    const question = { id: "x", text: "what's in my 401k", needs: "rules" as const, expect: {} };
    const guard = (advice: boolean) =>
      fixedChecks(question, answer, { ...facts, advice }).find((c) => c.name === "guardrails")!.ok;
    expect(guard(true)).toBe(true);
    expect(guard(false)).toBe(false);
  });
});
