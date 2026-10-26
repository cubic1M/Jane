import { PMI_FOLLOW_UP_DAYS } from "@/config/home-equity";
import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import { EQUITY_PAGE, escrowLines, pmiLines, sentButton } from "../home-equity-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";
import { DAY_MS } from "@/lib/dates";

// A home's equity (spec step 228): PMI that can be cancelled against the home's original
// value, with the request drafted; a payment that should have dropped it; a request that has
// gone unanswered; and an escrow account holding more than the bills need, with the refund
// request drafted. Jane never sends either request; "I sent it" only records that the person did.

export const homeEquitySource: MessageSource = {
  key: "home_equity",
  gather: (snapshot, context): Candidate[] => {
    const data = snapshot.homeEquity;
    if (!data?.available) return [];
    const out: Candidate[] = [];
    const acct = data.accountId;
    const p = data.pmi;
    if (data.hasPmi && p) {
      const sent = data.facts.pmiLetterSentOn;
      if (p.endsNow) {
        out.push({
          kind: "heads_up",
          body: `Your loan is under 78% of the home's original value, so PMI has to end by itself when your payments are current. If it's still in your payment, ask your servicer to remove it and confirm in writing.`,
          refs: {},
          actions: [EQUITY_PAGE],
          dedupeKey: `homeeq:pmi_ended:${acct}`,
          priority: MESSAGE_PRIORITY.home_pmi_auto,
        });
      } else if (p.canAskNow && !sent) {
        out.push({
          kind: "decision",
          body: [
            ...pmiLines(data),
            "I drafted the request for you to send. I won't send it myself.",
          ].join("\n"),
          refs: { homeRequest: "pmi" },
          actions: [sentButton("pmi"), EQUITY_PAGE, snoozeButton()],
          dedupeKey: `homeeq:pmi:${acct}`,
          priority: MESSAGE_PRIORITY.home_pmi_ask,
        });
      } else if (
        p.canAskNow &&
        sent &&
        context.now.getTime() - Date.parse(`${sent}T00:00:00Z`) >= PMI_FOLLOW_UP_DAYS * DAY_MS
      ) {
        out.push({
          kind: "heads_up",
          body: `It's been ${PMI_FOLLOW_UP_DAYS} days since you sent the PMI request and your bank still shows PMI. Ask your servicer for an answer in writing, and keep a copy of what you send.`,
          refs: {},
          actions: [EQUITY_PAGE],
          dedupeKey: `homeeq:pmi_followup:${acct}:${sent}`,
          priority: MESSAGE_PRIORITY.home_pmi_auto,
        });
      }
    }
    const e = data.escrow;
    if (e && e.kind === "over" && !data.facts.escrowRequestSentOn) {
      out.push({
        kind: "decision",
        body: [
          ...escrowLines(data),
          "I drafted the request for you to send. I won't send it myself.",
        ].join("\n"),
        refs: { homeRequest: "escrow" },
        actions: [sentButton("escrow"), EQUITY_PAGE, snoozeButton()],
        dedupeKey: `homeeq:escrow:${acct}:${formatCents(e.surplusCents || e.gapYearlyCents)}`,
        priority: MESSAGE_PRIORITY.home_escrow_over,
      });
    }
    return out;
  },
};
