import { LOOKBACK_MONTHS, SHORT_HISTORY_DAYS } from "@/config/detection";
import { byDate, evidenceOf, sumCents } from "../helpers";
import type { Candidate, DetectionAccount, DetectionInput, DetectionTransaction } from "../types";
import { DAYS_PER_MONTH, MONTHS_PER_YEAR, daysBetween } from "../units";

// Days of history: from the person's first transaction to asOf. The person's, not the
// account's, as src/planning/bank-fees.ts counts months, so the report and the dock agree.
function historyDays(input: DetectionInput): number {
  const first =
    input.historyFrom ??
    input.transactions.reduce((min, t) => (t.date < min ? t.date : min), input.asOf);
  return daysBetween(first, input.asOf);
}

// "the last 3 months", or "the last month".
export const lastMonths = (months: number) =>
  months === 1 ? "the last month" : `the last ${months} months`;

// Shared by bank fees and card interest: total the matching charges per account over the
// lookback window. Refunds in the same category net out; nothing is found if the net is zero
// or less. `months` is what the data really covers: under SHORT_HISTORY_DAYS of history
// (3 months of uploaded statements) it's those months, not LOOKBACK_MONTHS, and the saving is
// a year's worth at that pace: the one definition the brief, the dock and the chat use for bank
// fees (src/planning/bank-fees.ts), so the report and the dock say the same figure.
export function totalsByAccount(
  input: DetectionInput,
  transactions: DetectionTransaction[],
  build: (
    account: DetectionAccount | undefined,
    totalCents: number,
    months: number,
  ) => Pick<Candidate, "type" | "title">,
): Candidate[] {
  const byAccount = new Map<string, DetectionTransaction[]>();
  for (const t of transactions)
    byAccount.set(t.accountId, [...(byAccount.get(t.accountId) ?? []), t]);

  return [...byAccount.keys()].sort().flatMap((accountId): Candidate[] => {
    const charges = (byAccount.get(accountId) ?? []).sort(byDate);
    const total = sumCents(charges);
    if (total <= 0) return [];
    const account = input.accounts.find((a) => a.id === accountId);
    const days = historyDays(input);
    const short = days < SHORT_HISTORY_DAYS;
    const months = short
      ? Math.min(LOOKBACK_MONTHS, Math.max(1, Math.round(days / DAYS_PER_MONTH)))
      : LOOKBACK_MONTHS;
    const annual = short ? Math.round((total * MONTHS_PER_YEAR) / months) : total;
    // Keyword rules and Plaid are reliable on fee lines; an LLM guess is less certain.
    const sure = charges.every((c) => c.categorySource === "rule" || c.categorySource === "plaid");
    return [
      {
        ...build(account, total, months),
        key: `account:${accountId}`,
        annualSavingsCents: annual,
        amountCents: total,
        confidence: sure ? "high" : "medium",
        evidence: {
          accountId,
          accountName: account?.name ?? null,
          totalCents: total,
          transactions: charges.map((c) => ({ ...evidenceOf(c), category: c.pfcDetailed })),
        },
      },
    ];
  });
}
