import {
  DEDUCTIBLE_LADDERS,
  DISABILITY_OPTION_SHARES,
  LIABILITY_LEVELS,
  LIFE_OPTION_CHEAPER_SHARE,
  LIFE_OPTION_LONGER_YEARS,
  LIFE_TERMS,
  MAX_OPTIONS,
  OPTION_PICK_CAP,
  PICK_MIN_RATING_SCORE,
  PICK_RATING_PENALTY_PER_POINT,
  UMBRELLA_NEED,
  HIGHER_LIABILITY_NET_WORTH_CENTS,
  type PolicyKind,
} from "@/config/insurance";
import { DISABILITY_PAY_SHARE } from "@/config/benefits";
import { coverageLines, type Coverage } from "@/lib/insurance/coverage";
import { formatCents } from "@/lib/money";
import type { PartnerQuote } from "@/lib/insurance/partner";
import type { Need, NeedLine, NeedPolicy } from "./types";

// Options to pick from (spec step 275). For a need or a policy worth a second look, three or
// four variants of cover are priced by the quote stand-in: like for like, cheaper with a stated
// trade-off, the one that meets the need, and better cover for a stated price. Each comes back
// as the best carrier for that cover with one line on why, and Jane's pick is marked with how
// sure she is. Pure: the IO (asking the partner) is ./options-for.ts. Demo advice only.

export type OptionRole = "like_for_like" | "meets_need" | "cheaper" | "better";

// A variant to ask the stand-in to price.
export type OptionRequest = {
  id: string;
  role: OptionRole;
  kind: PolicyKind;
  coverage: Coverage;
  deductibleCents: number | null;
  // What this variant gives up or adds against the one they have, in words ("a $2,000
  // deductible instead of $1,000"); null for like for like.
  tradeoff: string | null;
};

export type CoverOption = {
  id: string;
  role: OptionRole;
  carrier: string;
  rating: string;
  annualPremiumCents: number;
  premiumFrequency: PartnerQuote["premiumFrequency"];
  premiumCents: number;
  coverage: Coverage;
  deductibleCents: number | null;
  coverLines: string[];
  // One line on why this one.
  whyThisOne: string;
  isPick: boolean;
  partnerQuoteId: string;
  // For "More details": how the carriers compared at this cover.
  details: string[];
};

export type OptionSet = {
  need: Need["kind"];
  policyId: string | null;
  options: CoverOption[];
  pickId: string | null;
  confidence: { percent: number; reason: string } | null;
  // The need's working, for "More details".
  working: NeedLine[];
};

const dedupe = (requests: OptionRequest[]): OptionRequest[] => {
  const seen = new Set<string>();
  return requests.filter((r) => {
    const key = JSON.stringify([r.coverage, r.deductibleCents]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// The variants to price for a need, given the policy it is about (null for a gap with no policy).
export function optionRequests(
  need: Need,
  policy: NeedPolicy | null,
  extra: { yearlyPayCents?: number | null; netWorthCents?: number | null } = {},
): OptionRequest[] {
  const cover = policy?.coverage ?? {};
  const make = (
    id: string,
    role: OptionRole,
    kind: PolicyKind,
    coverage: Coverage,
    deductibleCents: number | null,
    tradeoff: string | null,
  ): OptionRequest => ({ id, role, kind, coverage, deductibleCents, tradeoff });
  const money = formatCents;
  switch (need.kind) {
    case "auto_liability": {
      const tier =
        (extra.netWorthCents ?? 0) >= HIGHER_LIABILITY_NET_WORTH_CENTS
          ? LIABILITY_LEVELS.higher
          : LIABILITY_LEVELS.base;
      const high = LIABILITY_LEVELS.higher;
      const level = (p: number, a: number) => ({
        ...cover,
        bodilyInjuryPerPerson: p,
        bodilyInjuryPerAccident: a,
      });
      const deductible = policy?.deductibleCents ?? null;
      return dedupe([
        make("like", "like_for_like", "auto", cover, deductible, null),
        make(
          "need",
          "meets_need",
          "auto",
          level(tier.autoPerPersonCents, tier.autoPerAccidentCents),
          deductible,
          `${money(tier.autoPerPersonCents)} and ${money(tier.autoPerAccidentCents)} of injury liability`,
        ),
        make(
          "better",
          "better",
          "auto",
          level(high.autoPerPersonCents, high.autoPerAccidentCents),
          deductible,
          `${money(high.autoPerPersonCents)} and ${money(high.autoPerAccidentCents)} of injury liability`,
        ),
      ]).slice(0, MAX_OPTIONS);
    }
    case "home_liability":
    case "renters_liability": {
      const kind = need.kind === "home_liability" ? "home" : "renters";
      const level = (liability: number) => ({ ...cover, liability });
      const high =
        kind === "home" ? LIABILITY_LEVELS.higher.homeCents : LIABILITY_LEVELS.higher.rentersCents;
      return dedupe([
        make("like", "like_for_like", kind, cover, policy?.deductibleCents ?? null, null),
        make(
          "need",
          "meets_need",
          kind,
          level(need.needCents),
          policy?.deductibleCents ?? null,
          `${money(need.needCents)} of liability`,
        ),
        make(
          "better",
          "better",
          kind,
          level(high),
          policy?.deductibleCents ?? null,
          `${money(high)} of liability`,
        ),
      ]).slice(0, MAX_OPTIONS);
    }
    case "deductible": {
      const kind = policy?.kind ?? "auto";
      const ladder = [...(DEDUCTIBLE_LADDERS[kind] ?? [])].sort((a, b) => a - b);
      const have = need.haveCents;
      const higher = ladder.find((s) => s > Math.max(have, need.needCents));
      const lower = [...ladder].reverse().find((s) => s < Math.min(have, need.needCents));
      return dedupe([
        make("like", "like_for_like", kind, cover, have, null),
        make(
          "need",
          "meets_need",
          kind,
          cover,
          need.needCents,
          `a ${money(need.needCents)} deductible`,
        ),
        ...(higher !== undefined
          ? [make("cheaper", "cheaper", kind, cover, higher, `a ${money(higher)} deductible`)]
          : []),
        ...(lower !== undefined
          ? [make("better", "better", kind, cover, lower, `a ${money(lower)} deductible`)]
          : []),
      ]).slice(0, MAX_OPTIONS);
    }
    case "umbrella": {
      const step = UMBRELLA_NEED.stepCents;
      const at = (n: number) => ({ liability: n });
      return dedupe([
        make(
          "need",
          "meets_need",
          "umbrella",
          at(need.needCents),
          null,
          `${money(need.needCents)} above your car and home limits`,
        ),
        ...(need.needCents - step >= UMBRELLA_NEED.minCents
          ? [
              make(
                "cheaper",
                "cheaper",
                "umbrella",
                at(need.needCents - step),
                null,
                `${money(need.needCents - step)}, a million less than I'd size`,
              ),
            ]
          : []),
        make(
          "better",
          "better",
          "umbrella",
          at(Math.min(UMBRELLA_NEED.maxCents, need.needCents + step)),
          null,
          `${money(Math.min(UMBRELLA_NEED.maxCents, need.needCents + step))}, a million more`,
        ),
      ]).slice(0, MAX_OPTIONS);
    }
    case "life": {
      const term = need.termYears ?? LIFE_TERMS[2];
      const longer = LIFE_TERMS.find((t) => t >= term + LIFE_OPTION_LONGER_YEARS);
      const roundTo = 5_000_000;
      const cheaper = Math.round((need.needCents * LIFE_OPTION_CHEAPER_SHARE) / roundTo) * roundTo;
      const life = (deathBenefit: number, termYears: number) => ({ deathBenefit, termYears });
      return dedupe([
        make(
          "need",
          "meets_need",
          "life",
          life(need.needCents, term),
          null,
          `${money(need.needCents)} for ${term} years`,
        ),
        ...(cheaper > 0 && cheaper < need.needCents
          ? [
              make(
                "cheaper",
                "cheaper",
                "life",
                life(cheaper, term),
                null,
                `${money(cheaper)}, a quarter less than I'd size, for ${term} years`,
              ),
            ]
          : []),
        ...(longer !== undefined
          ? [
              make(
                "better",
                "better",
                "life",
                life(need.needCents, longer),
                null,
                `${money(need.needCents)} for ${longer} years`,
              ),
            ]
          : []),
      ]).slice(0, MAX_OPTIONS);
    }
    case "disability": {
      const pay = extra.yearlyPayCents ?? 0;
      const monthly = (share: number) => Math.round((pay * share) / 12);
      const dis = (monthlyBenefit: number) => ({
        monthlyBenefit,
        waitingDays: 90,
        benefitYears: 35,
      });
      const [low, , high] = DISABILITY_OPTION_SHARES;
      return dedupe([
        make(
          "need",
          "meets_need",
          "disability",
          dis(monthly(DISABILITY_PAY_SHARE)),
          null,
          `${money(monthly(DISABILITY_PAY_SHARE))} a month, ${Math.round(DISABILITY_PAY_SHARE * 100)}% of your pay`,
        ),
        make(
          "cheaper",
          "cheaper",
          "disability",
          dis(monthly(low)),
          null,
          `${money(monthly(low))} a month, ${Math.round(low * 100)}% of your pay`,
        ),
        make(
          "better",
          "better",
          "disability",
          dis(monthly(high)),
          null,
          `${money(monthly(high))} a month, ${Math.round(high * 100)}% of your pay`,
        ),
      ]).slice(0, MAX_OPTIONS);
    }
  }
}

const weightedPrice = (q: PartnerQuote) =>
  q.annualPremiumCents * (1 + (100 - q.carrier.ratingScore) * PICK_RATING_PENALTY_PER_POINT);

export type PricedRequest = { request: OptionRequest; quotes: PartnerQuote[] };

// Builds the option cards from what the stand-in priced. Options with no eligible quote are
// dropped. The pick is the option that meets the need (or, for a deductible or a policy with
// no gap, the like-for-like) at the lowest rating-weighted price.
export function buildOptions(
  need: Need,
  priced: readonly PricedRequest[],
  currentAnnualCents: number | null,
  options: { policyId?: string | null; evidence?: { percent: number; reason: string } } = {},
): OptionSet {
  const cards: CoverOption[] = [];
  for (const { request, quotes } of priced) {
    const eligible = quotes
      .filter((q) => q.carrier.ratingScore >= PICK_MIN_RATING_SCORE)
      .sort(
        (a, b) =>
          weightedPrice(a) - weightedPrice(b) || a.carrier.name.localeCompare(b.carrier.name),
      );
    const best = eligible[0];
    if (!best) continue;
    const lines = coverageLines(best.kind, best.coverage);
    cards.push({
      id: request.id,
      role: request.role,
      carrier: best.carrier.name,
      rating: best.carrier.rating,
      annualPremiumCents: best.annualPremiumCents,
      premiumFrequency: best.premiumFrequency,
      premiumCents: best.premiumCents,
      coverage: best.coverage,
      deductibleCents: best.deductibleCents,
      coverLines: [
        ...lines,
        ...(best.deductibleCents !== null
          ? [`Deductible: ${formatCents(best.deductibleCents)}`]
          : []),
      ],
      whyThisOne: whyLine(request, best, currentAnnualCents, eligible.length),
      isPick: false,
      partnerQuoteId: best.partnerQuoteId,
      details: eligible.map(
        (q) =>
          `${q.carrier.name} (rated ${q.carrier.rating}): ${formatCents(q.annualPremiumCents)} a year`,
      ),
    });
  }
  const target =
    cards.find((c) => c.role === "meets_need") ??
    cards.find((c) => c.role === "like_for_like") ??
    cards[0];
  if (target) target.isPick = true;
  const ordered = [...cards].sort((a, b) => Number(b.isPick) - Number(a.isPick));
  const base = options.evidence ?? {
    percent: OPTION_PICK_CAP,
    reason: "your numbers and the stand-in's quotes",
  };
  return {
    need: need.kind,
    policyId: options.policyId ?? need.policyId,
    options: ordered,
    pickId: target?.id ?? null,
    confidence: target
      ? {
          percent: Math.min(base.percent, OPTION_PICK_CAP),
          reason: `${base.reason}; sample prices from the stand-in, not real offers`,
        }
      : null,
    working: need.lines,
  };
}

function whyLine(
  r: OptionRequest,
  q: PartnerQuote,
  currentAnnualCents: number | null,
  carriers: number,
): string {
  const price = formatCents(q.annualPremiumCents);
  const diff = currentAnnualCents === null ? null : q.annualPremiumCents - currentAnnualCents;
  const vs =
    diff === null
      ? ""
      : diff < 0
        ? `, ${formatCents(-diff)} a year less than now`
        : diff > 0
          ? `, ${formatCents(diff)} a year more than now`
          : ", the same as now";
  switch (r.role) {
    case "like_for_like":
      return `Cheapest that keeps your cover as it is: ${price} a year${vs}.`;
    case "meets_need":
      return `Meets the cover I'd size for you${r.tradeoff ? ` (${r.tradeoff})` : ""}: ${price} a year${vs}.`;
    case "cheaper":
      return `Costs less${r.tradeoff ? ` with ${r.tradeoff}` : ""}: ${price} a year${vs}.`;
    case "better":
      return `More cover${r.tradeoff ? `: ${r.tradeoff}` : ""}: ${price} a year${vs}. ${carriers > 1 ? `Lowest of ${carriers} carriers.` : ""}`.trim();
  }
}
