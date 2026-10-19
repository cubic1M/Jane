import { formatCents } from "@/lib/money";
import { STATE_TAX } from "@/config/tax-rates";
import { stateName } from "@/planning/tax-profile";
import type { StateEstimate, TaxEstimate } from "./tax-estimate";

// How the tax estimate is said (spec step 120), on /taxes and in the chat. Every figure is
// "about" and called an estimate.

export const ESTIMATE_NOTE =
  "An estimate from your accounts and tax profile, not a tax return. It updates after every sync. Tax figures for 2026 are from the IRS and state tax agencies, for review.";

// "a refund of about $4,166", "about $1,200 to pay", "about even".
export function balancePhrase(refundCents: number): string {
  const amount = formatCents(Math.round(Math.abs(refundCents) / 100) * 100).replace(/\.00$/, "");
  if (Math.abs(refundCents) < 5_000) return "about even";
  return refundCents > 0 ? `a refund of about ${amount}` : `about ${amount} to pay`;
}

export function federalLine(estimate: TaxEstimate, withholdingKnown: boolean): string {
  if (!withholdingKnown) {
    return `Federal: about ${roundDollars(estimate.totalTaxCents)} of tax for ${estimate.year}. I need your pay stub figures to say whether that's a refund or a bill.`;
  }
  return `Federal: ${balancePhrase(estimate.refundCents)}.`;
}

export function stateLine(state: StateEstimate | null, withholdingKnown: boolean): string | null {
  if (!state) return null;
  const name = stateName(state.code) ?? state.code;
  if (state.kind === "none") return `${name}: no state income tax.`;
  const rough = state.rough ? " (rough: this state's figures aren't confirmed for 2026)" : "";
  if (!withholdingKnown) return `${name}: about ${roundDollars(state.taxCents)} of tax${rough}.`;
  return `${name}: ${balancePhrase(state.refundCents)}${rough}.`;
}

export const roundDollars = (cents: number) =>
  formatCents(Math.round(cents / 100) * 100).replace(/\.00$/, "");

export const stateSource = (code: string) => STATE_TAX[code]?.source ?? null;
