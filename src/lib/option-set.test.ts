import { describe, expect, it } from "vitest";
import { DEMO_ADVICE_LABEL } from "@/config/advice";
import { CARD_HEADLINE_WORDS } from "@/config/floating-cards";
import { demoPartner } from "@/lib/insurance/demo-partner";
import { insuranceCard } from "@/lib/insurance/need/card";
import { liabilityNeedsFor, type NeedInput } from "@/lib/insurance/need/index";
import { buildOptions, optionRequests } from "@/lib/insurance/need/options";
import type { CardOption, OptionCard } from "./option-card";
import { optionHeadline, toOptionSet } from "./option-set";

// The one adapter from a lane's pick-one card to the floating pick card.

const option = (over: Partial<CardOption> & { id: string }): CardOption => ({
  label: over.id,
  headline: `${over.id}, $1,272.00 a year`,
  priceCents: 127_200,
  pricePeriod: "year",
  facts: ["Injury liability: $250,000 a person"],
  whyThisOne: "Same cover, less a year.",
  isPick: false,
  details: ["Priced on Oct 18 by the demo partner."],
  ...over,
});

const insurance = (advice: boolean, options: CardOption[]): OptionCard => ({
  kind: "insurance",
  title: "Choose your car's injury liability",
  topic: "auto_liability",
  newCover: false,
  options,
  advice,
});

const dollarFigures = (s: string) => (s.match(/\$[\d,]+(?:\.\d\d)?/g) ?? []).length;
const wordCount = (s: string) => s.trim().split(/\s+/).length;

describe("toOptionSet", () => {
  it("puts the name and the price in the headline: one dollar figure, /yr or /mo", () => {
    const set = toOptionSet(
      insurance(false, [
        option({ id: "Lighthouse" }),
        option({
          id: "lakeside",
          label: "Lakeside Credit Union",
          headline: "Lakeside Credit Union 6.9%, save $1,840",
          priceCents: 41_250,
          pricePeriod: "month",
        }),
      ]),
    );
    expect(set.options.map((o) => o.headline)).toEqual([
      "Lakeside Credit Union 6.9%, $412.50/mo",
      "Lighthouse, $1,272/yr",
    ]);
    for (const o of set.options) {
      expect(dollarFigures(o.headline)).toBe(1);
      expect(wordCount(o.headline)).toBeLessThanOrEqual(CARD_HEADLINE_WORDS);
    }
  });

  it("shortens a long name to fit the word limit, keeping the price", () => {
    const long = option({
      id: "long",
      headline: "The Very Long Mutual Insurance Company Of The Great Lakes, $900.00 a year",
      priceCents: 90_000,
    });
    const headline = optionHeadline(long);
    expect(wordCount(headline)).toBe(CARD_HEADLINE_WORDS);
    expect(headline.endsWith("$900/yr")).toBe(true);
    expect(dollarFigures(headline)).toBe(1);
  });

  it("keeps a free option's own figure (paying off with cash)", () => {
    const payoff = option({
      id: "payoff",
      headline: "Pay it off with cash, save $1,840",
      priceCents: 0,
      pricePeriod: "month",
    });
    expect(optionHeadline(payoff)).toBe("Pay it off with cash, save $1,840");
  });

  it("makes whyThisOne the summary, and the facts and details More details", () => {
    const [o] = toOptionSet(
      insurance(false, [
        option({
          id: "a",
          facts: ["APR: 6.90% fixed", "Term: 60 months", "Covers rental cars"],
          details: ["Priced on Oct 18."],
        }),
      ]),
    ).options;
    expect(o.summary).toBe("Same cover, less a year.");
    expect(o.details.figures).toEqual([
      { label: "APR", value: "6.90% fixed" },
      { label: "Term", value: "60 months" },
    ]);
    expect(o.details.notes).toEqual(["Covers rental cars", "Priced on Oct 18."]);
    expect(o.details.whatYesDoes).toMatch(/team/);
    expect(o.yesLabel).toBe("Pick this one");
    expect(o.notNowLabel).toBe("Later");
  });

  it("shows no pick, no confidence and no advice label without demo advice", () => {
    const set = toOptionSet(insurance(false, [option({ id: "a" }), option({ id: "b" })]));
    for (const o of set.options) {
      expect(o.badge).toBeUndefined();
      expect(o.details.confidence).toBeUndefined();
      expect(o.details.notes).not.toContain(DEMO_ADVICE_LABEL);
    }
  });

  it("in demo advice mode shows her pick and how sure she is, with the label", () => {
    const set = toOptionSet(
      insurance(true, [
        option({ id: "cheap", priceCents: 50_000, headline: "Cheap, $500.00 a year" }),
        option({
          id: "pick",
          isPick: true,
          confidence: { percent: 78, reason: "it closes the gap for the least" },
          details: ["Why: closes the gap.", DEMO_ADVICE_LABEL],
        }),
      ]),
    );
    const [pick, other] = set.options;
    expect(pick.id).toBe("pick");
    expect(pick.badge).toBe("Jane's pick");
    expect(pick.details.confidence).toEqual({
      percent: 78,
      reason: "it closes the gap for the least",
    });
    // The label once, last.
    expect(pick.details.notes?.filter((n) => n === DEMO_ADVICE_LABEL)).toHaveLength(1);
    expect(pick.details.notes?.at(-1)).toBe(DEMO_ADVICE_LABEL);
    expect(other.badge).toBeUndefined();
    expect(other.details.confidence).toBeUndefined();
    expect(other.details.notes).toContain(DEMO_ADVICE_LABEL);
  });

  it("orders the pick first, then by price", () => {
    const set = toOptionSet(
      insurance(true, [
        option({ id: "mid", priceCents: 80_000 }),
        option({ id: "dear", priceCents: 150_000 }),
        option({ id: "pick", priceCents: 120_000, isPick: true }),
        option({ id: "cheap", priceCents: 40_000 }),
      ]),
    );
    expect(set.options.map((o) => o.id)).toEqual(["pick", "cheap", "mid", "dear"]);
    expect(set.title).toBe("Choose your car's injury liability");
  });

  it("ignores a pick flag on a card without advice: price order only", () => {
    const set = toOptionSet(
      insurance(false, [
        option({ id: "dear", priceCents: 150_000, isPick: true }),
        option({ id: "cheap", priceCents: 40_000 }),
      ]),
    );
    expect(set.options.map((o) => o.id)).toEqual(["cheap", "dear"]);
    expect(set.options[1].badge).toBeUndefined();
  });

  it("turns a real insurance card into short headlines with one figure each", async () => {
    const car = {
      id: "p1",
      kind: "auto" as const,
      status: "active",
      deductibleCents: 100_000,
      coverage: { bodilyInjuryPerPerson: 5_000_000, bodilyInjuryPerAccident: 10_000_000 },
    };
    const input: NeedInput = {
      yearlyPayCents: null,
      dependants: 0,
      mortgageCents: 0,
      otherDebtCents: 0,
      mortgageYearsLeft: null,
      savingsCents: 0,
      cashCents: 0,
      netWorthCents: 20_000_000,
      workLifeCoverCents: 0,
      policies: [car],
    };
    const [need] = liabilityNeedsFor(input);
    const priced = await Promise.all(
      optionRequests(need, car, { netWorthCents: 20_000_000 }).map(async (request) => ({
        request,
        quotes: await demoPartner.quote(
          {
            kind: request.kind,
            state: null,
            household: { housing: "own", vehicles: 1, dependants: 0, pets: 0 },
            deductibleCents: request.deductibleCents,
            coverage: request.coverage,
            premiumFrequency: "monthly",
            startDate: "2026-10-19",
          },
          { now: new Date("2026-10-18T15:00:00Z") },
        ),
      })),
    );
    const card = insuranceCard(buildOptions(need, priced, 170_400, { policyId: "p1" }), need, true);
    const set = toOptionSet(card);
    expect(set.options.length).toBe(card.options.length);
    expect(set.options[0].badge).toBe("Jane's pick");
    for (const o of set.options) {
      expect(dollarFigures(o.headline)).toBe(1);
      expect(o.headline).toMatch(/\/yr$/);
      expect(wordCount(o.headline)).toBeLessThanOrEqual(CARD_HEADLINE_WORDS);
      expect(o.summary.length).toBeGreaterThan(0);
    }
  });
});
