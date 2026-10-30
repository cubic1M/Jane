import { LOOKBACK_MONTHS, SHORT_HISTORY_DAYS } from "@/config/detection";
import { ANNUAL_FEE_WORDS } from "@/config/found-policies";
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
  // Fees need FEE_PACE_MIN_CHARGES to count at a year's pace; a month of card interest is
  // already one (it accrues every month a balance is carried).
  { minChargesForPace = 1 }: { minChargesForPace?: number } = {},
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
    // A card's annual fee comes once a year: it counts once, never scaled up with the rest
    // (night QA 10-30: a $95 annual fee in 3 months of statements counted as $380 a year).
    const yearly = sumCents(charges.filter((c) => ANNUAL_FEE_WORDS.test(c.description)));
    const paced =
      charges.filter((c) => c.amountCents > 0 && !ANNUAL_FEE_WORDS.test(c.description)).length >=
      minChargesForPace;
    const annual =
      short && paced ? Math.round(((total - yearly) * MONTHS_PER_YEAR) / months) + yearly : total;
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
          // The months the total covers, for the card's words (night QA 10-30: "in the last 3
          // months" in the title, "over the last 12 months" in the explanation).
          months,
          transactions: charges.map((c) => ({ ...evidenceOf(c), category: c.pfcDetailed })),
        },
      },
    ];
  });
}
