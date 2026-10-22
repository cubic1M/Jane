import { describe, expect, it } from "vitest";
import { cardProblems, type CardOption, type OptionCard } from "./option-card";

// The shared pick-one card: the shape every sector's builder must hold to.

const option = (over: Partial<CardOption> = {}): CardOption => ({
  id: "a",
  label: "Lighthouse (rated A+)",
  headline: "Lighthouse, $1,296.00 a year",
  priceCents: 129_600,
  pricePeriod: "year",
  facts: ["Injury liability, per person: $100,000.00"],
  whyThisOne: "Cheapest that keeps your cover as it is.",
  isPick: false,
  details: ["Lighthouse: $1,296.00 a year"],
  ...over,
});
const card = (over: Partial<OptionCard> = {}): OptionCard => ({
  kind: "insurance",
  title: "Choose your car's injury liability",
  topic: "auto_liability",
  newCover: false,
  options: [
    option({ id: "a", isPick: true, confidence: { percent: 80, reason: "sample prices" } }),
    option({ id: "b" }),
  ],
  advice: true,
  ...over,
});

describe("cardProblems", () => {
  it("accepts a good card, with her pick first", () => {
    expect(cardProblems(card())).toEqual([]);
    expect(cardProblems(card({ kind: "loan" }))).toEqual([]);
  });

  it("holds options to one to four, unique ids, a short headline with a number, a price and a why", () => {
    expect(cardProblems(card({ options: [] }))).toContain("0 options");
    expect(
      cardProblems(card({ options: [option(), option(), option(), option(), option()] })),
    ).toContain("5 options");
    expect(cardProblems(card({ options: [option({ id: "a" }), option({ id: "a" })] }))).toContain(
      "duplicate id a",
    );
    expect(
      cardProblems(
        card({
          options: [
            option({ headline: "Lighthouse Insurance is the one to take for $1,296 a year now" }),
          ],
        }),
      ),
    ).toContain("a: headline too long");
    expect(
      cardProblems(card({ options: [option({ headline: "Lighthouse, cheapest" })] })),
    ).toContain("a: headline has no number");
    expect(cardProblems(card({ options: [option({ priceCents: 0 })] }))).toContain("a: price");
    expect(cardProblems(card({ options: [option({ whyThisOne: " " })] }))).toContain("a: no why");
  });

  it("shows a pick and a confidence only with advice, only one pick, first, only on the pick", () => {
    expect(cardProblems(card({ advice: false }))).toContain("a: a pick without advice");
    expect(
      cardProblems(card({ options: [option({ id: "a" }), option({ id: "b", isPick: true })] })),
    ).toContain("the pick isn't first");
    expect(
      cardProblems(
        card({ options: [option({ id: "a", isPick: true }), option({ id: "b", isPick: true })] }),
      ),
    ).toContain("more than one pick");
    expect(
      cardProblems(card({ options: [option({ confidence: { percent: 70, reason: "x" } })] })),
    ).toContain("a: confidence on a non-pick");
  });
});
