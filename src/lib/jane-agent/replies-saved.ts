import { formatCents } from "@/lib/money";
import type { VerifiedSavings } from "@/lib/savings-proof";
import type { Reply } from "./replies";

// "How much have you saved me?" (spec step 139): the confirmed total, apart from estimates.
// Jane's own receipts and the suggestions the person acted on, both confirmed in their transactions.
export function savedReply(saved: VerifiedSavings): Reply {
  const receipts = saved.actions.confirmed.length + saved.suggestions.confirmed.length;
  const confirmed =
    saved.confirmedCents > 0
      ? `I've saved you ${formatCents(saved.confirmedCents)} so far, confirmed in your own transactions (${receipts} ${receipts === 1 ? "receipt" : "receipts"}).`
      : "Nothing's confirmed in your transactions yet.";
  const estimate =
    saved.expectedCents > 0
      ? ` About ${formatCents(saved.expectedCents)} a year more is still an estimate until your transactions show it.`
      : "";
  return {
    body: `${confirmed}${estimate}`,
    actions: [{ id: "open", label: "See the receipts", kind: "link", href: "/saved" }],
    refs: {},
  };
}
