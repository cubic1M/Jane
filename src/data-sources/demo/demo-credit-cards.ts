import type { CardProduct } from "@/lib/credit-cards/partner";

// A stand-in card catalog for the demo bank (spec step 174): made-up issuers with
// realistic rewards, annual fees and intro offers, so picking a card can be tried end to
// end before a card marketplace partner is connected. Every card in it is marked demo and
// labelled as a sample; it's never used for a real account.

const EXAMPLE = "https://example.com/jane-demo/cards";

export const DEMO_CARDS: readonly CardProduct[] = [
  // The demo bank's own card ("Demo Credit Card"): a dining card with a $95 fee.
  {
    id: "demo-dine-plus",
    issuer: "Demo Bank",
    name: "Demo Dine Plus",
    annualFeeCents: 9_500,
    rateBps: { dining: 300, travel: 200 },
    baseRateBps: 100,
    rewardsLabel: "3x points on dining, 2x on travel, 1x on everything else (a point is worth 1¢)",
    intro: null,
    minBand: "good",
    sourceUrl: `${EXAMPLE}/demo-dine-plus`,
    demo: true,
  },
  {
    id: "fern-flat-2",
    issuer: "Fern Card Co.",
    name: "Fern Flat 2%",
    annualFeeCents: 0,
    rateBps: {},
    baseRateBps: 200,
    rewardsLabel: "2% cash back on everything",
    intro: { bonusCents: 20_000, spendCents: 50_000, months: 3 },
    minBand: "good",
    sourceUrl: `${EXAMPLE}/fern-flat-2`,
    demo: true,
  },
  {
    id: "harbor-grocer",
    issuer: "Harbor Bank",
    name: "Harbor Grocer Cash",
    annualFeeCents: 0,
    rateBps: { groceries: 300, gas: 300, online: 300 },
    baseRateBps: 100,
    rewardsLabel: "3% on groceries, gas and online shopping, 1% on everything else",
    intro: { bonusCents: 15_000, spendCents: 50_000, months: 3 },
    minBand: "good",
    sourceUrl: `${EXAMPLE}/harbor-grocer`,
    demo: true,
  },
  {
    id: "summit-premier",
    issuer: "Summit Financial",
    name: "Summit Premier Travel",
    annualFeeCents: 55_000,
    rateBps: { travel: 500, dining: 300 },
    baseRateBps: 100,
    rewardsLabel: "5x on travel, 3x on dining, 1x on everything else (a point is worth 1¢)",
    intro: { bonusCents: 75_000, spendCents: 400_000, months: 3 },
    minBand: "excellent",
    sourceUrl: `${EXAMPLE}/summit-premier`,
    demo: true,
  },
  {
    id: "willow-starter",
    issuer: "Willow Credit Union",
    name: "Willow Starter Cash",
    annualFeeCents: 0,
    rateBps: { dining: 150, groceries: 150 },
    baseRateBps: 100,
    rewardsLabel: "1.5% on dining and groceries, 1% on everything else",
    intro: null,
    minBand: "fair",
    sourceUrl: `${EXAMPLE}/willow-starter`,
    demo: true,
  },
];

// The demo bank's card accounts, by name, to the product each one is.
export const DEMO_CARD_ACCOUNTS: Readonly<Record<string, string>> = {
  "Demo Credit Card": "demo-dine-plus",
};
