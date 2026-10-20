import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { REPORT_PAGE, firstLetter, sendButton } from "../credit-report-fixes-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// Collections and credit report errors (spec step 181). An item found on the report with
// the first letter ready to send on a tap (a validation letter first: its window closes),
// and later what the collector or the bureaus answered.

export const reportFixesSource: MessageSource = {
  key: "credit_report_fixes",
  gather: (snapshot): Candidate[] => {
    const data = snapshot.reportFixes;
    if (!data?.available) return [];
    const out: Candidate[] = [];
    const next = firstLetter(data);
    if (next) {
      const item = next.item;
      const window = next.windowEndsOn
        ? ` You have until ${dayLabel(next.windowEndsOn, { year: true })} to ask for validation.`
        : "";
      out.push({
        kind: "decision",
        body: `Your credit report shows ${item.kind === "collection" ? `a collection from ${item.creditor}${item.amountCents ? ` for ${formatCents(item.amountCents)}` : ""}` : `a possible error on ${item.creditor}`}.${window} ${next.label.charAt(0).toUpperCase()}${next.label.slice(1)}: I've written the letter, citing the rule, and nothing is sent until you tap.`,
        refs: { advice: true, creditFix: { id: next.id } },
        actions: [sendButton(next.label), REPORT_PAGE, snoozeButton()],
        dedupeKey: `reportfix:${next.id}`,
        priority: next.windowEndsOn
          ? MESSAGE_PRIORITY.report_fix_window
          : MESSAGE_PRIORITY.report_fix,
      });
    }
    for (const d of data.disputes) {
      if (d.status !== "resolved" || !d.resolvedOn) continue;
      out.push({
        kind: d.removed ? "done" : "heads_up",
        body: `${d.itemName} answered your ${d.kind === "validation" ? "validation letter" : "dispute"} (sent ${dayLabel(d.sentOn)}). ${d.outcome ?? ""}`.trim(),
        refs: {},
        actions: [REPORT_PAGE],
        dedupeKey: `reportfix_answer:${d.id}`,
        priority: MESSAGE_PRIORITY.report_fix_answer,
      });
    }
    return out;
  },
};
