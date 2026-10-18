import { CARD_INTEREST_CATEGORIES, LOOKBACK_MONTHS } from "@/config/detection";
import { formatCents } from "@/lib/money";
import { inList, inLookback } from "../helpers";
import { totalsByAccount } from "./fee-totals";
import type { Rule } from "./rule";

// Interest charged on credit accounts over the lookback window, one finding per card.
export const cardInterest: Rule = (input) => {
  const credit = new Set(input.accounts.filter((a) => a.type === "credit").map((a) => a.id));
  return totalsByAccount(
    input,
    inLookback(input).filter(
      (t) => credit.has(t.accountId) && inList(t.pfcDetailed, CARD_INTEREST_CATEGORIES),
    ),
    (account, total) => ({
      type: "card_interest",
      title: `${formatCents(total)} in interest on ${account?.name ?? "your card"} in the last ${LOOKBACK_MONTHS} months`,
    }),
  );
};
