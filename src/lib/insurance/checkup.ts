import {
  BUNDLE_DISCOUNT_SHARE,
  BUSINESS_CAR_USE_YEARLY_CENTS,
  BUSINESS_LIABILITY_TARGET_CENTS,
  BUSINESS_PROFESSIONAL_YEARLY_CENTS,
  DEDUCTIBLE_SAVINGS_MULTIPLE,
  DEMO_PRICING,
  FULL_COVER_MIN_CAR_VALUE_CENTS,
  HOME_OVER_INSURED_SHARE,
  HOME_UNDER_INSURED_SHARE,
  LIABILITY_TARGET_ACCIDENT_CENTS,
  LIABILITY_TARGET_CENTS,
  LIFE_COVER_DEFAULT_CENTS,
  type PolicyKind,
} from "@/config/insurance";
import { sameCompany } from "@/lib/documents/dates";
import { formatCents } from "@/lib/money";
import type { Coverage } from "./coverage";
import { businessGaps } from "./business-rules";
import { basePremium } from "./demo-partner";
import { kindWords } from "./gaps";
import type { Household } from "./household";
import { yearlyPremium, type Policy } from "./policies";

// The coverage checkup (spec step 106): the right amount of cover, by rules. Deductibles
// tuned to the person's savings, too little or too much cover, bundling, and cover that no
// longer fits (full cover on a car worth little), plus life cover after a new baby (spec
// step 100). Each recommendation says what it costs or saves a year, priced by the same
// fixed rules as the stand-in quotes (DEMO_PRICING), and the risk it changes. Pure. It's
// advice: shown in demo advice mode only (spec step 98).

export type CheckupKey =
  // Spec step 201: cover for what they earn on the side.
  | "business_liability"
  | "professional_liability"
  | "car_business_use"
  | "business_equipment"
  | "deductible_up"
  | "deductible_down"
  | "liability_up"
  | "full_cover_old_car"
  | "home_under"
  | "home_over"
  | "bundle"
  | "life_after_baby"
  // Spec step 150: a benefit through work, kept or bought privately instead.
  | "benefit_keep"
  | "benefit_private"
  | "benefit_details";

export type Recommendation = {
  key: CheckupKey;
  policyId: string | null;
  kind: PolicyKind;
  // What to change, as one sentence.
  title: string;
  // What it costs (positive) or saves (negative) a year.
  costCents: number;
  // The cost in words: "Saves about $189.00 a year" or "About $256.00 more a year".
  cost: string;
  // The risk it changes, in plain words.
  risk: string;
  // Every dollar figure in the text, for the guardrails.
  cents: number[];
};

export type CheckupInput = {
  policies: Policy[];
  household: Household;
  // What the person's savings accounts hold, or null when they have none linked.
  savingsCents: number | null;
  // Their own values of the cars and home on /things.
  carValuesCents: number[];
  homeValueCents: number | null;
  // A new baby since the last checkup (a life event, spec step 100).
  newBaby: boolean;
};

const costWords = (cents: number) =>
  cents < 0
    ? `Saves about ${formatCents(-cents)} a year`
    : `About ${formatCents(cents)} more a year`;

// The yearly price change if the policy's cover or deductible became `next`, from the fixed
// pricing rules: today's price times the ratio of the two rule prices. Null when unknown.
function priceChange(
  policy: Policy,
  household: Household,
  next: { coverage?: Coverage; deductibleCents?: number },
): number | null {
  const yearly = yearlyPremium(policy);
  if (yearly === null) return null;
  const facts = {
    state: null,
    household: {
      housing: household.housing.value,
      vehicles: household.vehicles.value,
      dependants: household.dependants.value,
      pets: household.pets.value,
    },
  };
  const deductible = policy.deductibleCents ?? DEMO_PRICING.defaultDeductibleCents;
  const before = basePremium(policy.kind, policy.coverage, deductible, facts);
  const after = basePremium(
    policy.kind,
    { ...policy.coverage, ...next.coverage },
    next.deductibleCents ?? deductible,
    facts,
  );
  if (!before || after === null) return null;
  return Math.round(yearly * (after / before - 1));
}

const DEDUCTIBLES = DEMO_PRICING.deductibleFactors.map((d) => d.cents);
const DEDUCTIBLE_KINDS: readonly PolicyKind[] = ["auto", "home", "renters"];

function deductibles(input: CheckupInput, policy: Policy): Recommendation[] {
  const current = policy.deductibleCents;
  const savings = input.savingsCents;
  if (current === null || savings === null || !DEDUCTIBLE_KINDS.includes(policy.kind)) return [];
  const name = `${policy.carrier} ${kindWords(policy.kind)}`;
  const higher = DEDUCTIBLES.find((d) => d > current);
  if (higher !== undefined && savings >= higher * DEDUCTIBLE_SAVINGS_MULTIPLE) {
    const change = priceChange(policy, input.household, { deductibleCents: higher });
    if (change !== null && change < 0) {
      return [
        {
          key: "deductible_up",
          policyId: policy.id,
          kind: policy.kind,
          title: `Raise the deductible on your ${name} to ${formatCents(higher)}.`,
          costCents: change,
          cost: costWords(change),
          risk: `On a claim you'd pay up to ${formatCents(higher - current)} more yourself (${formatCents(higher)} instead of ${formatCents(current)}). Your savings (${formatCents(savings)}) cover that more than ${DEDUCTIBLE_SAVINGS_MULTIPLE} times over.`,
          cents: [higher, current, higher - current, savings, -change],
        },
      ];
    }
  }
  const lower = [...DEDUCTIBLES].reverse().find((d) => d < current);
  if (lower !== undefined && savings < current) {
    const change = priceChange(policy, input.household, { deductibleCents: lower });
    if (change !== null && change > 0) {
      return [
        {
          key: "deductible_down",
          policyId: policy.id,
          kind: policy.kind,
          title: `Lower the deductible on your ${name} to ${formatCents(lower)}.`,
          costCents: change,
          cost: costWords(change),
          risk: `A claim would cost you at most ${formatCents(lower)} instead of ${formatCents(current)}, which your savings (${formatCents(savings)}) can cover. Today they couldn't.`,
          cents: [lower, current, savings, change],
        },
      ];
    }
  }
  return [];
}

function carCover(input: CheckupInput, policy: Policy): Recommendation[] {
  if (policy.kind !== "auto") return [];
  const recs: Recommendation[] = [];
  const name = `${policy.carrier} car insurance`;
  const perPerson = policy.coverage.bodilyInjuryPerPerson;
  if (typeof perPerson === "number" && perPerson < LIABILITY_TARGET_CENTS) {
    const change = priceChange(policy, input.household, {
      coverage: {
        bodilyInjuryPerPerson: LIABILITY_TARGET_CENTS,
        bodilyInjuryPerAccident: LIABILITY_TARGET_ACCIDENT_CENTS,
      },
    });
    if (change !== null) {
      recs.push({
        key: "liability_up",
        policyId: policy.id,
        kind: "auto",
        title: `Raise the injury cover on your ${name} to ${formatCents(LIABILITY_TARGET_CENTS)} a person and ${formatCents(LIABILITY_TARGET_ACCIDENT_CENTS)} an accident.`,
        costCents: change,
        cost: costWords(change),
        risk: `If you cause an accident, injuries above ${formatCents(perPerson)} a person are yours to pay today. This covers up to ${formatCents(LIABILITY_TARGET_CENTS)}.`,
        cents: [
          LIABILITY_TARGET_CENTS,
          LIABILITY_TARGET_ACCIDENT_CENTS,
          perPerson,
          Math.abs(change),
        ],
      });
    }
  }
  const carValue = input.carValuesCents.length > 0 ? Math.max(...input.carValuesCents) : null;
  if (
    carValue !== null &&
    carValue < FULL_COVER_MIN_CAR_VALUE_CENTS &&
    policy.coverage.collision === true &&
    policy.coverage.comprehensive === true
  ) {
    const change = priceChange(policy, input.household, {
      coverage: { collision: false, comprehensive: false },
    });
    if (change !== null && change < 0) {
      recs.push({
        key: "full_cover_old_car",
        policyId: policy.id,
        kind: "auto",
        title: `Drop collision and comprehensive from your ${name}.`,
        costCents: change,
        cost: costWords(change),
        risk: `If your car is damaged or stolen, you'd pay to fix or replace it yourself. By your value it's worth about ${formatCents(carValue)}, not much more than this cover costs in a few years.`,
        cents: [carValue, -change],
      });
    }
  }
  return recs;
}

function homeCover(input: CheckupInput, policy: Policy): Recommendation[] {
  const value = input.homeValueCents;
  const dwelling = policy.coverage.dwelling;
  if (policy.kind !== "home" || value === null || typeof dwelling !== "number") return [];
  const name = `${policy.carrier} home insurance`;
  const change = priceChange(policy, input.household, { coverage: { dwelling: value } });
  if (change === null) return [];
  if (dwelling < value * HOME_UNDER_INSURED_SHARE) {
    return [
      {
        key: "home_under",
        policyId: policy.id,
        kind: "home",
        title: `Raise the cover on the home itself in your ${name} to ${formatCents(value)}.`,
        costCents: change,
        cost: costWords(change),
        risk: `If your home were destroyed, the policy would pay at most ${formatCents(dwelling)} toward rebuilding it, well under its ${formatCents(value)} value.`,
        cents: [value, dwelling, Math.abs(change)],
      },
    ];
  }
  if (dwelling > value * HOME_OVER_INSURED_SHARE) {
    return [
      {
        key: "home_over",
        policyId: policy.id,
        kind: "home",
        title: `Lower the cover on the home itself in your ${name} to ${formatCents(value)}.`,
        costCents: change,
        cost: costWords(change),
        risk: `You're insured for ${formatCents(dwelling)}, far more than the ${formatCents(value)} the home is worth. Check what rebuilding would really cost first: that's what the cover is for.`,
        cents: [value, dwelling, Math.abs(change)],
      },
    ];
  }
  return [];
}

function bundle(input: CheckupInput): Recommendation[] {
  const car = input.policies.find((p) => p.kind === "auto");
  const place = input.policies.find((p) => p.kind === "home" || p.kind === "renters");
  if (!car || !place || sameCompany(car.carrier, place.carrier)) return [];
  const carYear = yearlyPremium(car);
  const placeYear = yearlyPremium(place);
  if (carYear === null || placeYear === null) return [];
  const saving = Math.round((carYear + placeYear) * BUNDLE_DISCOUNT_SHARE);
  return [
    {
      key: "bundle",
      policyId: null,
      kind: place.kind,
      title: `Put your car and ${kindWords(place.kind)} with one carrier.`,
      costCents: -saving,
      cost: costWords(-saving),
      risk: `The same cover, with one company for both and one place to claim. Carriers usually take about ${Math.round(BUNDLE_DISCOUNT_SHARE * 100)} percent off a bundle; I'll check it with quotes before anything changes.`,
      cents: [saving],
    },
  ];
}

function lifeAfterBaby(input: CheckupInput): Recommendation[] {
  if (!input.newBaby || input.policies.some((p) => p.kind === "life")) return [];
  const p = DEMO_PRICING.life;
  const cost = Math.round(
    (LIFE_COVER_DEFAULT_CENTS / 100_000) * p.perThousandCents * p.termFactors[p.defaults.termYears],
  );
  return [
    {
      key: "life_after_baby",
      policyId: null,
      kind: "life",
      title: `Add ${p.defaults.termYears}-year term life insurance of ${formatCents(LIFE_COVER_DEFAULT_CENTS)}.`,
      costCents: cost,
      cost: costWords(cost),
      risk: `With a new baby, someone depends on your income. If you died, it would pay ${formatCents(LIFE_COVER_DEFAULT_CENTS)} to them; today nothing would.`,
      cents: [LIFE_COVER_DEFAULT_CENTS, cost],
    },
  ];
}

// Spec step 201: each business gap as a recommendation, priced by the same fixed rules as the
// stand-in quotes. Business cover is never assumed to come from a personal policy.
function businessCover(input: CheckupInput): Recommendation[] {
  const facts = {
    state: null,
    household: {
      housing: input.household.housing.value,
      vehicles: input.household.vehicles.value,
      dependants: input.household.dependants.value,
      pets: input.household.pets.value,
    },
  };
  const price = (key: string): number => {
    if (key === "business_liability" || key === "business_equipment") {
      return Math.round(
        basePremium("business", {}, DEMO_PRICING.defaultDeductibleCents, facts) ??
          DEMO_PRICING.business.baseCents,
      );
    }
    return key === "professional_liability"
      ? BUSINESS_PROFESSIONAL_YEARLY_CENTS
      : BUSINESS_CAR_USE_YEARLY_CENTS;
  };
  const words: Record<string, { title: string; kind: PolicyKind }> = {
    business_liability: {
      title: `Add general liability insurance of ${formatCents(BUSINESS_LIABILITY_TARGET_CENTS)}.`,
      kind: "business",
    },
    professional_liability: { title: "Add professional liability insurance.", kind: "business" },
    car_business_use: { title: "Add business use to your car insurance.", kind: "auto" },
    business_equipment: {
      title: "Add business property cover for your equipment.",
      kind: "business",
    },
  };
  return businessGaps(input.household.signals.selfEmployment, input.policies).flatMap(
    (gap): Recommendation[] => {
      const rule = words[gap.key];
      if (!rule) return [];
      const cost = price(gap.key);
      return [
        {
          key: gap.key as CheckupKey,
          policyId: gap.policyId,
          kind: rule.kind,
          title: rule.title,
          costCents: cost,
          cost: costWords(cost),
          risk: gap.why,
          cents: [
            cost,
            ...gap.cents,
            ...(gap.key === "business_liability" ? [BUSINESS_LIABILITY_TARGET_CENTS] : []),
          ],
        },
      ];
    },
  );
}

export function coverageCheckup(input: CheckupInput): Recommendation[] {
  const active = { ...input, policies: input.policies.filter((p) => p.status === "active") };
  return [
    ...active.policies.flatMap((p) => [
      ...deductibles(active, p),
      ...carCover(active, p),
      ...homeCover(active, p),
    ]),
    ...bundle(active),
    ...lifeAfterBaby(active),
    ...businessCover(active),
  ];
}
