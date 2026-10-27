import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { sourceLabel } from "@/insights/debts";
import { formatCents } from "@/lib/money";
import { SEE_DEBTS } from "../debt-replies";
import { snoozeButton, type MessageSource } from "./source";
import { formatRate } from "@/lib/percent";
import { dayLabel } from "@/lib/day-label";

// Debts (spec step 109): Jane keeps every debt up to date on its own and says so when
// something new turns up. A buy now, pay later plan found from payments gets one message
// ("I've added it"); a debt with money owed and no rate from anywhere gets one asking for
// it, with a link to the form. Each once per debt.

export const debtsSource: MessageSource = {
  key: "debts",
  gather: (snapshot) => {
    const book = snapshot.debts;
    if (!book) return [];
    const found = book.debts
      .filter((d) => d.kind === "bnpl")
      .map((d) => {
        const left =
          d.balanceCents === null
            ? `${formatCents(d.paymentCents ?? 0)} ${d.paymentEvery === "month" ? "a month" : "every two weeks"}, with what's left not in the payments`
            : `${formatCents(d.balanceCents)} left${d.payoffDate ? `, the last payment on ${dayLabel(d.payoffDate)}` : ""}`;
        const rate =
          d.aprBps === null
            ? "If you know its rate and what's left, add them and I'll count it properly."
            : `It's ${formatRate(d.aprBps)}: ${sourceLabel(d.aprFrom, d.typedOn)}.`;
        return {
          kind: "heads_up" as const,
          body: `I found your ${d.name} from your payments: ${d.description}, ${left}. I've added it to your debts. ${rate}`,
          refs: {},
          actions: [SEE_DEBTS],
          dedupeKey: `found:${d.key}`,
          priority: MESSAGE_PRIORITY.debt_found,
        };
      });
    const missing = book.missingRate
      .filter((d) => d.kind !== "bnpl")
      .map((d) => ({
        kind: "heads_up" as const,
        body: `Your bank doesn't report a rate for your ${d.name}. Add it and I'll count it in your debts and in how you pay them off.`,
        refs: {},
        actions: [
          {
            id: "open" as const,
            label: "Add the rate",
            kind: "link" as const,
            href: `/loans?terms=${encodeURIComponent(d.key)}#terms`,
          },
          snoozeButton(),
        ],
        dedupeKey: `rate:${d.key}`,
        priority: MESSAGE_PRIORITY.debt_missing_rate,
      }));
    return [...found, ...missing];
  },
};
