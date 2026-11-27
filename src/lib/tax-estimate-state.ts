// What this year's tax estimate can say, the one rule Home's Taxes tile and the Taxes page share
// (gate B; debugger 11-16: a Plaid sandbox student with no pay, only $0.84 of interest, read "Not
// enough to estimate yet" on Home and "Your 2026 estimate: $0 back" on Taxes). Pure.
//
// - "refund" / "owed": there's tax, and what's withheld or paid is known.
// - "tax": there's tax; what's withheld isn't known.
// - "no_tax": income under what's taxed, nothing withheld seen (a student with a part-time job).
// - "unknown": nothing to estimate from yet.
// - "no_params": Jane has no IRS figures for the year (NoTaxParamsError), so it estimates nothing
//   and shows no figure; the page says so with noParamsText.
export type EstimateState = "refund" | "owed" | "tax" | "no_tax" | "unknown" | "no_params";

// W-N (tax engine roadmap 1.12): said in place of every figure for a year with no parameters.
// With `group` (an awaited group of a supported year, NoTaxParamsError.group) it says that one
// figure is missing and what Jane left out, never that the whole year is.
const AWAITED_GROUP_TEXT: Readonly<Record<string, (year: number) => string>> = {
  mileage: (year) =>
    `Jane doesn't have the IRS's ${year} mileage rate yet, so it hasn't counted those miles.`,
};
export const noParamsText = (year: number, group?: string) =>
  group
    ? (AWAITED_GROUP_TEXT[group]?.(year) ??
      `Jane doesn't have the IRS's ${year} ${group} figures yet, so it hasn't counted them.`)
    : `Jane doesn't have the IRS figures for ${year} yet, so it isn't estimating that year.`;

export function estimateState(t: {
  noParams?: boolean;
  totalTaxCents: number;
  incomeCents?: number | null;
  withholdingKnown: boolean;
  refundCents: number;
}): EstimateState {
  if (t.noParams) return "no_params";
  if (t.totalTaxCents > 0) {
    if (!t.withholdingKnown) return "tax";
    return t.refundCents >= 0 ? "refund" : "owed";
  }
  return (t.incomeCents ?? 0) > 0 && !t.withholdingKnown ? "no_tax" : "unknown";
}
