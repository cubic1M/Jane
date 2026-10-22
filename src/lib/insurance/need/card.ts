import type { CardOption, OptionCard } from "@/lib/option-card";
import { formatCents } from "@/lib/money";
import type { OptionSet } from "./options";
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
};

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
