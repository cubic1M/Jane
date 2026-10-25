import { describe, expect, it } from "vitest";
import { DEMO_ADVICE_LABEL } from "@/config/advice";
import type { CardOption, OfferedOptions, OptionCompare } from "@/lib/option-card";
import { KIND_PREFERENCES, rank, toComparison, type Preference } from "./comparison";

// Comparison cards (founder, 2026-10-24): the options side by side, rows lined up, the ones
// that differ told from the ones that don't, a tag for what each is best at, and a preference
// that re-ranks them on the screen.

const loan = (
  id: string,
  m: { monthly: number; total: number; months: number; apr: string; fees: string },
  extra: Partial<CardOption> = {},
): CardOption => {
  const compare: OptionCompare = {
    monthlyCents: m.monthly,
    totalCents: m.total,
    coverScore: null,
    payoffMonths: m.months,
    rows: [
      { key: "apr", label: "APR", value: m.apr },
      { key: "term", label: "Term", value: `${m.months} months` },
      { key: "total", label: "Total cost", value: `$${m.total / 100}` },
      { key: "fees", label: "Fees", value: m.fees },
    ],
    bestFor: `Best for ${id}`,
  };
  return {
    id,
    label: `Lender ${id}`,
    headline: `Lender ${id} 7%, save $100`,
    priceCents: m.monthly,
    pricePeriod: "month",
    facts: [`APR: ${m.apr}`],
    whyThisOne: `Why ${id}.`,
    isPick: false,
    details: [`Working for ${id}`, DEMO_ADVICE_LABEL],
    compare,
    ...extra,
  };
};

const loans: OfferedOptions = {
  kind: "loan",
  title: "Your options for a refinance",
  topic: "refinance",
  newCover: false,
  advice: true,
  options: [
    loan(
      "best",
      { monthly: 40_000, total: 1_400_000, months: 48, apr: "6.90%", fees: "none" },
      { isPick: true, confidence: { percent: 72, reason: "your rate and income" } },
    ),
    loan("low", { monthly: 30_000, total: 1_600_000, months: 72, apr: "7.20%", fees: "none" }),
    loan("fast", { monthly: 60_000, total: 1_450_000, months: 24, apr: "6.50%", fees: "none" }),
  ],
};

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("toComparison", () => {
  const c = toComparison(loans)!;

  it("lines the rows up and says which differ", () => {
    expect(c.rows.map((r) => [r.key, r.differs])).toEqual([
      ["apr", true],
      ["term", true],
      ["total", true],
      // The same on every option: dimmed on the card.
      ["fees", false],
    ]);
    for (const o of c.options)
      expect(o.rows.map((r) => r.key)).toEqual(["apr", "term", "total", "fees"]);
  });

  it("tags what each is best at, once each", () => {
    const tags = Object.fromEntries(c.options.map((o) => [o.id, o.tags]));
    expect(tags).toEqual({
      best: ["LOWEST TOTAL"],
      low: ["LOWEST MONTHLY"],
      fast: ["FASTEST PAYOFF"],
    });
  });

  it("re-ranks by each preference, and opens on the one that puts her pick first", () => {
    expect(ids(rank(c.options, "lowest_total"))).toEqual(["best", "fast", "low"]);
    expect(ids(rank(c.options, "lowest_monthly"))).toEqual(["low", "best", "fast"]);
    expect(ids(rank(c.options, "fastest_payoff"))).toEqual(["fast", "best", "low"]);
    expect(c.preferences).toEqual(KIND_PREFERENCES.loan);
    expect(c.initial).toBe("lowest_total");
  });

  it("keeps the card's order for equal options", () => {
    const same = toComparison({
      ...loans,
      options: [
        loan("a", { monthly: 100, total: 1_000, months: 12, apr: "5%", fees: "none" }),
        loan("b", { monthly: 100, total: 1_000, months: 12, apr: "5%", fees: "none" }),
      ],
    })!;
    for (const p of KIND_PREFERENCES.loan) expect(ids(rank(same.options, p))).toEqual(["a", "b"]);
    // A tie wins no tag, and nothing differs.
    expect(same.options.flatMap((o) => o.tags)).toEqual([]);
    expect(same.rows.every((r) => !r.differs)).toBe(true);
  });

  it("shows her pick and how sure she is only as demo advice", () => {
    expect(c.options[0]).toMatchObject({ isPick: true, confidence: { percent: 72 } });
    // The label is shown once under the cards, not in each card's details.
    expect(c.options[0].details).toEqual(["APR: 6.90%", "Working for best"]);
    const real = toComparison({
      ...loans,
      advice: false,
      options: loans.options.map((o) => ({ ...o, isPick: false, confidence: undefined })),
    })!;
    expect(real.options.some((o) => o.isPick || o.confidence)).toBe(false);
    expect(real.initial).toBe("lowest_total");
  });

  it("has the headline as whole dollars a month", () => {
    expect(c.options.map((o) => o.monthly)).toEqual(["$400", "$300", "$600"]);
  });

  it("is null for a card saved before it carried the numbers", () => {
    expect(
      toComparison({ ...loans, options: loans.options.map((o) => ({ ...o, compare: undefined })) }),
    ).toBeNull();
  });
});

describe("insurance", () => {
  const cover = (id: string, yearly: number, score: number, value: string): CardOption => ({
    id,
    label: `${id} (rated A)`,
    headline: `${id}, $${yearly / 100} a year`,
    priceCents: yearly,
    pricePeriod: "year",
    facts: [],
    whyThisOne: "Why.",
    isPick: false,
    details: [],
    compare: {
      monthlyCents: Math.round(yearly / 12),
      totalCents: yearly,
      coverScore: score,
      payoffMonths: null,
      rows: [
        { key: "cover", label: "Cover", value },
        { key: "deductible", label: "Deductible", value: "none" },
        { key: "year", label: "A year", value: `$${yearly / 100}` },
        { key: "rated", label: "Rated", value: "A" },
      ],
      bestFor: "Best for it",
    },
  });
  const card: OfferedOptions = {
    kind: "insurance",
    title: "Choose your life cover",
    topic: "life",
    newCover: true,
    advice: true,
    options: [
      { ...cover("Lighthouse", 60_000, 50_000_000, "$500,000 for 20 years"), isPick: true },
      cover("Harbor", 45_000, 37_500_000, "$375,000 for 20 years"),
      cover("Summit", 72_000, 50_000_030, "$500,000 for 30 years"),
    ],
  };
  const c = toComparison(card)!;

  it("ranks by price or by cover, and tags the cheapest and the best cover", () => {
    expect(ids(rank(c.options, "cheapest"))).toEqual(["Harbor", "Lighthouse", "Summit"]);
    expect(ids(rank(c.options, "best_cover"))).toEqual(["Summit", "Lighthouse", "Harbor"]);
    expect(c.options.map((o) => [o.id, o.tags])).toEqual([
      ["Lighthouse", []],
      ["Harbor", ["CHEAPEST"]],
      ["Summit", ["BEST COVER"]],
    ]);
  });

  it("names it without the rating, which is a row", () => {
    expect(c.options[0].name).toBe("Lighthouse");
    expect(c.rows.find((r) => r.key === "rated")?.differs).toBe(false);
  });

  it("opens cheapest first when no preference puts her pick first", () => {
    expect(c.initial).toBe("cheapest");
    expect(c.preferences).toEqual(["cheapest", "best_cover"] satisfies Preference[]);
  });
});
