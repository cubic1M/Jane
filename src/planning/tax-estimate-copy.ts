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
  // Spec step 165: every state that taxes some of the income, and a city's own tax.
  const names = (state.parts.length > 0 ? state.parts : [{ code: state.code }]).map(
    (p) => stateName(p.code) ?? p.code,
  );
  const name = `${names.join(" and ")}${state.local ? ` with ${state.local.label}` : ""}`;
  if (state.kind === "none" && !state.local) {
    return `${name}: no state income tax.`;
  }
  const rough = state.rough ? " (rough: this state's figures aren't confirmed for 2026)" : "";
  if (!withholdingKnown) return `${name}: about ${roundDollars(state.taxCents)} of tax${rough}.`;
  return `${name}: ${balancePhrase(state.refundCents)}${rough}.`;
}

export const roundDollars = (cents: number) =>
  formatCents(Math.round(cents / 100) * 100).replace(/\.00$/, "");

export const stateSource = (code: string) => STATE_TAX[code]?.source ?? null;

// "How much tax have I paid": withholding only when Jane can see it (a pay stub), estimated
// payments by name. Night QA 10-30: a person who paid $9,500 in estimated tax heard "Your
// employer has withheld about $0 … At this pace it will be about $9,500 by the end".
export function taxPaidText(p: {
  withholdingKnown: boolean;
  withheldSoFarCents: number;
  withheldProjectedCents: number;
  estimatedPaidCents: number;
  totalTaxCents: number;
}): { text: string; figures: number[] } {
  const estimated =
    p.estimatedPaidCents > 0
      ? ` You've paid ${roundDollars(p.estimatedPaidCents)} in estimated tax this year.`
      : "";
  if (!p.withholdingKnown) {
    return {
      text: `Jane sees your take-home pay, not what's withheld from it: your pay stub shows that.${estimated} Your federal tax this year comes to about ${roundDollars(p.totalTaxCents)}.`,
      figures: [p.estimatedPaidCents, p.totalTaxCents],
    };
  }
  return {
    text: `Your employer has withheld about ${roundDollars(p.withheldSoFarCents)} of federal tax from your pay so far this year, about ${roundDollars(p.withheldProjectedCents)} by the end at this pace.${estimated} That's against ${roundDollars(p.totalTaxCents)} of tax.`,
    figures: [
      p.withheldSoFarCents,
      p.withheldProjectedCents,
      p.estimatedPaidCents,
      p.totalTaxCents,
    ],
  };
}
