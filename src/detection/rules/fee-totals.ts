import { LOOKBACK_MONTHS, SHORT_HISTORY_DAYS } from "@/config/detection";
import { ANNUAL_FEE_WORDS } from "@/config/found-policies";
import { byDate, dataEnd, evidenceOf, sumCents } from "../helpers";
import type { Candidate, DetectionAccount, DetectionInput, DetectionTransaction } from "../types";
import { DAYS_PER_MONTH, MONTHS_PER_YEAR, daysBetween } from "../units";

// Days of history a charge is paced over: from the person's first transaction to where their
// statements end (today, unless the newest line is old: statementsEnd). The person's, as a bank
// links every account with the same history (debugger 11-14: two $12 fees in an upload read 46
// days on paced 2 months on the report, 1 on the dock). But an uploaded statement covers its own
// days, from its first line to its last (debug 3, 11-16): a checking file from Aug 1 to Oct 14,
// uploaded beside a card's from Jun 1 to Nov 8, paced its two $12 monthly fees over Jun 1 to Nov
// 15, "the last 5 months", $57.60 a year where they are $144.
type Line = { date: string; accountId?: string; uploadedOn?: string };
type History = {
  transactions: readonly Line[];
  asOf: string;
  historyFrom?: string;
  accountsFrom?: Readonly<Record<string, string>>;
};
function historyDays(input: History, accounts?: ReadonlySet<string | undefined>): number {
  const own = accounts
    ? input.transactions.filter((t) => accounts.has(t.accountId) && t.date <= input.asOf)
    : [];
  if (own.length > 0 && own.every((t) => t.uploadedOn)) {
    // From its first line ever, when that is before the lines read (accountsFrom).
    const before = [...(accounts ?? [])].flatMap((id) => {
      const from = id === undefined ? undefined : input.accountsFrom?.[id];
      return from ? [from] : [];
    });
    const first = [...own.map((t) => t.date), ...before].reduce(
      (min, d) => (d < min ? d : min),
      input.asOf,
    );
    const last = own.reduce((max, t) => (t.date > max ? t.date : max), first);
    return daysBetween(first, last);
  }
  const first =
    input.historyFrom ??
    input.transactions.reduce((min, t) => (t.date < min ? t.date : min), input.asOf);
  return daysBetween(first, dataEnd(input.transactions, input.asOf));
}

// The months bank fees are paced over, the one count the report's finding, the dock's suggestion
// and the chat's answer use (gate B: the dock counted the profile's months, the chat calendar
// months, and the report its own, so one fee read three yearly figures), for the account the fees
// are on (or the accounts: an uploaded statement's own days only when every one is uploaded).
export const feeMonthsOf = (input: History, accounts?: Iterable<string | undefined>): number =>
  paceOf(input, accounts).months;

// paceMonths over the days of history of the given accounts (the person's without).
export const paceOf = (input: History, accounts?: Iterable<string | undefined>) =>
  paceMonths(historyDays(input, accounts ? new Set(accounts) : undefined));

// Where the statements reach (../helpers), kept here too for the detectors that read it.
export { dataEnd };

// The months a fee or interest total covers, given the days of history, at most the
// LOOKBACK_MONTHS window. Under SHORT_HISTORY_DAYS the total is also counted at a year's pace.
// The one count the report's finding and the dock's card-interest
// suggestion share (review 10-31: they scaled differently and disagreed by up to $1,000).
export function paceMonths(days: number): { short: boolean; months: number } {
  const short = days < SHORT_HISTORY_DAYS;
  return {
    short,
    months: Math.min(LOOKBACK_MONTHS, Math.max(1, Math.round(days / DAYS_PER_MONTH))),
  };
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
    const { short, months } = paceOf(input, [accountId]);
    // A card's annual fee comes once a year: it counts once, never scaled up with the rest
    // (night QA 10-30: a $95 annual fee in 3 months of statements counted as $380 a year).
    // Never more than the total: refunds beyond the other fees left that negative, and a year's
    // pace of it a negative saving (money rules, 11-03; src/planning/bank-fees.ts does the same).
    const yearly = Math.min(
      total,
      sumCents(charges.filter((c) => ANNUAL_FEE_WORDS.test(c.description))),
    );
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
