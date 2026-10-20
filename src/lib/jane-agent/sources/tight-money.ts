import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { dayLabel } from "@/lib/day-label";
import { TIGHT_PAGE, billLines, firstUnsent, sendButton, shortLine } from "../tight-money-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// When money is tight (spec step 177). When the forecast dips under its cushion, one plan
// with the first request ready to send on a tap; later, what each lender answered.

export const tightMoneySource: MessageSource = {
  key: "tight_money",
  gather: (snapshot): Candidate[] => {
    const data = snapshot.tightMoney;
    if (!data?.available) return [];
    const out: Candidate[] = [];
    const next = firstUnsent(data);
    if (data.shortfall && next) {
      out.push({
        kind: "decision",
        body: [
          shortLine(data)!,
          "Pay these first, essentials before anything else:",
          ...billLines(data, 4),
          `To ease it: ${next.label.charAt(0).toLowerCase()}${next.label.slice(1)}. I've written the request; nothing is sent until you tap.`,
        ].join("\n"),
        refs: { advice: true, tightItem: { id: next.id } },
        actions: [sendButton(next.label), TIGHT_PAGE, snoozeButton()],
        dedupeKey: `tight:${data.shortfall.date.slice(0, 7)}:${next.id}`,
        priority: MESSAGE_PRIORITY.tight_plan,
      });
    }
    for (const r of data.requests) {
      if (r.status === "sent" || !r.resolvedOn) continue;
      out.push({
        kind: r.status === "granted" ? "done" : "heads_up",
        body: `${r.target} answered your request (sent ${dayLabel(r.sentOn)}). ${r.outcome ?? ""}`.trim(),
        refs: {},
        actions: [TIGHT_PAGE],
        dedupeKey: `tight_answer:${r.id}`,
        priority: MESSAGE_PRIORITY.tight_answer,
      });
    }
    return out;
  },
};
