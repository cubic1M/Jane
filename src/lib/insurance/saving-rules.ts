import { PREMIUM_FREQUENCIES, type PremiumFrequency } from "@/config/documents";
import {
  DEDUCTIBLE_LADDERS,
  DEDUCTIBLE_SAVINGS_COVER,
  MIN_SAVING_CENTS,
  SAVING_POLICY_KINDS,
  SAVING_RATES,
  type PolicyKind,
  type SavingKind,
} from "@/config/insurance";

// Paying less for the same cover (spec step 196): which cheaper way to pay applies to which
// policy, from the policy and the person's cash. Rates are in src/config/insurance.ts. Pure.

export type SavingPolicy = {
  id: string;
  kind: PolicyKind;
  carrier: string;
  premiumCents: number | null;
  premiumFrequency: PremiumFrequency | null;
  deductibleCents: number | null;
};

export type SavingCandidate = {
  policyId: string;
  kind: SavingKind;
  yearlySavingCents: number;
  currentYearlyCents: number;
  newYearlyCents: number;
  // What changes, for the person to read and for the partner to apply.
  detail: {
    payNowCents?: number;
    fromDeductibleCents?: number;
    toDeductibleCents?: number;
    withPolicyId?: string;
    withCarrier?: string;
  };
};

const yearlyOf = (p: SavingPolicy) =>
  p.premiumCents !== null && p.premiumFrequency
    ? p.premiumCents * PREMIUM_FREQUENCIES[p.premiumFrequency].perYear
    : null;

const candidate = (
  policy: SavingPolicy,
  kind: SavingKind,
  yearlySavingCents: number,
  detail: SavingCandidate["detail"] = {},
): SavingCandidate | null => {
  const current = yearlyOf(policy);
  if (current === null || yearlySavingCents < MIN_SAVING_CENTS) return null;
  return {
    policyId: policy.id,
    kind,
    yearlySavingCents,
    currentYearlyCents: current,
    newYearlyCents: current - yearlySavingCents,
    detail,
  };
};

const share = (cents: number, of: number) => Math.round(cents * of);

// Pay the year at once instead of in installments: no installment fees and the carrier's
// discount. Only when the person's cash covers the year.
export function payInFull(policy: SavingPolicy, cashCents: number): SavingCandidate | null {
  const yearly = yearlyOf(policy);
  if (yearly === null || policy.premiumFrequency === "yearly") return null;
  const payments = PREMIUM_FREQUENCIES[policy.premiumFrequency!].perYear;
  const saving =
    payments * SAVING_RATES.payInFull.installmentFeeCents +
    share(yearly, SAVING_RATES.payInFull.discountShare);
  const payNow = yearly - saving;
  if (cashCents < payNow) return null;
  return candidate(policy, "pay_in_full", saving, { payNowCents: payNow });
}

export const autopay = (policy: SavingPolicy) =>
  candidate(policy, "autopay", share(yearlyOf(policy) ?? 0, SAVING_RATES.autopay.discountShare));

export const paperless = (policy: SavingPolicy) =>
  candidate(
    policy,
    "paperless",
    share(yearlyOf(policy) ?? 0, SAVING_RATES.paperless.discountShare),
  );

// A safe-driver (usage-based) program, for a car policy.
export const telematics = (policy: SavingPolicy) =>
  policy.kind === "auto"
    ? candidate(
        policy,
        "telematics",
        share(yearlyOf(policy) ?? 0, SAVING_RATES.telematics.discountShare),
      )
    : null;

// One carrier for the car and the home or renters policy: a share off both. Offered on the
// car policy when the other policy is with a different carrier.
export function bundle(policy: SavingPolicy, others: SavingPolicy[]): SavingCandidate | null {
  if (policy.kind !== "auto") return null;
  const place = others.find(
    (o) =>
      (o.kind === "home" || o.kind === "renters") &&
      o.carrier.trim().toLowerCase() !== policy.carrier.trim().toLowerCase() &&
      yearlyOf(o) !== null,
  );
  const car = yearlyOf(policy);
  if (!place || car === null) return null;
  return candidate(
    policy,
    "bundle",
    share(car + (yearlyOf(place) ?? 0), SAVING_RATES.bundle.discountShare),
    { withPolicyId: place.id, withCarrier: place.carrier },
  );
}

// The next deductible up the carrier's ladder, when the person's savings cover it twice over.
// This is the one that lowers cover: the figure comes with what it costs on a claim.
export function higherDeductible(policy: SavingPolicy, cashCents: number): SavingCandidate | null {
  const ladder = DEDUCTIBLE_LADDERS[policy.kind];
  const from = policy.deductibleCents;
  if (!ladder || from === null) return null;
  const to = ladder.find((step) => step > from);
  if (to === undefined || cashCents < to * DEDUCTIBLE_SAVINGS_COVER) return null;
  return candidate(
    policy,
    "higher_deductible",
    share(yearlyOf(policy) ?? 0, SAVING_RATES.deductibleStepShare),
    { fromDeductibleCents: from, toDeductibleCents: to },
  );
}

// Every saving that applies, minus the ones already answered ("policyId:kind").
export function findSavings(
  policies: SavingPolicy[],
  cashCents: number,
  answered: ReadonlySet<string> = new Set(),
): SavingCandidate[] {
  const eligible = policies.filter(
    (p) => SAVING_POLICY_KINDS.includes(p.kind) && yearlyOf(p) !== null,
  );
  return eligible
    .flatMap((p) => [
      payInFull(p, cashCents),
      autopay(p),
      paperless(p),
      telematics(p),
      bundle(p, eligible),
      higherDeductible(p, cashCents),
    ])
    .filter((c): c is SavingCandidate => c !== null && !answered.has(`${c.policyId}:${c.kind}`));
}

// Whether taking this saving lowers the cover (a higher deductible does; nothing else does).
export const lowersCover = (kind: SavingKind) => kind === "higher_deductible";
