import { PAYCHECK_CUSHION_CENTS } from "@/config/money-movement";
import { formatCents } from "@/lib/money";
import type { BillPayItem, BillPayView } from "@/lib/money-movement/bill-pay";
import type { Reply } from "./replies";
import { STAND_IN_NOTE } from "./replies-paycheck";
import { dateAndDays } from "./sources/source";
import type { MessageAction } from "./types";
import { dayLabel } from "@/lib/day-label";

// Bills paid on time in the chat (spec step 145): what Jane scheduled on its own, what it'd
// like to pay (one tap), and a due date worth moving when it lands before payday.

const SEE_TRANSFERS: MessageAction = {
  id: "open",
  label: "See transfers",
  kind: "link",
  href: "/transfers",
};

const amountWords = (item: { amountCents: number; full: boolean }, minimumCents: number) =>
  item.full
    ? `the full ${formatCents(item.amountCents)} balance`
    : `the ${formatCents(minimumCents)} minimum`;

// One bill's message, or null when nothing needs saying (autopay covers it).
export function billPayReply(item: BillPayItem, asOf: string, payday: string | null): Reply | null {
  const { bill } = item;
  const due = `Your ${bill.name} payment is due ${dateAndDays(bill.dueOn, asOf)}.`;
  if (item.status === "autopay") return null;
  if (item.status === "scheduled") {
    const who = item.by === "autopilot" ? "by myself (autopilot)" : "as you said";
    return {
      body: `${due} I scheduled ${formatCents(item.amountCents)} from checking for ${dayLabel(item.runOn)}, ${who}, so it lands on time. You can undo it on Transfers until then. ${STAND_IN_NOTE}`,
      actions: [SEE_TRANSFERS],
      refs: { billKey: item.planKey },
    };
  }
  if (item.status === "ask") {
    const what = amountWords({ amountCents: item.amountCents, full: item.full }, bill.minimumCents);
    return {
      body: `${due} Nothing is set to pay it yet. Checking can cover ${what} on ${dayLabel(item.runOn)} and still keep ${formatCents(PAYCHECK_CUSHION_CENTS)} every day of the forecast. Want me to schedule it? ${STAND_IN_NOTE}`,
      actions: [
        { id: "bill.pay", label: "Pay it", kind: "primary" },
        { id: "bill.skip", label: "I'll pay it myself", kind: "secondary" },
        SEE_TRANSFERS,
      ],
      refs: { billKey: item.planKey },
    };
  }
  const short = `${due} Paying even the ${formatCents(bill.minimumCents)} minimum would take checking below ${formatCents(PAYCHECK_CUSHION_CENTS)} before your next paycheck, so I haven't scheduled it.`;
  return {
    body: item.moveTo
      ? `${short} It lands before payday${payday ? ` (${dayLabel(payday)})` : ""}: ask the lender to move your due date to ${dayLabel(item.moveTo)} or later. Most let you pick it, and then it's paid from the paycheck.`
      : `${short} Pay what you can by then to avoid a late fee.`,
    actions: [],
    refs: { billKey: item.planKey },
  };
}

// "Are my bills paid?": every bill due in the next few weeks and what covers it.
export function billsReply(view: BillPayView | null, asOf: string): Reply {
  if (!view) {
    return {
      body: "Paying bills for you needs a money-movement partner, and none is connected yet. Your upcoming bills are on Today.",
      actions: [],
      refs: {},
    };
  }
  if (view.items.length === 0) {
    return {
      body: "No card or loan payment is due in the next three weeks.",
      actions: [],
      refs: {},
    };
  }
  const lines = view.items.map((item) => {
    const name = `${item.bill.name}, due ${dayLabel(item.bill.dueOn)}`;
    switch (item.status) {
      case "autopay":
        return `${name}: your own autopay covers it.`;
      case "scheduled":
        return `${name}: ${formatCents(item.amountCents)} scheduled for ${dayLabel(item.runOn)}.`;
      case "ask":
        return `${name}: not set to be paid yet; I can pay ${formatCents(item.amountCents)} on ${dayLabel(item.runOn)}.`;
      default:
        return `${name}: checking would run short${item.moveTo ? `, so moving the due date to ${dayLabel(item.moveTo)} would help` : ""}.`;
    }
  });
  const open = view.items.find((i) => i.status === "ask");
  const reply = open ? billPayReply(open, asOf, view.payday) : null;
  return {
    body: `Here's what's due in the next three weeks. ${lines.join(" ")}`,
    actions: reply?.actions ?? [SEE_TRANSFERS],
    refs: reply?.refs ?? {},
  };
}
