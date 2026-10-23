import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { TROUBLE_PAYMENT_SHARE } from "@/config/debt-trouble";
import { formatCents } from "@/lib/money";
import { TROUBLE_PAGE, headline } from "../debt-trouble-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// When debt is too much (spec step 229): once a quarter, when debt is over the line (payments
// against income, card debt against income, or a payday-loan cycle), Jane says so and where
// the options are. Facts, no advice.

const quarter = (iso: string) =>
  `${iso.slice(0, 4)}q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}`;

export const debtTroubleSource: MessageSource = {
  key: "debt_trouble",
  gather: (snapshot, context): Candidate[] => {
    const data = snapshot.debtTrouble;
    if (!data?.available || !data.over || data.share === null) return [];
    // The scan's hardship suggestion says the same thing with its button: one message
    // (docs/feature-audit.md, cluster 14).
    if ((snapshot.suggestions ?? []).some((s) => s.topic === "hardship_plan")) return [];
    const lead =
      data.reason === "payments"
        ? `Your debt payments are ${formatCents(data.monthlyPaymentsCents)} a month, ${Math.round(data.share * 100)}% of your income, over the ${Math.round(TROUBLE_PAYMENT_SHARE * 100)}% mark where it can get hard to keep up.`
        : headline(data);
    return [
      {
        kind: "heads_up",
        body: `${lead} If it is, there are hardship programs, nonprofit counseling and other options, and I can lay them out plainly: just ask "what are my options with my debt?"`,
        refs: {},
        actions: [TROUBLE_PAGE, snoozeButton()],
        dedupeKey: `trouble:${quarter(context.local.date)}`,
        priority: MESSAGE_PRIORITY.debt_trouble,
      },
    ];
  },
};
