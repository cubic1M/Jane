import { PAY_APP_NAMES } from "@/config/costly-borrowing";
import { BANK_FEE_CATEGORIES } from "@/config/detection";
import { formatCents } from "@/lib/money";
import { bankFeesByAccount } from "@/planning/bank-fees";
import { byDate, evidenceOf, inList, inLookback, isProcessorFee } from "../helpers";
import { feeMonthsOf, lastMonths } from "./fee-totals";
import type { Candidate } from "../types";
import type { Rule } from "./rule";

// Fees in Plaid's bank-fee categories over the lookback window, one finding per account. What
// each is worth a year is bankFeesByAccount's (src/planning/bank-fees.ts), over feeMonthsOf's
// months: the figure the dock's suggestion and the chat add up, so the report says the same
// (gate B: the report paced fees only under 200 days of history and the dock under a year, so
// eight months of $12 fees read $96 a year here and $144 there).
export const bankFees: Rule = (input) => {
  const fees = inLookback(input).filter(
    (t) =>
      inList(t.pfcDetailed, BANK_FEE_CATEGORIES) &&
      !isProcessorFee(t.description) &&
      // A pay advance app's tip is the advance's cost (costly borrowing), not a bank fee.
      !PAY_APP_NAMES.test(t.description),
  );
  const months = feeMonthsOf(input);
  const counted = bankFeesByAccount(
    fees.map((t) => ({
      date: t.date,
      amountCents: t.amountCents,
      description: t.description,
      pfc: t.pfcDetailed,
      accountId: t.accountId,
    })),
    months,
  );
  return counted.flatMap(({ accountId, seenCents, yearCents }): Candidate[] => {
    const account = input.accounts.find((a) => a.id === accountId);
    const charges = fees.filter((t) => t.accountId === accountId).sort(byDate);
    // Keyword rules and Plaid are reliable on fee lines; an LLM guess is less certain.
    const sure = charges.every((c) => c.categorySource === "rule" || c.categorySource === "plaid");
    return [
      {
        type: "bank_fees",
        title: `${formatCents(seenCents)} in fees on ${account?.name ?? "your account"} in ${lastMonths(months)}`,
        key: `account:${accountId}`,
        annualSavingsCents: yearCents,
        amountCents: seenCents,
        confidence: sure ? "high" : "medium",
        evidence: {
          accountId: accountId ?? null,
          accountName: account?.name ?? null,
          totalCents: seenCents,
          // The months the total covers, for the card's words (night QA 10-30: "in the last 3
          // months" in the title, "over the last 12 months" in the explanation).
          months,
          transactions: charges.map((c) => ({ ...evidenceOf(c), category: c.pfcDetailed })),
        },
      },
    ];
  });
};
