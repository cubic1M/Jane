import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { parseIntent } from "@/lib/jane-agent/intents";
import {
  askingStep,
  decisionStep,
  sizedActions,
  sizedBody,
} from "@/lib/jane-agent/insurance/life-words";
import type { LifeApplication } from "./life";
import { lifeNeed, methodLines, type LifeNeedInput } from "./life-need";
import { nextLifeQuestion, standInDecision } from "./life-underwriting";

// Life insurance, sized and bought (spec step 153): the method, the term, the health
// questions and the stand-in carrier's decision, and how Jane says each. Pure.

const input = (over: Partial<LifeNeedInput> = {}): LifeNeedInput => ({
  yearlyPayCents: 8_000_000,
  dependants: 2,
  mortgageCents: 30_000_000,
  otherDebtCents: 1_000_000,
  mortgageYearsLeft: 18,
  savingsCents: 2_000_000,
  existingCoverCents: 8_000_000,
  ...over,
});

describe("how much life cover", () => {
  it("adds up the need, line by line, and rounds it up", () => {
    const need = lifeNeed(input())!;
    // 800,000 + 300,000 + 10,000 + 15,000 + 100,000 − 20,000 − 80,000 = 1,125,000.
    expect(need.amountCents).toBe(115_000_000);
    expect(need.termYears).toBe(20);
    expect(methodLines(need)).toEqual([
      "+ $800,000.00: 10 years of your pay",
      "+ $300,000.00: Paying off the mortgage",
      "+ $10,000.00: Paying off other debts",
      "+ $15,000.00: Final expenses",
      "+ $100,000.00: School for 2 dependants",
      "− $20,000.00: Less your savings",
      "− $80,000.00: Less life cover you already have",
      "= $1,150,000.00, rounded up, for 20 years, while the people who depend on you grow up",
    ]);
  });

  it("lasts until the mortgage is paid off when that's longer", () => {
    expect(lifeNeed(input({ mortgageYearsLeft: 27 }))).toMatchObject({
      termYears: 30,
      termWhy: "30 years, so it lasts until the mortgage is paid off",
    });
  });

  it("isn't needed without dependants, without pay, or when savings and cover already meet it", () => {
    expect(lifeNeed(input({ dependants: 0 }))).toBeNull();
    expect(lifeNeed(input({ yearlyPayCents: null }))).toBeNull();
    expect(lifeNeed(input({ savingsCents: 200_000_000 }))).toBeNull();
    expect(lifeNeed(input({ savingsCents: 110_000_000 }))?.amountCents).toBe(10_000_000);
  });
});

describe("the application", () => {
  it("asks the health questions in order", () => {
    expect(nextLifeQuestion({})).toBe("conditions");
    expect(
      nextLifeQuestion({ conditions: false, hospital: false, medication: false, driving: false }),
    ).toBe("tobacco");
    expect(
      nextLifeQuestion({
        conditions: false,
        hospital: false,
        medication: false,
        driving: false,
        tobacco: true,
      }),
    ).toBeNull();
  });

  it("offers a rate class from the answers, or refers it for the carrier's review", () => {
    const quote = { premiumCents: 4_000, annualPremiumCents: 48_000, perYear: 12 };
    const none = { conditions: false, hospital: false, medication: false, driving: false };
    expect(standInDecision(quote, { ...none, tobacco: false })).toEqual({
      outcome: "offered",
      rateClass: "preferred",
      premiumCents: 4_000,
      annualPremiumCents: 48_000,
    });
    expect(standInDecision(quote, { ...none, medication: true, tobacco: false })).toMatchObject({
      rateClass: "standard",
      premiumCents: 5_200,
    });
    expect(standInDecision(quote, { ...none, tobacco: true })).toMatchObject({
      rateClass: "tobacco",
      premiumCents: 10_000,
      annualPremiumCents: 120_000,
    });
    expect(standInDecision(quote, { ...none, conditions: true })).toMatchObject({
      outcome: "referred",
    });
  });
});

describe("in the chat", () => {
  const need = lifeNeed(input())!;
  const application: LifeApplication = {
    id: "l1",
    status: "sized",
    amountCents: need.amountCents,
    termYears: need.termYears,
    method: need.lines,
    termWhy: need.termWhy,
    quotes: [
      {
        partnerQuoteId: "q1",
        carrier: {
          id: "demo-bluepeak",
          name: "Bluepeak Mutual (demo)",
          rating: "A",
          ratingScore: 90,
          claimsPhone: "",
          claimsUrl: "",
        },
        premiumCents: 3_400,
        annualPremiumCents: 40_800,
        premiumFrequency: "monthly",
        expiresAt: "2026-11-18T00:00:00.000Z",
        demo: true,
      },
    ],
    quoteId: null,
    answers: {},
    decision: null,
    policyId: null,
  };

  it("says the amount and term first, then the method and the best price", () => {
    const lines = sizedBody(application, "2026-10-19").split("\n");
    expect(lines[0]).toBe(
      "You'd need about $1,150,000.00 of term life insurance for 20 years. Here's how I worked it out:",
    );
    expect(lines.at(-2)).toBe(
      "The best price I found: Bluepeak Mutual (demo) at $34.00 a month, before their health questions.",
    );
    expect(sizedActions(application, "2026-10-19").map((a) => a.id)).toEqual([
      "lifecover.apply",
      "open",
      "lifecover.dismiss",
    ]);
    // Expired quotes aren't offered.
    expect(sizedActions(application, "2026-12-01").map((a) => a.id)).toEqual([
      "open",
      "lifecover.dismiss",
    ]);
  });

  it("asks one question at a time, then Send", () => {
    const asking = { ...application, status: "asking" as const, quoteId: "q1" };
    expect(askingStep(asking).body).toBe(
      "Question 1 of 5: Have you ever been treated for heart disease, cancer, a stroke or diabetes?",
    );
    const done = askingStep({
      ...asking,
      answers: {
        conditions: false,
        hospital: false,
        medication: false,
        driving: false,
        tobacco: false,
      },
    });
    expect(done.actions.map((a) => a.id)).toEqual(["lifecover.submit", "open"]);
    expect(done.body).toMatch(/^That's every question\. I'll send your application to Bluepeak/);
  });

  it("says the offer and asks to buy, or that the carrier will review it", () => {
    const offered = decisionStep({
      ...application,
      status: "offered",
      quoteId: "q1",
      decision: {
        outcome: "offered",
        rateClass: "preferred",
        premiumCents: 3_400,
        annualPremiumCents: 40_800,
        offerExpiresAt: "2026-11-18T16:00:00.000Z",
      },
    });
    expect(offered.body.split("\n")).toEqual([
      "Bluepeak Mutual (demo) offers you $1,150,000.00 of cover for 20 years at $34.00 a month, their best rate. Buy it?",
      "The offer is open until Nov 18, 2026.",
    ]);
    expect(offered.actions.map((a) => a.id)).toEqual([
      "lifecover.buy",
      "lifecover.dismiss",
      "open",
    ]);
    const referred = decisionStep({
      ...application,
      status: "referred",
      quoteId: "q1",
      decision: { outcome: "referred", reason: "They review it.", offerExpiresAt: null },
    });
    expect(referred.body).toBe(
      "Bluepeak Mutual (demo) wants to review your application itself. They review it. Our team will follow up with you about the next step.",
    );
  });

  it("reads questions about sizing and buying life cover", () => {
    for (const text of [
      "how much life insurance do I need",
      "apply for life insurance",
      "should I buy term life",
    ]) {
      expect(parseIntent(text, "2026-10-19"), text).toMatchObject({
        kind: "insurance",
        ask: "life",
      });
    }
    expect(parseIntent("do I need life insurance", "2026-10-19")).toMatchObject({ ask: "need" });
  });
});
