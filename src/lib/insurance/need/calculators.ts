import { DISABILITY_PAY_SHARE } from "@/config/benefits";
import {
  DEDUCTIBLE_CASH_SHARE,
  DEDUCTIBLE_LADDERS,
  DISABILITY_NEED,
  HIGHER_LIABILITY_NET_WORTH_CENTS,
  LIABILITY_LEVELS,
  UMBRELLA_ASSETS_CENTS,
  UMBRELLA_NEED,
} from "@/config/insurance";
import { lifeNeed } from "@/lib/insurance/life-need";
import { formatCents } from "@/lib/money";
import type { Need, NeedInput, NeedLine, NeedPolicy } from "./types";

// The need calculators (spec step 274). Each is pure: the person's numbers in, the need, what
// they have and the gap out, with the working. Every threshold is in src/config/insurance.ts.
// Demo advice only: the caller shows these as advice or as facts, never buys anything.

const num = (v: number | boolean | undefined) => (typeof v === "number" ? v : 0);
const live = (p: NeedPolicy) => p.status === "active" || p.status === "pending";
const of = (input: NeedInput, kind: NeedPolicy["kind"]) =>
  input.policies.filter((p) => p.kind === kind && live(p));
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function empty(
  kind: Need["kind"],
  unit: Need["unit"],
  summary: string,
  policyId: string | null = null,
): Need {
  return {
    kind,
    applies: false,
    unit,
    needCents: 0,
    haveCents: 0,
    gapCents: 0,
    lines: [],
    summary,
    policyId,
  };
}

// Term life: income replaced, debts, schooling, less savings and cover in place (the method
// of src/lib/insurance/life-need.ts, the same one the life-cover page uses).
export function lifeNeedFor(input: NeedInput): Need {
  const policyCover = sum(of(input, "life").map((p) => num(p.coverage.deathBenefit)));
  const have = policyCover + input.workLifeCoverCents;
  if (input.dependants <= 0) {
    return empty(
      "life",
      "total",
      "Nobody depends on your income, so I don't see a life-cover need.",
    );
  }
  if (!input.yearlyPayCents) {
    return empty("life", "total", "I need your pay to size life cover.");
  }
  const need = lifeNeed({
    yearlyPayCents: input.yearlyPayCents,
    dependants: input.dependants,
    mortgageCents: input.mortgageCents,
    otherDebtCents: input.otherDebtCents,
    mortgageYearsLeft: input.mortgageYearsLeft,
    savingsCents: input.savingsCents,
    existingCoverCents: have,
  });
  if (!need) {
    return {
      ...empty(
        "life",
        "total",
        `Your savings and the ${formatCents(have)} of life cover you have are enough.`,
      ),
      applies: true,
      haveCents: have,
      needCents: have,
    };
  }
  return {
    kind: "life",
    applies: true,
    unit: "total",
    needCents: need.amountCents + have,
    haveCents: have,
    gapCents: need.amountCents,
    lines: need.lines,
    summary: `${formatCents(need.amountCents + have)} of life cover, ${have > 0 ? `${formatCents(have)} of it in place, ` : ""}for ${need.termYears} years: ${formatCents(need.amountCents)} short.`,
    policyId: null,
    termYears: need.termYears,
  };
}

// Disability: a policy should pay about DISABILITY_PAY_SHARE of pay each month.
export function disabilityNeedFor(input: NeedInput): Need {
  if (!input.yearlyPayCents) {
    return empty("disability", "per_month", "I need your pay to size disability cover.");
  }
  const need = Math.round((input.yearlyPayCents * DISABILITY_PAY_SHARE) / 12);
  const have = sum(of(input, "disability").map((p) => num(p.coverage.monthlyBenefit)));
  const lines: NeedLine[] = [
    {
      label: `${Math.round(DISABILITY_PAY_SHARE * 100)}% of your monthly pay`,
      cents: need,
      adds: true,
    },
  ];
  if (have > 0) lines.push({ label: "Less what your policy pays", cents: have, adds: false });
  const gap = Math.max(0, need - have);
  return {
    kind: "disability",
    applies: true,
    unit: "per_month",
    needCents: need,
    haveCents: have,
    gapCents: gap,
    lines,
    summary:
      gap > 0
        ? `A benefit of ${formatCents(need)} a month, after a ${DISABILITY_NEED.waitingDays}-day wait, until ${DISABILITY_NEED.benefitUntilAge}: ${formatCents(gap)} a month short.`
        : `Your disability cover pays ${formatCents(have)} a month, enough for ${formatCents(need)}.`,
    policyId: null,
  };
}

// Umbrella: net worth over the liability limits on car and home, in steps of a million.
export function umbrellaNeedFor(input: NeedInput): Need {
  const worth = input.netWorthCents;
  if (worth === null)
    return empty("umbrella", "total", "I need your net worth to size an umbrella.");
  if (worth < UMBRELLA_ASSETS_CENTS) {
    return empty(
      "umbrella",
      "total",
      `Your net worth is about ${formatCents(worth)}, under the ${formatCents(UMBRELLA_ASSETS_CENTS)} where an umbrella usually matters.`,
    );
  }
  const limits =
    sum(of(input, "auto").map((p) => num(p.coverage.bodilyInjuryPerAccident))) +
    sum(of(input, "home").map((p) => num(p.coverage.liability)));
  const raw = Math.max(0, worth - limits);
  const stepped = Math.ceil(raw / UMBRELLA_NEED.stepCents) * UMBRELLA_NEED.stepCents;
  const need = Math.min(UMBRELLA_NEED.maxCents, Math.max(UMBRELLA_NEED.minCents, stepped));
  const have = sum(of(input, "umbrella").map((p) => num(p.coverage.liability)));
  const lines: NeedLine[] = [{ label: "Your net worth", cents: worth, adds: true }];
  if (limits > 0)
    lines.push({
      label: "Less the liability limits on your car and home",
      cents: limits,
      adds: false,
    });
  const gap = Math.max(0, need - have);
  return {
    kind: "umbrella",
    applies: true,
    unit: "total",
    needCents: need,
    haveCents: have,
    gapCents: gap,
    lines,
    summary:
      gap > 0
        ? `An umbrella of ${formatCents(need)} above your car and home limits: ${formatCents(gap)} short.`
        : `Your ${formatCents(have)} umbrella covers the ${formatCents(need)} I'd size.`,
    policyId: null,
  };
}

// Deductible: the largest step on the ladder the cash cushion carries.
export function deductibleNeedsFor(input: NeedInput): Need[] {
  return input.policies.flatMap((p): Need[] => {
    const ladder = DEDUCTIBLE_LADDERS[p.kind];
    if (!ladder || !live(p) || p.deductibleCents === null) return [];
    const carry = input.cashCents * DEDUCTIBLE_CASH_SHARE;
    const fits = [...ladder].filter((step) => step <= carry);
    const recommended = fits.length > 0 ? Math.max(...fits) : Math.min(...ladder);
    const have = p.deductibleCents;
    const direction = recommended > have ? "raise" : recommended < have ? "lower" : "ok";
    return [
      {
        kind: "deductible",
        applies: true,
        unit: "total",
        needCents: recommended,
        haveCents: have,
        gapCents: Math.abs(recommended - have),
        direction,
        lines: [
          { label: "Your cash in the bank", cents: input.cashCents, adds: true },
          {
            label: `The most a claim should take: ${Math.round(DEDUCTIBLE_CASH_SHARE * 100)}% of it`,
            cents: Math.round(carry),
            adds: true,
          },
        ],
        summary:
          direction === "raise"
            ? `Your cash carries a ${formatCents(recommended)} deductible, ${formatCents(recommended - have)} more than your ${formatCents(have)}, which would lower the price.`
            : direction === "lower"
              ? `A ${formatCents(have)} deductible is more than your cash comfortably carries; ${formatCents(recommended)} fits.`
              : `Your ${formatCents(have)} deductible fits your cash.`,
        policyId: p.id,
      },
    ];
  });
}

// Liability levels for the policies they have, by net worth tier.
export function liabilityNeedsFor(input: NeedInput): Need[] {
  const tier =
    (input.netWorthCents ?? 0) >= HIGHER_LIABILITY_NET_WORTH_CENTS
      ? LIABILITY_LEVELS.higher
      : LIABILITY_LEVELS.base;
  const out: Need[] = [];
  for (const p of input.policies.filter(live)) {
    if (p.kind === "auto") {
      const per = num(p.coverage.bodilyInjuryPerPerson);
      const acc = num(p.coverage.bodilyInjuryPerAccident);
      const gap = Math.max(tier.autoPerAccidentCents - acc, tier.autoPerPersonCents - per, 0);
      out.push({
        kind: "auto_liability",
        applies: true,
        unit: "total",
        needCents: tier.autoPerAccidentCents,
        haveCents: acc,
        gapCents: gap,
        lines: [
          { label: "Injury liability per person", cents: tier.autoPerPersonCents, adds: true },
          { label: "Injury liability per accident", cents: tier.autoPerAccidentCents, adds: true },
        ],
        summary:
          gap > 0
            ? `Injury liability of ${formatCents(tier.autoPerPersonCents)} per person and ${formatCents(tier.autoPerAccidentCents)} per accident; yours is ${formatCents(per)} and ${formatCents(acc)}.`
            : `Your ${formatCents(per)} and ${formatCents(acc)} injury liability meets the ${formatCents(tier.autoPerPersonCents)} and ${formatCents(tier.autoPerAccidentCents)} I'd size.`,
        policyId: p.id,
      });
    } else if (p.kind === "home" || p.kind === "renters") {
      const need = p.kind === "home" ? tier.homeCents : tier.rentersCents;
      const have = num(p.coverage.liability);
      out.push({
        kind: p.kind === "home" ? "home_liability" : "renters_liability",
        applies: true,
        unit: "total",
        needCents: need,
        haveCents: have,
        gapCents: Math.max(0, need - have),
        lines: [
          { label: `${p.kind === "home" ? "Home" : "Renters"} liability`, cents: need, adds: true },
        ],
        summary:
          have >= need
            ? `Your ${formatCents(have)} of liability meets the ${formatCents(need)} I'd size.`
            : `Liability of ${formatCents(need)}; yours is ${formatCents(have)}.`,
        policyId: p.id,
      });
    }
  }
  return out;
}

// Every need that applies to this person, in the order they're shown.
export function computeNeeds(input: NeedInput): Need[] {
  return [
    lifeNeedFor(input),
    disabilityNeedFor(input),
    umbrellaNeedFor(input),
    ...liabilityNeedsFor(input),
    ...deductibleNeedsFor(input),
  ].filter((n) => n.applies);
}
