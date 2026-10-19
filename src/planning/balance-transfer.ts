import { BT_MIN_SAVING_CENTS } from "@/config/debt";
import type { Debt } from "@/insights/debts";
import { formatRate } from "@/insights/loans";
import type { TransferOffer } from "@/lib/lenders/partner";
import { formatCents } from "@/lib/money";
import { payoffPlan } from "./debt";

// Balance transfers (spec step 113): moving a card's balance to a 0% card. For each offer,
// the payment that clears the balance and the fee before the 0% ends, and what keeping the
// card and paying that same amount would cost in interest. The fee is always counted: the
// saving is that interest minus the fee. Interest is the debt planner's (./debt.ts). Pure.

export type ScoredTransfer = {
  offer: TransferOffer;
  // What to pay each month to clear the balance and the fee before the 0% ends.
  monthlyNeededCents: number;
  // YYYY-MM-DD the 0% ends, counting from the transfer today.
  promoEndsOn: string;
  // Keeping the balance on the card and paying monthlyNeededCents: the interest. Null when
  // that payment never clears it.
  keepInterestCents: number | null;
  // That interest minus the fee; null with keepInterestCents.
  savingCents: number | null;
};

export type TransferComparison = {
  debtKey: string;
  debtName: string;
  balanceCents: number;
  aprBps: number;
  // Best saving first.
  offers: ScoredTransfer[];
  pick: ScoredTransfer | null;
  why: string[];
};

const addMonths = (day: string, months: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
};

export const shortMonth = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export function scoreTransfer(
  balanceCents: number,
  aprBps: number,
  offer: TransferOffer,
  asOf: string,
): ScoredTransfer {
  const monthlyNeededCents = Math.ceil((balanceCents + offer.feeCents) / offer.promoMonths);
  const keep = payoffPlan(
    [{ id: "card", name: "card", balanceCents, aprBps, minimumCents: monthlyNeededCents }],
    monthlyNeededCents,
    "avalanche",
  );
  const keepInterestCents = keep.ok ? keep.totalInterestCents : null;
  return {
    offer,
    monthlyNeededCents,
    promoEndsOn: addMonths(asOf, offer.promoMonths),
    keepInterestCents,
    savingCents: keepInterestCents === null ? null : keepInterestCents - offer.feeCents,
  };
}

export function compareTransfers(
  debt: Debt,
  offers: readonly TransferOffer[],
  asOf: string,
): TransferComparison | null {
  if (debt.kind !== "card" || !debt.balanceCents || debt.aprBps === null || debt.aprBps === 0) {
    return null;
  }
  const scored = offers
    .map((o) => scoreTransfer(debt.balanceCents!, debt.aprBps!, o, asOf))
    .sort(
      (a, b) =>
        (b.savingCents ?? Number.MAX_SAFE_INTEGER) - (a.savingCents ?? Number.MAX_SAFE_INTEGER) ||
        a.offer.cardName.localeCompare(b.offer.cardName),
    );
  const best = scored[0];
  const pick =
    best && (best.savingCents === null || best.savingCents >= BT_MIN_SAVING_CENTS) ? best : null;
  const why = pick
    ? [
        `0% for ${pick.offer.promoMonths} months: pay ${formatCents(pick.monthlyNeededCents)} a month and it's gone by ${shortMonth(pick.promoEndsOn)}, with no interest.`,
        pick.savingCents === null
          ? `Paying that much on your card at ${formatRate(debt.aprBps)} would never clear it.`
          : pick.offer.feeCents === 0
            ? `No transfer fee: it saves ${formatCents(pick.savingCents)} against keeping it on your card at ${formatRate(debt.aprBps)} and paying the same.`
            : `The ${formatCents(pick.offer.feeCents)} transfer fee is counted: it still saves ${formatCents(pick.savingCents)} against keeping it on your card at ${formatRate(debt.aprBps)} and paying the same.`,
        `After the 0% it's ${formatRate(pick.offer.goToAprBps)}, so what's left then costs more. I'll remind you before.`,
      ]
    : [];
  return {
    debtKey: debt.key,
    debtName: debt.name,
    balanceCents: debt.balanceCents,
    aprBps: debt.aprBps,
    offers: scored,
    pick,
    why,
  };
}

// Days until the 0% ends, from `asOf`.
export const daysUntil = (asOf: string, day: string) =>
  Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000);

// Which reminder is due on `asOf`: the smallest of the reminder days that's been reached,
// so each one is said once (the message is keyed by it). Null before the first, or after
// the end.
export function dueReminder(
  asOf: string,
  promoEndsOn: string,
  remindDays: readonly number[],
): number | null {
  const left = daysUntil(asOf, promoEndsOn);
  if (left < 0) return null;
  const reached = remindDays.filter((d) => left <= d);
  return reached.length > 0 ? Math.min(...reached) : null;
}
