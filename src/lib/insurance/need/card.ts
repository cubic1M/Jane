import type { CardOption, OptionCard, OptionCompare } from "@/lib/option-card";
import type { Coverage } from "@/lib/insurance/coverage";
import { formatCents } from "@/lib/money";
import type { CoverOption, OptionRole, OptionSet } from "./options";
import type { Need } from "./types";

// An option set as the shared pick-one card (spec step 276). Her pick and its confidence are
// part of demo advice: a real account gets the options and no pick.

const TITLES: Record<Need["kind"], string> = {
  life: "Choose your life cover",
  disability: "Choose your disability cover",
  umbrella: "Choose your umbrella cover",
  deductible: "Choose your deductible",
  auto_liability: "Choose your car's injury liability",
  home_liability: "Choose your home liability",
  renters_liability: "Choose your renters liability",
  business_liability: "Choose your business liability cover",
  professional_liability: "Choose your professional liability cover",
  business_equipment: "Choose cover for your work equipment",
};

const dollars = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));

const num = (c: Coverage, key: string) => (typeof c[key] === "number" ? (c[key] as number) : 0);

// The one amount of cover the need is about, and how it reads: "$500,000 for 20 years".
// Within one card the options differ in this (or, for a deductible, in the deductible alone).
function coverOf(kind: Need["kind"], c: Coverage): { text: string; amount: number } {
  switch (kind) {
    case "life":
      return {
        text: `${dollars(num(c, "deathBenefit"))} for ${num(c, "termYears")} years`,
        amount: num(c, "deathBenefit") + num(c, "termYears"),
      };
    case "disability":
      return {
        text: `${dollars(num(c, "monthlyBenefit"))} a month`,
        amount: num(c, "monthlyBenefit"),
      };
    case "auto_liability":
      return {
        text: `${dollars(num(c, "bodilyInjuryPerPerson"))} / ${dollars(num(c, "bodilyInjuryPerAccident"))}`,
        amount: num(c, "bodilyInjuryPerPerson") + num(c, "bodilyInjuryPerAccident"),
      };
    case "business_liability":
      return { text: dollars(num(c, "generalLiability")), amount: num(c, "generalLiability") };
    case "professional_liability":
      return {
        text: dollars(num(c, "professionalLiability")),
        amount: num(c, "professionalLiability"),
      };
    case "business_equipment":
      return { text: dollars(num(c, "businessProperty")), amount: num(c, "businessProperty") };
    case "deductible":
      return { text: "Your current cover", amount: 0 };
    default:
      return { text: `${dollars(num(c, "liability"))} liability`, amount: num(c, "liability") };
  }
}

// Who each option suits, for the comparison cards (src/lib/comparison.ts).
const BEST_FOR: Record<OptionRole, string> = {
  like_for_like: "Best for keeping what you have",
  meets_need: "Best for the cover you need",
  cheaper: "Best for a lower bill",
  better: "Best for more cover",
};

function compareOf(o: CoverOption, kind: Need["kind"]): OptionCompare {
  const cover = coverOf(kind, o.coverage);
  return {
    monthlyCents: Math.round(o.annualPremiumCents / 12),
    totalCents: o.annualPremiumCents,
    // A lower deductible is more cover when the amount of cover is the same.
    coverScore: cover.amount - (o.deductibleCents ?? 0) / 1_000,
    payoffMonths: null,
    rows: [
      { key: "cover", label: "Cover", value: cover.text },
      {
        key: "deductible",
        label: "Deductible",
        value: o.deductibleCents === null ? "none" : dollars(o.deductibleCents),
      },
      { key: "year", label: "A year", value: dollars(o.annualPremiumCents) },
      { key: "rated", label: "Rated", value: o.rating },
    ],
    bestFor: BEST_FOR[o.role],
  };
}

export function insuranceCard(set: OptionSet, need: Need, advice: boolean): OptionCard {
  const options: CardOption[] = set.options.map((o) => {
    const pick = advice && o.isPick;
    return {
      id: o.id,
      label: `${o.carrier} (rated ${o.rating})`,
      headline: `${o.carrier}, ${formatCents(o.annualPremiumCents)} a year`,
      priceCents: o.annualPremiumCents,
      pricePeriod: "year",
      facts: o.coverLines,
      whyThisOne: o.whyThisOne,
      isPick: pick,
      ...(pick && set.confidence ? { confidence: set.confidence } : {}),
      details: [
        ...need.lines.map((l) => `${l.adds ? "+" : "−"} ${formatCents(l.cents)}: ${l.label}`),
        ...o.details,
      ],
      compare: compareOf(o, need.kind),
    };
  });
  // Her pick first, the rest as priced.
  options.sort((a, b) => Number(b.isPick) - Number(a.isPick));
  return {
    kind: "insurance",
    title: TITLES[need.kind],
    topic: need.kind,
    newCover: set.policyId === null,
    options,
    advice,
  };
}
