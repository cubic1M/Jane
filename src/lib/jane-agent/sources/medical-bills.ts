import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { MEDICAL_PAGE, firstUnsent, sendButton } from "../medical-bills-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// Medical bills (spec step 180). A bill found in the person's payments, with the first
// request ready to send on a tap, and later what each provider answered.

export const medicalBillsSource: MessageSource = {
  key: "medical_bills",
  gather: (snapshot): Candidate[] => {
    const data = snapshot.medicalBills;
    if (!data?.available) return [];
    const out: Candidate[] = [];
    const next = firstUnsent(data);
    if (next) {
      out.push({
        kind: "decision",
        body: `${next.bill.provider} charged ${formatCents(next.bill.amountCents)} on ${dayLabel(next.bill.billedOn)}. Medical bills are often wrong or can be lowered: ${next.label.charAt(0).toLowerCase()}${next.label.slice(1)}. I've written the letter; nothing is sent until you tap.`,
        refs: { advice: true, medicalItem: { id: next.id } },
        actions: [sendButton(next.label), MEDICAL_PAGE, snoozeButton()],
        dedupeKey: `medical:${next.bill.key}`,
        priority: MESSAGE_PRIORITY.medical_bill,
      });
    }
    for (const r of data.requests) {
      if (r.status === "sent" || !r.resolvedOn) continue;
      out.push({
        kind: r.status === "granted" ? "done" : "heads_up",
        body: `${r.provider} answered your request about the ${formatCents(r.amountCents)} bill (sent ${dayLabel(r.sentOn)}). ${r.outcome ?? ""}`.trim(),
        refs: {},
        actions: [MEDICAL_PAGE],
        dedupeKey: `medical_answer:${r.id}`,
        priority: MESSAGE_PRIORITY.medical_answer,
      });
    }
    return out;
  },
};
