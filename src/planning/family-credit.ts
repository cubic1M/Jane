import { AUTHORIZED_USER, FILE_START } from "@/config/family-credit";
import { paymentShare } from "./debt-trouble";

// Helping family with credit (spec step 249), pure.

// A card's use as a share of its limit; null without a limit.
export const utilisation = (balanceCents: number, limitCents: number | null) =>
  limitCents && limitCents > 0 ? balanceCents / limitCents : null;

export type AuView = {
  utilisation: number | null;
  // Low enough that adding someone is a small risk to the person.
  safe: boolean;
  // What the card's use would be if the added person spent this much.
  afterSpend: { spendCents: number; utilisation: number | null } | null;
  addedGainsPoints: { low: number; high: number };
  risk: string;
};

export function authorizedUser(card: {
  balanceCents: number;
  limitCents: number | null;
  spendCents?: number;
}): AuView {
  const now = utilisation(card.balanceCents, card.limitCents);
  const spend = card.spendCents ?? null;
  return {
    utilisation: now,
    safe: now !== null && now < AUTHORIZED_USER.safeUtilisation,
    afterSpend:
      spend !== null
        ? {
            spendCents: spend,
            utilisation: utilisation(card.balanceCents + spend, card.limitCents),
          }
        : null,
    addedGainsPoints: AUTHORIZED_USER.addedGainsPoints,
    risk: AUTHORIZED_USER.primaryRisk,
  };
}

// Interest on a level-payment loan over its term.
export function loanInterestCents(principalCents: number, aprBps: number, months: number): number {
  const r = aprBps / 10_000 / 12;
  if (r === 0) return 0;
  const payment = (principalCents * r) / (1 - Math.pow(1 + r, -months));
  return Math.round(payment * months - principalCents);
}

// What having a file saves on a first loan, in the guess stated in config.
export const fileStartSavingCents = () =>
  Math.max(
    0,
    loanInterestCents(FILE_START.firstLoanCents, FILE_START.thinFileAprBps, FILE_START.termMonths) -
      loanInterestCents(FILE_START.firstLoanCents, FILE_START.fairAprBps, FILE_START.termMonths),
  );

export type CosignView = {
  // Debt payments as a share of income, before and with the co-signed loans counted in full.
  shareBefore: number | null;
  shareWith: number | null;
  cosignedPaymentCents: number;
  exposureCents: number;
  // If the other person misses: what lands on the person.
  ifMissed: { balanceCents: number; paymentCents: number };
};

export function cosignEffect(input: {
  incomeCents: number | null;
  paymentsCents: number;
  cosigned: readonly { balanceCents: number | null; monthlyPaymentCents: number | null }[];
}): CosignView {
  const cosignedPaymentCents = input.cosigned.reduce((s, c) => s + (c.monthlyPaymentCents ?? 0), 0);
  const exposureCents = input.cosigned.reduce((s, c) => s + (c.balanceCents ?? 0), 0);
  return {
    shareBefore: paymentShare(input.paymentsCents, input.incomeCents),
    shareWith: paymentShare(input.paymentsCents + cosignedPaymentCents, input.incomeCents),
    cosignedPaymentCents,
    exposureCents,
    ifMissed: { balanceCents: exposureCents, paymentCents: cosignedPaymentCents },
  };
}
