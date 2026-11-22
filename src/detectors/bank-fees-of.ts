import { feeMonthsOf } from "@/detection/rules/fee-totals";
import { bankFeesYear, type BankFees } from "@/planning/bank-fees";
import type { ProfileInput } from "@/profile/build";

// The page the bank-fees card opens: the fees it counts, each with its day, amount and kind
// (src/app/transactions/page.tsx). Debug 2, sweep 16 (11-22): "See the fees" opened Where your
// money goes, which lists categories, not the 7 fees ($139.00) the card counted.
export const FEE_LIST_PATH = "/transactions?fees=1";

// A year of fees, the one definition (src/planning/bank-fees.ts) over the one count of months
// (feeMonthsOf) the report's findings and the chat's answer use too (gate B). The card and the fee
// list both read this, from the same rows, so they say one figure. Pure.
export function bankFeesOf(
  data: Pick<ProfileInput, "accounts" | "transactions" | "today">,
): BankFees | null {
  const cash = new Set(data.accounts.filter((a) => a.type === "depository").map((a) => a.id));
  return bankFeesYear(
    data.transactions.map((t) => ({ ...t, onCash: cash.has(t.accountId) })),
    (accountId) => feeMonthsOf({ transactions: data.transactions, asOf: data.today }, [accountId]),
  );
}
