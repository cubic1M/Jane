import { equivalentsSaving, type Equivalent, type Range } from "@/insights/investment-fees";
import { formatCents } from "@/lib/money";
import { formatExpenseRatio } from "@/lib/percent";

// Jane's words about investment fees (spec step 130), shared by its message, its rule
// answer and the fees page. Pure.

// A rough range over decades, in whole dollars: not "$1,626.09 to $3,719.68" (debugger 11-16).
const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
export const feeRange = (r: Range) => `${dollars(r.lowCents)} to ${dollars(r.highCents)}`;

// "Summit Large Cap Growth Fund charges 1.02% a year; Keystone US Large Cap Index ETF does a
// similar job for 0.04%."
export const equivalentLine = (e: Equivalent) =>
  `${e.holding.name} in your ${e.accountName} charges ${formatExpenseRatio(e.holding.expenseRatioBps ?? 0)} a year; ${e.name} (${e.category}${e.inPlanMenu ? ", offered in your plan" : ""}) charges ${formatExpenseRatio(e.expenseRatioBps)}. About ${formatCents(e.yearlySavingCents)} a year less.`;

export function switchSummary(equivalents: Equivalent[], years: number): string {
  const saving = equivalentsSaving(equivalents);
  const funds = equivalents.length === 1 ? "that fund" : `those ${equivalents.length} funds`;
  return `Switching ${funds} could save about ${formatCents(saving.yearlyCents)} a year, roughly ${feeRange(saving.overYears)} over ${years} years depending on returns.`;
}
