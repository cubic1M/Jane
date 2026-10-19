import { formatCents } from "@/lib/money";
import type { ProvenSavings } from "@/lib/savings-proof";
import type { Reply } from "./replies";

// "How much have you saved me?" (spec step 139): the confirmed total, apart from estimates.
export function savedReply(saved: ProvenSavings): Reply {
  const confirmed =
    saved.confirmedCents > 0
      ? `I've saved you ${formatCents(saved.confirmedCents)} so far, confirmed in your own transactions (${saved.confirmed.length} ${saved.confirmed.length === 1 ? "receipt" : "receipts"}).`
      : "Nothing's confirmed in your transactions yet.";
  const estimate =
    saved.estimatedCents > 0
      ? ` About ${formatCents(saved.estimatedCents)} a year more is still an estimate until your transactions show it.`
      : "";
  return {
    body: `${confirmed}${estimate}`,
    actions: [{ id: "open", label: "See the receipts", kind: "link", href: "/saved" }],
    refs: {},
  };
}
