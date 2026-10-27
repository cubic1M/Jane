import { BANK_FEE_CATEGORIES } from "@/config/detection";
import { formatCents } from "@/lib/money";
import { inList, inLookback, isProcessorFee } from "../helpers";
import { lastMonths, totalsByAccount } from "./fee-totals";
import type { Rule } from "./rule";

// Fees in Plaid's bank-fee categories over the lookback window, one finding per account.
export const bankFees: Rule = (input) =>
  totalsByAccount(
    input,
    inLookback(input).filter(
      (t) => inList(t.pfcDetailed, BANK_FEE_CATEGORIES) && !isProcessorFee(t.description),
    ),
    (account, total, months) => ({
      type: "bank_fees",
      title: `${formatCents(total)} in fees on ${account?.name ?? "your account"} in ${lastMonths(months)}`,
    }),
  );
