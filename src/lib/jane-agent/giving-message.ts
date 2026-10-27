import type { Gift, GivingView } from "@/lib/giving";
import { formatCents } from "@/lib/money";
import { roundDollars } from "@/planning/tax-estimate-copy";

import type { MessageAction, MessageRefs } from "./types";
import { dayLabel } from "@/lib/day-label";

// Giving in the chat (spec step 168): a gift's missing receipt, the giving options before
// the year ends (each as the tax with and without it; demo advice), and "how should I give".

export const GIVING_HREF = "/taxes?focus=life:giving";

type Message = { body: string; refs: MessageRefs; actions: MessageAction[] };

export function receiptMessage(g: Gift): Message {
  return {
    body: `Your ${formatCents(g.cents)} gift to ${g.payee} on ${dayLabel(g.date)} needs a written receipt from them to count on your taxes. Have you got it?`,
    refs: { taxGift: g.transactionId },
    actions: [
      { id: "tax.receipt_got", label: "I have it", kind: "primary" },
      { id: "open", label: "See your giving", kind: "link", href: GIVING_HREF },
    ],
  };
}

const optionLines = (view: GivingView) =>
  view.options.map(
    (o) =>
      `• ${o.title}: tax about ${roundDollars(o.withCents)} with it, ${roundDollars(o.withoutCents)} without (saves about ${roundDollars(o.savesCents)}).`,
  );

export function givingOptionsMessage(view: GivingView): Message | null {
  if (view.options.length === 0) return null;
  const fund = view.options.some((o) => o.key === "fund") && !view.fund;
  return {
    body: `Giving in ${view.year}: you've given ${formatCents(view.totalCents)} so far. Ways to do more good for the same money, before December 31:\n${optionLines(view).join("\n")}\nThe tax is federal, for the years compared.`,
    refs: { advice: true, taxYear: view.year },
    actions: [
      ...(fund
        ? [{ id: "tax.fund_open", label: "Open a donor-advised fund", kind: "primary" } as const]
        : []),
      { id: "tax.giving_no", label: "Not this year", kind: "secondary" },
      { id: "open", label: "See your giving", kind: "link", href: GIVING_HREF },
    ],
  };
}

export function givingReply(view: GivingView): Message {
  const missing = view.receiptsMissing.length;
  const receipts =
    missing > 0
      ? ` ${missing} ${missing === 1 ? "gift needs its" : "gifts need their"} charity's receipt.`
      : "";
  const head =
    view.gifts.length === 0
      ? `I haven't found any gifts to charity in ${view.year} yet.`
      : `You've given ${formatCents(view.totalCents)} to charity in ${view.year} (${view.gifts.length} ${view.gifts.length === 1 ? "gift" : "gifts"}).${receipts}`;
  const fund = view.fund ? ` Your donor-advised fund: ${view.fund.name}.` : "";
  if (!view.advice) {
    return {
      body: `${head}${fund} Ways to give for less tax will come once Jane works with a tax professional.`,
      refs: {},
      actions: [{ id: "open", label: "See your giving", kind: "link", href: GIVING_HREF }],
    };
  }
  const lines = optionLines(view);
  return {
    body:
      lines.length > 0
        ? `${head}${fund}\nWays to do more good for the same money:\n${lines.join("\n")}`
        : `${head}${fund} At this level of giving, nothing changes your tax: the standard deduction is bigger.`,
    refs: { advice: true },
    actions: [{ id: "open", label: "See your giving", kind: "link", href: GIVING_HREF }],
  };
}
