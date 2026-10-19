import type { PolicyKind } from "@/config/insurance";

// The stand-in carrier catalog (spec step 103): made-up insurers for the demo, priced by
// fixed rules (DEMO_PRICING in src/config/insurance.ts). Never real companies or real rates.
// Each carrier has its own price factor per kind, the deductibles it offers, and anything
// its standard policy leaves out, so like-for-like comparison has real differences to show.

export type DemoCarrier = {
  id: string;
  name: string;
  // A financial-strength rating as a partner would return it, and a 0–100 score for it.
  rating: string;
  ratingScore: number;
  claimsPhone: string;
  claimsUrl: string;
  // Price factor for each kind it writes; kinds it doesn't write aren't listed.
  kinds: Partial<Record<PolicyKind, number>>;
  // Deductibles it offers, in cents (the nearest to the one asked for is quoted).
  deductibles: readonly number[];
  // Cover its standard policy doesn't include, by cover field key.
  excludes?: readonly string[];
  // The most it quotes for a money limit, by cover field key.
  caps?: Readonly<Record<string, number>>;
};

const SITE = "https://example.com/jane-demo/carriers";

export const DEMO_CARRIERS: readonly DemoCarrier[] = [
  {
    id: "demo-lighthouse",
    name: "Lighthouse Insurance (demo)",
    rating: "A+",
    ratingScore: 95,
    claimsPhone: "1-800-555-0101",
    claimsUrl: `${SITE}/lighthouse/claims`,
    kinds: { auto: 0.82, home: 0.95, renters: 0.9, umbrella: 1 },
    deductibles: [50_000, 100_000, 250_000],
  },
  {
    id: "demo-bluepeak",
    name: "Bluepeak Mutual (demo)",
    rating: "A++",
    ratingScore: 98,
    claimsPhone: "1-800-555-0102",
    claimsUrl: `${SITE}/bluepeak/claims`,
    kinds: { auto: 0.9, home: 0.88, renters: 1, life: 0.95, disability: 1, umbrella: 0.9 },
    deductibles: [25_000, 50_000, 100_000, 250_000],
  },
  {
    id: "demo-cedar",
    name: "Cedar & Stone (demo)",
    rating: "A",
    ratingScore: 90,
    claimsPhone: "1-800-555-0103",
    claimsUrl: `${SITE}/cedar/claims`,
    kinds: { auto: 0.75, home: 1.05, renters: 0.8, umbrella: 1.05, device: 1 },
    deductibles: [50_000, 100_000],
    // Its cheapest car policy leaves out uninsured-driver cover.
    excludes: ["uninsuredMotorist"],
  },
  {
    id: "demo-northstar",
    name: "Northstar Assurance (demo)",
    rating: "A-",
    ratingScore: 85,
    claimsPhone: "1-800-555-0104",
    claimsUrl: `${SITE}/northstar/claims`,
    kinds: { auto: 0.7, renters: 0.85, life: 0.85, disability: 1.1, travel: 0.9, device: 0.85 },
    deductibles: [100_000, 250_000],
    caps: { propertyDamage: 2_500_000 },
  },
  {
    id: "demo-meadow",
    name: "Meadow Pet & Life (demo)",
    rating: "A",
    ratingScore: 90,
    claimsPhone: "1-800-555-0105",
    claimsUrl: `${SITE}/meadow/claims`,
    kinds: { pet: 0.9, life: 1, disability: 0.95, travel: 1 },
    deductibles: [25_000, 50_000],
  },
];

export const demoCarrier = (id: string) => DEMO_CARRIERS.find((c) => c.id === id) ?? null;

// Spec step 149: marketplace health plans, as a stand-in marketplace would list them. Each is
// one carrier's plan: a monthly premium for one person (more for each extra person), its
// deductible, the share of care the person pays after it, and the most they'd pay in a year.
export type DemoHealthPlan = {
  carrierId: string;
  name: string;
  monthlyCents: number;
  deductibleCents: number;
  coinsurance: number;
  outOfPocketMaxCents: number;
};

export const DEMO_HEALTH_PLANS: readonly DemoHealthPlan[] = [
  {
    carrierId: "demo-bluepeak",
    name: "Bluepeak Bronze (demo)",
    monthlyCents: 32_000,
    deductibleCents: 700_000,
    coinsurance: 40,
    outOfPocketMaxCents: 920_000,
  },
  {
    carrierId: "demo-bluepeak",
    name: "Bluepeak Silver (demo)",
    monthlyCents: 43_000,
    deductibleCents: 350_000,
    coinsurance: 30,
    outOfPocketMaxCents: 800_000,
  },
  {
    carrierId: "demo-lighthouse",
    name: "Lighthouse Silver (demo)",
    monthlyCents: 45_000,
    deductibleCents: 250_000,
    coinsurance: 20,
    outOfPocketMaxCents: 700_000,
  },
  {
    carrierId: "demo-lighthouse",
    name: "Lighthouse Gold (demo)",
    monthlyCents: 56_000,
    deductibleCents: 100_000,
    coinsurance: 20,
    outOfPocketMaxCents: 500_000,
  },
];
