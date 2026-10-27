import { LOOKBACK_MONTHS, SHORT_HISTORY_DAYS } from "@/config/detection";
import { byDate, evidenceOf, sumCents } from "../helpers";
import type { Candidate, DetectionAccount, DetectionInput, DetectionTransaction } from "../types";

const DAY_MS = 86_400_000;
const DAYS_PER_MONTH = 365 / 12;

// Days of history for an account: from its first transaction the rules see to asOf.
function historyDays(input: DetectionInput, accountId: string): number {
  const first = input.transactions
    .filter((t) => t.accountId === accountId)
    .reduce((min, t) => (t.date < min ? t.date : min), input.asOf);
  return Math.round((Date.parse(input.asOf) - Date.parse(first)) / DAY_MS);
}

// "the last 3 months", or "the last month".
export const lastMonths = (months: number) =>
  months === 1 ? "the last month" : `the last ${months} months`;

// Shared by bank fees and card interest: total the matching charges per account over the
// lookback window. Refunds in the same category net out; nothing is found if the net is zero
// or less. `months` is what the window really covers: under SHORT_HISTORY_DAYS of history
// (3 months of uploaded statements) it's those months, not LOOKBACK_MONTHS. With `yearly`, a
// short history's charges seen in two months or more count at their yearly pace.
export function totalsByAccount(
  input: DetectionInput,
  transactions: DetectionTransaction[],
  build: (
    account: DetectionAccount | undefined,
    totalCents: number,
    months: number,
  ) => Pick<Candidate, "type" | "title">,
  { yearly = false }: { yearly?: boolean } = {},
): Candidate[] {
  const byAccount = new Map<string, DetectionTransaction[]>();
  for (const t of transactions)
    byAccount.set(t.accountId, [...(byAccount.get(t.accountId) ?? []), t]);

  return [...byAccount.keys()].sort().flatMap((accountId): Candidate[] => {
    const charges = (byAccount.get(accountId) ?? []).sort(byDate);
    const total = sumCents(charges);
    if (total <= 0) return [];
    const account = input.accounts.find((a) => a.id === accountId);
    const days = historyDays(input, accountId);
    const short = days < SHORT_HISTORY_DAYS;
    const months = short
      ? Math.min(LOOKBACK_MONTHS, Math.max(1, Math.round(days / DAYS_PER_MONTH)))
      : LOOKBACK_MONTHS;
    const chargedMonths = new Set(
      charges.filter((c) => c.amountCents > 0).map((c) => c.date.slice(0, 7)),
    );
    const annual =
      yearly && short && chargedMonths.size >= 2
        ? Math.round((total * 365) / Math.max(days, DAYS_PER_MONTH))
        : total;
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
