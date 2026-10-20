import { dayLabel } from "@/lib/day-label";
import type { MedicalBills } from "@/lib/medical-bills";
import { formatCents } from "@/lib/money";
import type { Reply } from "./replies";
import type { MessageAction } from "./types";

// Jane's answers about medical bills (spec step 180), from src/lib/medical-bills.ts. Pure.
// Amounts come from the bills themselves; nothing is sent without a tap.

export const MEDICAL_PAGE: MessageAction = {
  id: "open",
  label: "See your medical bills",
  kind: "link",
  href: "/loans/medical",
};

export const sendButton = (label: string): MessageAction => ({
  id: "medical.send",
  label,
  kind: "primary",
});

export function firstUnsent(data: MedicalBills) {
  for (const bill of data.bills) {
    // A bigger ask first: assistance, then a plan, then the insurance check and itemizing.
    const order = ["assistance", "plan", "insurance", "itemized"];
    const item = [...bill.items]
      .filter((i) => !i.sent)
      .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))[0];
    if (item) return item;
  }
  return null;
}

export function medicalReply(data: MedicalBills): Reply {
  if (!data.available) {
    return {
      body: "Help with medical bills needs a provider partner, and there isn't one for your accounts yet.",
      actions: [],
      refs: {},
    };
  }
  if (data.bills.length === 0) {
    return {
      body: "I don't see any medical bills of $100 or more in your recent payments. If you have one, add it on the medical bills page and I'll check it and prepare the requests.",
      actions: [MEDICAL_PAGE],
      refs: {},
    };
  }
  const total = data.bills.reduce((s, b) => s + b.amountCents, 0);
  const lines = [
    `I found ${data.bills.length} medical ${data.bills.length === 1 ? "bill" : "bills"} totalling ${formatCents(total)}.`,
    ...data.bills
      .slice(0, 4)
      .map((b) => `- ${b.provider}, ${formatCents(b.amountCents)} on ${dayLabel(b.billedOn)}`),
  ];
  const next = firstUnsent(data);
  if (next) {
    lines.push(
      `${next.label} is the one I'd start with. I've written the letter; nothing is sent until you tap.`,
    );
  } else {
    lines.push("Every request for these is sent. I'll tell you what each provider answers.");
  }
  return {
    body: lines.join("\n"),
    actions: next ? [sendButton(next.label), MEDICAL_PAGE] : [MEDICAL_PAGE],
    refs: next ? { advice: true, medicalItem: { id: next.id } } : { advice: true },
  };
}
