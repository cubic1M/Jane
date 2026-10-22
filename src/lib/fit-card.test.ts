import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { DEMO_ADVICE_LABEL } from "@/config/advice";
import {
  FIT_CARD_PAYMENT_SHARE,
  FIT_KEEP_CASH_MONTHS,
  FIT_MIN_SAVING_CENTS,
  FIT_TERMS,
  type FitNeed,
} from "@/config/fit";
import { PEOPLE } from "@/config/people";
import { demoLender } from "@/lib/lenders/demo";
import { formatCents } from "@/lib/money";
import type { LoanOffer } from "@/lib/lenders/partner";
import { MAX_CARD_OPTIONS, OPTION_HEADLINE_WORDS, type OptionCard } from "@/lib/option-card";
import {
  fit,
  keepCost,
  type FitBaseline,
  type FitInput,
  type FitOption,
  type FitPerson,
} from "@/planning/fit";
import { fitPersonFrom } from "@/planning/fit-person";
import { inputFor } from "@/profile/sample";
import type { FitView } from "./fit";
import { fitCard, fitCardProblems, fitTopic, parseFitTopic } from "./fit-card";

// Spec step 282: the fit engine's options as the shared pick-one card, kind "loan".

async function offersFor(product: "auto" | "personal", amountCents: number): Promise<LoanOffer[]> {
  const out: LoanOffer[] = [];
  for (const termMonths of FIT_TERMS[product]) {
    out.push(
      ...(await demoLender.prequalify({
        product,
        amountCents,
        termMonths,
        creditBand: "good",
        month: "2026-10",
      })),
    );
  }
  return out;
}

const viewOf = (input: FitInput): FitView => ({
  ...fit(input),
  available: true,
  advice: true,
  checkedOn: "2026-10-18",
  baseline: input.baseline ?? null,
  debtKey: null,
});

const person = (over: Partial<FitPerson> = {}): FitPerson => ({
  creditScore: 720,
  incomeCents: 600_000,
  debtPaymentsCents: 60_000,
  cashCents: 1_000_000,
  debtTrouble: false,
  ...over,
});

// The rules every loan card holds to, with or without advice.
function expectGoodCard(card: OptionCard, view: FitView, advice: boolean) {
  expect(fitCardProblems(card)).toEqual([]);
  expect(card.kind).toBe("loan");
  expect(card.advice).toBe(advice);
  expect(card.options.length).toBeLessThanOrEqual(MAX_CARD_OPTIONS);
  expect(card.options.length).toBeGreaterThanOrEqual(Math.min(2, view.options.length));
  for (const o of card.options) {
    const engine = view.options.find((e) => e.id === o.id)!;
    expect(o.headline.split(/\s+/).length).toBeLessThanOrEqual(OPTION_HEADLINE_WORDS);
    expect(o.headline.match(/\$[\d,]+/g)).toHaveLength(1);
    expect(o.priceCents).toBe(engine.paymentCents);
    expect(o.pricePeriod).toBe("month");
    expect(o.facts.map((f) => f.split(":")[0])).toEqual(["APR", "Term", "Total interest", "Fees"]);
    expect(o.whyThisOne).not.toBe("");
  }
  const picks = card.options.filter((o) => o.isPick);
  if (advice && view.pick) {
    expect(picks.map((o) => o.id)).toEqual([view.pick]);
    expect(card.options[0].id).toBe(view.pick);
    expect(card.options[0].confidence).toEqual(view.confidence);
    expect(card.options[0].details.at(-1)).toBe(DEMO_ADVICE_LABEL);
  } else {
    expect(picks).toEqual([]);
    expect(card.options.some((o) => o.confidence)).toBe(false);
    expect(card.options.some((o) => o.details.includes(DEMO_ADVICE_LABEL))).toBe(false);
  }
}

describe("the loan card's shape", () => {
  it("shows a new car loan's options short, with the payment, the facts and the maths", async () => {
    const view = viewOf({
      need: "car",
      product: "auto",
      amountCents: 2_000_000,
      person: person(),
      offers: await offersFor("auto", 2_000_000),
    });
    const card = fitCard(view, true)!;
    expectGoodCard(card, view, true);
    expect(card.title).toBe("Your options for a car loan");
    expect(card.topic).toBe("car:2000000");
    expect(card.newCover).toBe(true);
    const first = card.options[0];
    expect(first.headline).toMatch(/^[A-Z][\w ]+ \d+(\.\d+)?%, \$[\d,]+ a month$/);
    const engine = view.options.find((o) => o.id === first.id)!;
    expect(first.label).toBe(engine.lender);
    expect(first.details.slice(0, -1)).toEqual(engine.details);
    // Interest is what's paid over the term less the loan and the fees.
    const interest = engine.totalCostCents - engine.feeCents - 2_000_000;
    expect(first.facts[2]).toBe(`Total interest: ${formatCents(interest)}`);
    expect(first.facts[1]).toBe(`Term: ${engine.termMonths} months`);
  });

  it("shows no pick, no confidence and no label outside advice mode", async () => {
    const view = viewOf({
      need: "car",
      product: "auto",
      amountCents: 2_000_000,
      person: person(),
      offers: await offersFor("auto", 2_000_000),
    });
    expectGoodCard(fitCard(view, false)!, view, false);
  });

  it("is nothing when nothing fits", async () => {
    const view = viewOf({
      need: "car",
      product: "auto",
      amountCents: 2_000_000,
      person: person({ creditScore: 400 }),
      offers: await offersFor("auto", 2_000_000),
    });
    expect(view.options).toEqual([]);
    expect(fitCard(view, true)).toBeNull();
  });

  it("says what a refinance saves, keeps the pick first and trims to four", async () => {
    const baseline = {
      label: "your car loan",
      balanceCents: 1_280_000,
      aprBps: 1_790,
      monthlyCents: 46_000,
    };
    const view = viewOf({
      need: "refinance",
      product: "auto",
      amountCents: baseline.balanceCents,
      person: person(),
      offers: await offersFor("auto", baseline.balanceCents),
      baseline,
    });
    const card = fitCard({ ...view, debtKey: "auto:1" }, true)!;
    expectGoodCard(card, view, true);
    expect(card.topic).toBe("refinance:auto:1");
    expect(card.newCover).toBe(false);
    expect(card.options[0].headline).toMatch(/, save \$[\d,]+$/);
    expect(card.options[0].whyThisOne).toContain("less in all than keeping your car loan");
  });

  it("puts keep-what-you-have first when it's the pick, priced at today's payment", async () => {
    const baseline = {
      label: "your car loan",
      balanceCents: 1_000_000,
      aprBps: 400,
      monthlyCents: 46_000,
    };
    const view = viewOf({
      need: "refinance",
      product: "auto",
      amountCents: baseline.balanceCents,
      person: person(),
      offers: await offersFor("auto", baseline.balanceCents),
      baseline,
    });
    expect(view.pick).toBe("keep");
    const card = fitCard(view, true)!;
    expectGoodCard(card, view, true);
    expect(card.options[0]).toMatchObject({
      id: "keep",
      headline: "Keep what you have, $460 a month",
      priceCents: 46_000,
      whyThisOne: "No offer saves enough to be worth moving, so nothing to apply for.",
    });
  });

  it("keeps a long lender name to its first word when the line would be too long", () => {
    const view: FitView = {
      need: "personal",
      amountCents: 500_000,
      options: [
        {
          id: "x",
          label: "best_cost",
          lender: "The Very Long Named Community Credit Union",
          aprBps: 990,
          rateType: "fixed",
          termMonths: 36,
          paymentCents: 16_100,
          feeCents: 0,
          totalCostCents: 579_600,
          savesCents: null,
          paymentChangeCents: null,
          paymentShare: 0.03,
          breakEvenMonths: null,
          comfortable: true,
          headline: "",
          details: [],
        } satisfies FitOption,
      ],
      pick: "x",
      confidence: { percent: 75, reason: "stand-in quotes" },
      ineligible: [],
      whatWouldHelp: [],
      assumptions: [],
      available: true,
      advice: true,
      checkedOn: "2026-10-18",
      baseline: null,
      debtKey: null,
    };
    expect(fitCard(view, true)!.options[0].headline).toBe("The 9.9%, $161 a month");
  });
});

describe("paying off with your cash", () => {
  const card = { label: "your card", balanceCents: 300_000, aprBps: 2_499, monthlyCents: 9_000 };
  const consolidate = async (p: FitPerson) =>
    viewOf({
      need: "consolidation",
      product: "personal",
      amountCents: card.balanceCents,
      person: p,
      offers: await offersFor("personal", card.balanceCents),
      baseline: card,
    });

  it("stays the pick, first, when the cash covers the debt and leaves a month of spending", async () => {
    const view = await consolidate(person({ cashCents: 900_000, spendCents: 250_000 }));
    const c = fitCard(view, true)!;
    expectGoodCard(c, view, true);
    expect(c.options[0]).toMatchObject({
      id: "payoff",
      isPick: true,
      priceCents: 0,
      facts: [
        "APR: none, paid from your cash",
        "Term: paid off now",
        "Total interest: $0.00",
        "Fees: none",
      ],
    });
    expect(c.options[0].headline).toMatch(/^Pay it off with cash, save \$[\d,]+$/);
    expect(c.title).toBe("Your options for consolidating your debt");
  });

  it("allows a $0 monthly price only for paying off with cash", async () => {
    const view = await consolidate(person({ cashCents: 900_000, spendCents: 250_000 }));
    const c = fitCard(view, true)!;
    const zero = {
      ...c,
      options: c.options.map((o, i) => (i === 1 ? { ...o, priceCents: 0 } : o)),
    };
    expect(fitCardProblems(zero)).toEqual([`${c.options[1].id}: price`]);
  });

  it("isn't offered when it would leave less than a month of spending", async () => {
    const view = await consolidate(person({ cashCents: 400_000, spendCents: 250_000 }));
    expect(fitCard(view, true)!.options.some((o) => o.id === "payoff")).toBe(false);
  });
});

describe("the eight sample people", () => {
  for (const p of PEOPLE) {
    const input = inputFor(p.id);
    const who = fitPersonFrom(input);
    const cards = input.accounts.filter((a) => a.type === "credit" && a.balanceCents > 0);
    const owed = cards.reduce((s, a) => s + a.balanceCents, 0);
    const baseline: FitBaseline | null =
      owed > 0
        ? {
            label: "your cards",
            balanceCents: owed,
            aprBps: Math.round(
              cards.reduce(
                (s, a) =>
                  s +
                  (input.liabilities.find((l) => l.accountId === a.id)?.aprBps ?? 2_400) *
                    a.balanceCents,
                0,
              ) / owed,
            ),
            monthlyCents: Math.round(owed * FIT_CARD_PAYMENT_SHARE),
          }
        : null;
    const needs: { need: FitNeed; amount: number; baseline: FitBaseline | null }[] = [
      { need: "personal", amount: 500_000, baseline: null },
      ...(baseline ? [{ need: "consolidation" as const, amount: owed, baseline }] : []),
    ];
    for (const { need, amount, baseline: b } of needs) {
      it(`${p.name}, ${need}: a good card, the pick only with advice, cash first when it covers`, async () => {
        const view = viewOf({
          need,
          product: "personal",
          amountCents: amount,
          person: who,
          offers: await offersFor("personal", amount),
          baseline: b,
        });
        const withAdvice = fitCard(view, true);
        const without = fitCard(view, false);
        if (view.options.length === 0) {
          expect(withAdvice).toBeNull();
          expect(without).toBeNull();
          return;
        }
        expectGoodCard(withAdvice!, view, true);
        expectGoodCard(without!, view, false);
        // Cash pays it off and still leaves a month of spending: that is the pick.
        const covers =
          b !== null &&
          who.spendCents !== undefined &&
          who.cashCents - who.spendCents * FIT_KEEP_CASH_MONTHS >= b.balanceCents &&
          keepCost(b).totalCents - b.balanceCents >= FIT_MIN_SAVING_CENTS;
        expect(withAdvice!.options[0].id === "payoff").toBe(covers);
        if (covers) expect(withAdvice!.options[0].isPick).toBe(true);
        // Someone in debt trouble is never picked a bigger payment than they have now.
        if (who.debtTrouble && b) {
          const pick = withAdvice!.options[0];
          expect(pick.priceCents).toBeLessThanOrEqual(b.monthlyCents);
        }
      });
    }
  }
});

describe("the topic", () => {
  it("carries what the options were priced for, and reads back", () => {
    for (const want of [
      { need: "car" as const, amountCents: 2_000_000 },
      { need: "home" as const, amountCents: 25_000_000 },
      { need: "personal" as const, amountCents: 500_000 },
      { need: "consolidation" as const },
      { need: "refinance" as const },
      { need: "refinance" as const, debtKey: "card:abc:def" },
    ]) {
      expect(parseFitTopic(fitTopic(want))).toEqual(want);
    }
  });

  it("refuses anything else", () => {
    for (const bad of ["", "boat:100", "car", "car:0", "car:-5", "car:1.5", "consolidation:x"]) {
      expect(parseFitTopic(bad)).toBeNull();
    }
  });
});
