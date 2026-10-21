import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { DECISION_QUESTIONS } from "../checks/bank-decisions";
import { checkGuardrails } from "@/lib/guardrails";
import type { DecisionFacts } from "@/planning/investing-decision";
import { parseIntent } from "../intents";
import { decisionReply } from "./decision-reply";

// The investing decisions in the chat: every question gets a direct answer of three
// sentences or fewer from the person's numbers, debt first, then the emergency fund, with the
// crypto connect offer only as an optional button, and facts only on real accounts.

const ASOF = "2026-10-20";
const BASE: DecisionFacts = {
  advice: true,
  highDebts: [],
  topDebt: null,
  emergencyTargetCents: 900_000,
  savingsCents: 1_200_000,
  investedCents: 4_000_000,
  cryptoCents: 0,
  soonGoal: null,
  riskLabel: "Moderate",
  monthlyIncomeCents: 500_000,
};
const DEBT: DecisionFacts = {
  ...BASE,
  highDebts: [{ name: "Demo Credit Card", balanceCents: 194_020, aprBps: 2699 }],
  topDebt: { name: "Demo Credit Card", aprBps: 2699 },
};
const GAP: DecisionFacts = { ...BASE, savingsCents: 300_000 };
const sentences = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean);

const ask = (text: string, facts: DecisionFacts) => {
  const intent = parseIntent(text, ASOF);
  expect(intent, text).toMatchObject({ kind: "investments", topic: "decision" });
  const d = (intent as unknown as { decision: { kind: never; subject: string | null } }).decision;
  return decisionReply(d.kind, facts, d.subject);
};

describe("the 30 investing decisions", () => {
  for (const q of DECISION_QUESTIONS) {
    it(`answers ${JSON.stringify(q.text)} in three sentences or fewer, in every situation`, () => {
      for (const facts of [BASE, DEBT, GAP, { ...BASE, advice: false }]) {
        const r = ask(q.text, facts);
        expect(sentences(r.body).length, r.body).toBeLessThanOrEqual(3);
        expect(r.body).not.toMatch(/connect a demo exchange/i);
        expect(r.body).not.toMatch(/will (?:go|rise|fall|drop|crash)|guarantee|definitely/i);
        // In advice mode the answer passes the demo advice guardrail; on a real account it
        // recommends nothing.
        if (facts.advice) {
          const result = checkGuardrails(r.body, [], undefined, "demo_advice");
          expect(
            result.ok || !result.issues.some((i) => i !== "unsupported_dollar_figure"),
            r.body,
          ).toBe(true);
        } else {
          expect(r.body).not.toMatch(/\byou should\b|\bI recommend\b|\bnot yet\b/i);
        }
      }
    });
  }
});

describe("what each answer rests on", () => {
  it("puts high-interest debt first for a purchase, with the person's own balance and rate", () => {
    const r = ask("should i buy bitcoin", DEBT);
    expect(r.body).toMatch(/^Not yet: you owe \$1,940\.20 on Demo Credit Card at 27%/);
  });
  it("puts the emergency fund next", () => {
    const r = ask("should i buy tesla stock", GAP);
    expect(r.body).toMatch(/^Not yet: your emergency fund is \$3,000\.00 of the \$9,000\.00/);
  });
  it("sizes a speculative bet from what they invest, and names the company asked about", () => {
    expect(ask("should i buy bitcoin", BASE).body).toMatch(/about 5%.*\$2,000\.00/);
    expect(ask("should i buy tesla stock", BASE).body).toMatch(/Tesla is a bet on one company/);
  });
  it("offers the crypto connection only as an optional button, never in the words", () => {
    const r = ask("should i buy bitcoin", BASE);
    expect(r.actions.map((a) => a.id)).toEqual(["crypto.link", "open"]);
    expect(r.body).toMatch(/I only read crypto, I never buy it/);
    expect(
      ask("should i buy bitcoin", { ...BASE, cryptoCents: 50_000 }).actions.map((a) => a.id),
    ).toEqual(["open"]);
  });
  it("compares the rate with the return range for invest or pay off debt", () => {
    expect(ask("should i invest or pay off debt", DEBT).body).toMatch(
      /Pay off Demo Credit Card first.*27%.*7%/,
    );
    expect(ask("should i invest or pay off debt", BASE).body).toMatch(
      /no debt costing you interest/,
    );
  });
  it("uses their invested total for index funds against stocks", () => {
    expect(ask("index funds or picking stocks", BASE).body).toMatch(
      /\$40,000\.00 invested.*\$140\.00 a year/,
    );
  });
  it("refuses to time the market and checks readiness instead", () => {
    const r = ask("is now a good time to invest", BASE);
    expect(r.body).toMatch(/^Nobody can time it/);
    expect(ask("is now a good time to invest", DEBT).body).toMatch(/Not yet: you owe/);
  });
  it("keeps money needed soon out of investments", () => {
    const goal = { name: "House down payment", leftCents: 800_000, months: 14 };
    expect(ask("should i save or invest", { ...BASE, soonGoal: goal }).body).toMatch(
      /House down payment.*14 months/,
    );
  });
  it("labels advice mode and gives only facts on a real account", () => {
    expect(ask("should i buy bitcoin", BASE).refs).toEqual({ advice: true });
    const real = ask("should i buy bitcoin", { ...DEBT, advice: false });
    expect(real.refs).toEqual({});
    expect(real.body).toMatch(/I can't tell you whether to buy crypto/);
    expect(real.body).toMatch(/you owe \$1,940\.20/);
    expect(real.actions.map((a) => a.id)).toEqual(["open"]);
  });
});
