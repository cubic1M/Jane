import { describe, expect, it } from "vitest";
import { READ_ONLY_TAXES, READ_ONLY_TAX_CALENDAR } from "@/config/read-only-beta";
import { checkGuardrails, claimsAnAct, closingTheirWords } from "./guardrails";
import { GuardedText } from "./jane-agent/guarded-text";
import { healthYearLines } from "./jane-agent/insurance/health-year";
import { changesSource } from "./jane-agent/sources/changes";
import { leanSource } from "./jane-agent/sources/lean";

// A read of everything Jane says it did or will do, against whether any code does it. For a real
// account nobody acts, so these were false: a person told "I can cancel it" or "transfers are
// paused" stops looking, and their bank's transfers and the charge go on.
describe("what a real account is told", () => {
  it("doesn't hear a transfer is paused, when asked about a lean plan or after it", () => {
    const lean = (concierge: boolean) =>
      leanSource.gather(
        {
          concierge,
          lean: {
            open: [{ id: "l1", employer: "Acme", dueOn: "2026-11-01", status: "proposed" }],
            ended: [{ id: "l2", employer: "Acme" }],
          },
        } as never,
        {} as never,
      );
    const real = lean(false)
      .map((m) => m.body)
      .join("\n");
    expect(real).not.toMatch(/pause automatic transfers|transfers are on again/);
    expect(real).toMatch(/automatic transfers keep running/);
    expect(
      lean(true)
        .map((m) => m.body)
        .join("\n"),
    ).toMatch(/pause automatic transfers/);
  });

  it("isn't offered a cancel Jane can't do", () => {
    const change = {
      id: "c1",
      kind: "new_subscription",
      title: "Peacock is a new regular charge.",
      finding: { id: "f1", type: "subscription_review", handledBy: null },
    };
    const said = (concierge: boolean) =>
      changesSource.gather(
        {
          concierge,
          changes: [change],
          findings: [{ findingId: "f1", fingerprint: "x" }],
        } as never,
        { now: new Date("2026-11-04T15:00:00Z") } as never,
      )[0];
    const real = said(false);
    expect(real?.body).toMatch(/show you how to cancel it/);
    expect(real?.body).not.toMatch(/I can cancel it/);
    expect(JSON.stringify(real?.actions)).not.toContain('"Cancel it"');
    expect(said(true)?.body).toMatch(/I can cancel it/);
  });

  it("doesn't hear a team will dispute a medical bill", () => {
    const lines = healthYearLines({
      plan: { label: "Plan", deductibleCents: 100, outOfPocketMaxCents: null },
      progress: { deductibleMetCents: 0 },
      fsa: null,
      hsa: null,
      bills: [],
      disputes: [
        {
          bill: { provider: "Mercy Clinic", date: "2026-10-01" },
          paidCents: 50_000,
          shouldPayCents: 20_000,
          overCents: 30_000,
        },
      ],
    } as never).join("\n");
    expect(lines).not.toMatch(/team/i);
  });

  it("isn't told tax dates come to them", () => {
    expect(READ_ONLY_TAXES.lines.join(" ")).not.toMatch(/tells you what is due/);
    expect(READ_ONLY_TAX_CALENDAR).not.toMatch(/Jane tells you/);
    expect(READ_ONLY_TAX_CALENDAR).toMatch(/doesn't remind you/);
  });
});

describe("what Claude may say it did", () => {
  it.each([
    "I've cancelled your Netflix.",
    "I’ve sent the letter to your insurer.",
    "I have filed the dispute.",
    "I'll call them tomorrow.",
    "I'll remind you next week.",
    "Our team will take care of that.",
    "Jane's team has it.",
    "I'm cancelling it now.",
    "We'll file that for you.",
    "The team will look into it.",
    "I'm calling them now.",
    "We're disputing it for you.",
    "I said it's done. I've cancelled it.",
    "We've cancelled it.",
    "I cancelled your gym.",
    "We cancelled Netflix for you.",
    "I went ahead and cancelled it.",
    "I've now cancelled it.",
    "I also cancelled Hulu.",
    "Jane cancelled your Netflix.",
    "Jane will cancel it.",
    "Our concierge team will cancel it.",
    "The team is filing it.",
    "Jane is calling them.",
    "I've gone ahead and cancelled it.",
    "Jane has cancelled it.",
    "Jane's filed the dispute.",
    "Dear Comcast,\n\nI am disputing this.\n\nI'll send this to Comcast once you say yes.",
    "Dear Comcast,\n\nPlease fix this.\n\nThanks,\nSam\n\nI'll send this to Comcast once you say yes.",
    "BEST 12\" SUBS is cheap. I've cancelled it.",
    'You said "keep it" so I\'ve cancelled it.',
    "Keep it, \"I've cancelled the other one.",
  ])("stops %s", (text) => {
    expect(claimsAnAct(text)).toBe(true);
    expect(checkGuardrails(text, [])).toEqual({ ok: false, issues: ["claimed_action"] });
  });

  it.each([
    "I can't cancel it for you, but here's how.",
    "You can call them at the number on your bill.",
    "I've looked at your bills.",
    "You've paid $0 this month.",
    "Call them and ask to cancel.",
    "If you've cancelled it, tell me.",
    "Jane's team can't send letters yet.",
    "I'll call it your buffer.",
    'You could say: "I have paid this already, and I\'ve sent proof."',
    "Hi, I'm calling on behalf of Sam, the account holder.",
    "> I am disputing this charge. I have paid it already.",
    "Here's a letter:\n\nDear GEICO,\n\nI am disputing this charge. I have paid it.\n\nThanks,\nSam",
    "The team can often waive it.",
    "Say this: I'm calling to cancel my plan.",
    "I sent you a reminder on Monday.",
    "I cancelled on May 2 but was still charged.",
    "I called it your buffer.",
    "Jane's paid membership is $5.",
    "Jane's cancelled subscriptions list is on that page.",
    "Hi Comcast,\n\nI cancelled my plan in May.\n\nKind regards,\nSam",
    "Dear Comcast,\n\nI cancelled my plan in May.\n\nMany thanks,\nSam",
    "When you paid it, did they confirm?",
  ])("lets through %s", (text) => {
    expect(claimsAnAct(text)).toBe(false);
  });

  it("shows the whole of a script as it streams, its quote still open between sentences", () => {
    const answer = 'You could say: "I am disputing this charge. I have paid it. Please fix it."';
    let shown = "";
    const guarded = new GuardedText(
      () => [],
      (text) => (shown += text),
    );
    for (const word of answer.split(/(?<= )/)) guarded.push(word);
    guarded.finish();
    expect(shown).toBe(answer);
  });

  it("shows a letter as it streams, up to its sign-off and past it", () => {
    const letter = "Dear GEICO,\n\nI am disputing this charge. I have paid it.\n\nThanks,\nSam\n";
    let shown = "";
    const guarded = new GuardedText(
      () => [],
      (text) => (shown += text),
    );
    for (const word of letter.split(/(?<= )/)) guarded.push(word);
    guarded.finish();
    expect(shown).toBe(letter);
  });

  it("stops what comes after a letter as it streams", () => {
    let shown = "";
    const guarded = new GuardedText(
      () => [],
      (text) => (shown += text),
    );
    const answer =
      "Dear GEICO,\n\nPlease fix this.\n\nThanks,\nSam\n\nI've cancelled the policy too.\n";
    for (const word of answer.split(/(?<= )/)) guarded.push(word);
    guarded.finish();
    expect(shown).not.toContain("cancelled");
  });

  it("a finished answer gets nothing from a quote or letter that never closed", () => {
    expect(claimsAnAct('Tell them "I have paid this.')).toBe(true);
    expect(claimsAnAct("Dear GEICO,\n\nI am disputing this.")).toBe(true);
    expect(closingTheirWords('Tell them "I have paid this.')).toMatch(/"$/);
    expect(closingTheirWords("All good here.")).toBe("All good here.");
  });

  it("still stops a claim after a script has ended", () => {
    expect(claimsAnAct('Say: "I have paid this." I\'ve cancelled the other one.')).toBe(true);
  });

  it("leaves demo advice alone, where a stand-in really does these", () => {
    expect(checkGuardrails("I've sent it.", [], undefined, "demo_advice")).toEqual({ ok: true });
  });
});
