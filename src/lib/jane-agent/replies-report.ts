import { MONTHLY_REPORT_RECEIPTS } from "@/config/monthly-report";
import type { StoredReport } from "@/lib/monthly-report-store";
import { monthName, reportBody } from "@/planning/monthly-report";
import type { Reply } from "./replies";

// The monthly money report in the chat (spec step 148): every figure, a few receipts, and
// the page with all of it.
export function reportReply(stored: StoredReport | null): Reply {
  if (!stored) {
    return {
      body: "Your first money report comes at the start of next month: what you saved, earned, paid down and moved, with the receipts.",
      actions: [],
      refs: {},
    };
  }
  return {
    body: reportBody(stored.report, MONTHLY_REPORT_RECEIPTS),
    actions: [
      {
        id: "open",
        label: `See ${monthName(stored.month)}`,
        kind: "link",
        href: `/monthly?m=${stored.month}`,
      },
    ],
    refs: {},
  };
}
