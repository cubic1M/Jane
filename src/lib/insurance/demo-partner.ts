import { createHash } from "node:crypto";
import { PREMIUM_FREQUENCIES } from "@/config/documents";
import {
  COVERAGE_FIELDS,
  DEFAULT_TERM_MONTHS,
  DEMO_CLAIM_DAYS,
  DEMO_ENDORSEMENT_FACTORS,
  DEMO_NEGOTIATE,
  DEMO_PRICING,
  HEALTH_EXTRA_PERSON_SHARE,
  LIFE_OFFER_DAYS,
  QUOTE_VALID_DAYS,
  type PolicyKind,
} from "@/config/insurance";
import {
  DEMO_CARRIERS,
  DEMO_HEALTH_PLANS,
  type DemoCarrier,
} from "@/data-sources/demo/demo-carriers";
import type { Coverage } from "./coverage";
import { standInDecision } from "./life-underwriting";
import type { InsurancePartner, PartnerQuote, QuoteCarrier, QuoteRequest } from "./partner";

// The stand-in insurance partner (spec step 103): quotes from the made-up carrier catalog,
// priced by DEMO_PRICING's fixed rules from the person's profile. Binding issues a demo
// policy number and declarations page, the first payment counts as paid on the start day,
// and cancelling is confirmed at once. Deterministic: the same request gives the same
// quotes. Every quote says demo: true.

const DAY_MS = 86_400_000;

// Kinds quoted without a deductible.
const NO_DEDUCTIBLE: readonly PolicyKind[] = ["life", "disability", "umbrella", "travel", "device"];

const carrierOf = (c: DemoCarrier): QuoteCarrier => ({
  id: c.id,
  name: c.name,
  rating: c.rating,
  ratingScore: c.ratingScore,
  claimsPhone: c.claimsPhone,
  claimsUrl: c.claimsUrl,
});

const num = (v: number | boolean | undefined, fallback: number) =>
  typeof v === "number" ? v : fallback;
const yes = (v: number | boolean | undefined, fallback: boolean) =>
  typeof v === "boolean" ? v : fallback;

// The cover a carrier quotes: what was asked for, its defaults for anything not said, minus
// what its policy leaves out and within its caps.
export function quotedCoverage(kind: PolicyKind, asked: Coverage, carrier: DemoCarrier): Coverage {
  const defaults = (DEMO_PRICING as unknown as Record<string, { defaults?: Coverage }>)[kind]
    ?.defaults;
  const coverage: Coverage = { ...defaults, ...asked };
  for (const key of carrier.excludes ?? []) {
    if (key in coverage) coverage[key] = false;
  }
  for (const [key, cap] of Object.entries(carrier.caps ?? {})) {
    if (typeof coverage[key] === "number") coverage[key] = Math.min(coverage[key] as number, cap);
  }
  // Only the fields this kind has.
  return Object.fromEntries(
    COVERAGE_FIELDS[kind].flatMap((f) => (f.key in coverage ? [[f.key, coverage[f.key]]] : [])),
  );
}

// The deductible offered nearest to the one asked for (the lower on a tie).
export function nearestDeductible(asked: number | null, offered: readonly number[]): number {
  const want = asked ?? DEMO_PRICING.defaultDeductibleCents;
  return [...offered].sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || a - b)[0];
}

function deductibleFactor(cents: number): number {
  return [...DEMO_PRICING.deductibleFactors].sort(
    (a, b) => Math.abs(a.cents - cents) - Math.abs(b.cents - cents),
  )[0].factor;
}

// Pure: what a policy costs a year before the carrier's own factor.
export function basePremium(
  kind: PolicyKind,
  coverage: Coverage,
  deductibleCents: number,
  request: Pick<QuoteRequest, "state" | "household">,
): number | null {
  const state = (request.state && DEMO_PRICING.stateFactors[request.state]) || 1;
  const deductible = deductibleFactor(deductibleCents);
  switch (kind) {
    case "auto": {
      const p = DEMO_PRICING.auto;
      const cars = Math.max(1, request.household.vehicles ?? 1);
      const perPerson = num(coverage.bodilyInjuryPerPerson, p.defaults.bodilyInjuryPerPerson);
      const level = p.liabilityLevels.find((l) => perPerson >= l.atLeastCents)!.factor;
      const extras =
        1 +
        (yes(coverage.collision, false) ? p.collision : 0) +
        (yes(coverage.comprehensive, false) ? p.comprehensive : 0) +
        (yes(coverage.uninsuredMotorist, false) ? p.uninsuredMotorist : 0);
      return p.perVehicle * cars * level * extras * deductible * state;
    }
    case "home": {
      const p = DEMO_PRICING.home;
      const dwelling = num(coverage.dwelling, p.defaults.dwelling);
      const liability = num(coverage.liability, p.defaults.liability);
      const high = liability >= p.highLiabilityCents ? p.highLiabilityFactor : 1;
      return ((dwelling * p.dwellingBps) / 10_000) * high * deductible * state;
    }
    case "renters": {
      const p = DEMO_PRICING.renters;
      const things = num(coverage.personalProperty, p.defaults.personalProperty);
      const liability = num(coverage.liability, p.defaults.liability);
      const high = liability >= p.highLiabilityCents ? p.highLiabilityFactor : 1;
      return (p.base + (things * p.personalPropertyBps) / 10_000) * high * deductible * state;
    }
    case "life": {
      const p = DEMO_PRICING.life;
      const benefit = num(coverage.deathBenefit, p.defaults.deathBenefit);
      const years = num(coverage.termYears, p.defaults.termYears);
      const term =
        p.termFactors[years] ??
        p.termFactors[
          Number(
            Object.keys(p.termFactors).sort(
              (a, b) => Math.abs(Number(a) - years) - Math.abs(Number(b) - years),
            )[0],
          )
        ];
      // Life cover has no deductible or state factor here.
      return (benefit / 100_000) * p.perThousandCents * term;
    }
    case "pet": {
      const p = DEMO_PRICING.pet;
      const pets = Math.max(1, request.household.pets ?? 1);
      const share = num(coverage.reimbursement, p.defaults.reimbursement);
      return p.perPet * pets * (p.reimbursementFactors[share] ?? 1) * deductible;
    }
    // Spec step 149.
    case "disability": {
      const p = DEMO_PRICING.disability;
      const monthly = num(coverage.monthlyBenefit, p.defaults.monthlyBenefit);
      const wait = num(coverage.waitingDays, p.defaults.waitingDays);
      const factor =
        p.waitingFactors[wait] ??
        p.waitingFactors[
          Number(
            Object.keys(p.waitingFactors).sort(
              (a, b) => Math.abs(Number(a) - wait) - Math.abs(Number(b) - wait),
            )[0],
          )
        ];
      return (monthly / 10_000) * p.perHundredMonthlyCents * factor;
    }
    case "umbrella": {
      const p = DEMO_PRICING.umbrella;
      return (
        (num(coverage.liability, p.defaults.liability) / 100_000_000) * p.perMillionCents * state
      );
    }
    case "travel": {
      const p = DEMO_PRICING.travel;
      return (num(coverage.tripCost, p.defaults.tripCost) * p.tripCostBps) / 10_000;
    }
    case "device":
      return DEMO_PRICING.device.perDeviceCents;
    default:
      return null;
  }
}

// Spec step 149: the stand-in marketplace's health plans, priced for the household (one
// person, and HEALTH_EXTRA_PERSON_SHARE more for each dependant).
function healthQuotes(request: QuoteRequest, perYear: number, expiresAt: string): PartnerQuote[] {
  const people = 1 + Math.max(0, request.household.dependants ?? 0);
  return DEMO_HEALTH_PLANS.flatMap((plan): PartnerQuote[] => {
    const carrier = DEMO_CARRIERS.find((c) => c.id === plan.carrierId);
    if (!carrier) return [];
    const yearly = plan.monthlyCents * 12 * (1 + (people - 1) * HEALTH_EXTRA_PERSON_SHARE);
    const premiumCents = Math.round(yearly / perYear / 100) * 100;
    return [
      {
        partnerQuoteId: `demo-q-${hashOf(plan.name, request)}`,
        carrier: carrierOf(carrier),
        plan: plan.name,
        kind: "health",
        annualPremiumCents: premiumCents * perYear,
        premiumCents,
        premiumFrequency: request.premiumFrequency,
        termMonths: DEFAULT_TERM_MONTHS,
        deductibleCents: plan.deductibleCents,
        coverage: { outOfPocketMax: plan.outOfPocketMaxCents, coinsurance: plan.coinsurance },
        expiresAt,
        demo: true,
      },
    ];
  }).sort((a, b) => a.annualPremiumCents - b.annualPremiumCents);
}

const hashOf = (...parts: unknown[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 12);

export const demoPartner: InsurancePartner = {
  name: "demo",
  demo: true,

  async quote(request, { now }) {
    const perYear = PREMIUM_FREQUENCIES[request.premiumFrequency].perYear;
    const expiresAt = new Date(now.getTime() + QUOTE_VALID_DAYS * DAY_MS).toISOString();
    if (request.kind === "health") return healthQuotes(request, perYear, expiresAt);
    const quotes: PartnerQuote[] = [];
    for (const carrier of DEMO_CARRIERS) {
      const factor = carrier.kinds[request.kind];
      if (factor === undefined) continue;
      const coverage = quotedCoverage(request.kind, request.coverage, carrier);
      const deductibleCents = NO_DEDUCTIBLE.includes(request.kind)
        ? null
        : nearestDeductible(request.deductibleCents, carrier.deductibles);
      const base = basePremium(request.kind, coverage, deductibleCents ?? 0, request);
      if (base === null) continue;
      // Rounded to whole dollars a payment, as carriers bill.
      const premiumCents = Math.round((base * factor) / perYear / 100) * 100;
      quotes.push({
        partnerQuoteId: `demo-q-${carrier.id}-${hashOf(request, carrier.id)}`,
        carrier: carrierOf(carrier),
        kind: request.kind,
        annualPremiumCents: premiumCents * perYear,
        premiumCents,
        premiumFrequency: request.premiumFrequency,
        termMonths: request.kind === "life" ? 12 : DEFAULT_TERM_MONTHS,
        deductibleCents,
        coverage,
        expiresAt,
        demo: true,
      });
    }
    return quotes.sort((a, b) => a.annualPremiumCents - b.annualPremiumCents);
  },

  async bind(quote, { startDate, holderName }) {
    const policyNumber = `DEMO-${quote.carrier.id.replace(/^demo-/, "").toUpperCase()}-${hashOf(quote.partnerQuoteId, startDate).slice(0, 8).toUpperCase()}`;
    return {
      policyNumber,
      carrier: quote.carrier,
      startDate,
      firstPaymentCents: quote.premiumCents,
      documents: [
        {
          title: `${quote.carrier.name} declarations page`,
          text: [
            "DEMO POLICY: sample data from Jane's stand-in carrier catalog. Not real insurance.",
            `Carrier: ${quote.carrier.name}`,
            `Policy number: ${policyNumber}`,
            `Named insured: ${holderName ?? "Policyholder"}`,
            `Starts: ${startDate}`,
            `Premium: $${(quote.premiumCents / 100).toFixed(2)} per payment`,
            `Deductible: ${quote.deductibleCents === null ? "none" : `$${(quote.deductibleCents / 100).toFixed(2)}`}`,
            `Claims: ${quote.carrier.claimsPhone}`,
          ].join("\n"),
        },
      ],
    };
  },

  // The first payment is taken on the start day.
  async paymentStatus(_policyNumber, { startDate, now }) {
    return now.toISOString().slice(0, 10) >= startDate ? "paid" : "pending";
  },

  // Spec step 153: the stand-in decides at once from the answers (life-underwriting.ts).
  async applyLife({ quote, answers }, { now }) {
    const decision = standInDecision(
      { ...quote, perYear: PREMIUM_FREQUENCIES[quote.premiumFrequency].perYear },
      answers,
    );
    return {
      ...decision,
      offerExpiresAt:
        decision.outcome === "offered"
          ? new Date(now.getTime() + LIFE_OFFER_DAYS * DAY_MS).toISOString()
          : null,
    };
  },

  // Spec step 154: the stand-in prices a change from DEMO_ENDORSEMENT_FACTORS, from tomorrow.
  async endorse(policy, change, { now }) {
    const factor = DEMO_ENDORSEMENT_FACTORS[change.kind] ?? 1;
    const effectiveDate = new Date(now.getTime() + DAY_MS).toISOString().slice(0, 10);
    return {
      premiumCents:
        policy.premiumCents === null
          ? null
          : Math.round((policy.premiumCents * factor) / 100) * 100,
      effectiveDate,
      confirmation: `DEMO-END-${hashOf(policy, change, effectiveDate).slice(0, 8).toUpperCase()}`,
    };
  },

  // Spec step 155: the stand-in carrier's answer to "can you do better on my renewal?". It
  // meets a cheaper like-for-like quote closely, or else takes off part of the rise for a
  // loyal customer; never below today's price. A higher deductible is offered, never taken.
  async negotiateRenewal(request) {
    const { currentAnnualCents: now_, renewalAnnualCents: renewal } = request;
    const competing = request.competingAnnualCents;
    const target =
      competing !== null && competing < renewal
        ? Math.round(competing * (1 + DEMO_NEGOTIATE.matchMargin))
        : Math.round(renewal - (renewal - now_) * DEMO_NEGOTIATE.loyaltyShareOfRise);
    const lowered = Math.max(now_, Math.min(renewal, Math.round(target / 100) * 100));
    const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
    const transcript = [
      `Jane: Hi, I'm calling for your customer about their ${request.kind} policy. It renews at ${dollars(renewal)} a year, up from ${dollars(now_)}.${competing !== null && competing < renewal ? ` They have a quote for the same cover at ${dollars(competing)}.` : ""} Can you do better?`,
      lowered < renewal
        ? `${request.carrier}: We can renew it at ${dollars(lowered)} a year with the same cover.`
        : `${request.carrier}: I'm sorry, ${dollars(renewal)} is the best we can do on that cover.`,
    ];
    const offer = ["auto", "home", "renters"].includes(request.kind)
      ? "a higher deductible for a lower price"
      : null;
    if (offer) {
      transcript.push(
        `${request.carrier}: We could also take more off with ${offer}.`,
        "Jane: Thanks, I'll pass that on; I can't change the cover on this call.",
      );
    }
    return {
      outcome: lowered < renewal ? "lowered" : "kept",
      annualPremiumCents: lowered,
      transcript,
      offer,
    };
  },

  // Spec step 196: the stand-in takes the figure asked for and confirms it.
  async applySaving(policy, saving, { now }) {
    return {
      premiumCents: saving.newPremiumCents,
      confirmation: `DEMO-SAV-${hashOf(policy, saving, now.toISOString().slice(0, 10)).slice(0, 8).toUpperCase()}`,
    };
  },

  async fileClaim(claim, { now }) {
    return {
      claimNumber: `DEMO-CLM-${hashOf(claim, now.toISOString().slice(0, 10)).slice(0, 8).toUpperCase()}`,
    };
  },

  // Day by day after filing: received, reviewing, approved (less the deductible), paid.
  async claimStatus(claim, { now }) {
    const days = (now.getTime() - claim.filedAt.getTime()) / DAY_MS;
    const payout = Math.max(0, claim.amountCents - (claim.deductibleCents ?? 0));
    if (days >= DEMO_CLAIM_DAYS.paid) return { status: "paid", payoutCents: payout };
    if (days >= DEMO_CLAIM_DAYS.approved) return { status: "approved", payoutCents: payout };
    if (days >= DEMO_CLAIM_DAYS.reviewing) return { status: "reviewing", payoutCents: null };
    return { status: "received", payoutCents: null };
  },

  async cancel(policy, { effectiveDate }) {
    return {
      status: "cancelled",
      effectiveDate,
      confirmation: `DEMO-CXL-${hashOf(policy, effectiveDate).slice(0, 8).toUpperCase()}`,
    };
  },
};
