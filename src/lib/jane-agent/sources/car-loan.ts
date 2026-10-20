import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import {
  CAR_LOAN_PAGE,
  candidateQuestion,
  mineButton,
  noButton,
  refundQuestion,
  teamButton,
  yesButton,
} from "../car-loan-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// The car loan you already have (spec step 245): a dealer add-on found in the payments asked
// about once, and, for one the person confirmed, the refund and the drafted cancellation to
// send themselves or hand to the team. Jane sends nothing.

export const carLoanSource: MessageSource = {
  key: "car_loan",
  gather: (snapshot): Candidate[] => {
    const data = snapshot.carLoan;
    if (!data?.available) return [];
    const out: Candidate[] = [];
    const first = data.candidates[0];
    if (first) {
      out.push({
        kind: "decision",
        body: candidateQuestion(first),
        refs: { carAddon: { key: first.key } },
        actions: [yesButton(first.label), noButton(), snoozeButton()],
        dedupeKey: `caraddon:${first.key}`,
        priority: MESSAGE_PRIORITY.car_addon_found,
      });
    }
    for (const a of data.addons) {
      if (a.status !== "confirmed" || !a.worthCancelling || !a.id) continue;
      out.push({
        kind: "decision",
        body: refundQuestion(a),
        refs: { carAddon: { id: a.id } },
        actions: [mineButton(), teamButton(), CAR_LOAN_PAGE, snoozeButton()],
        dedupeKey: `caraddon_refund:${a.id}`,
        priority: MESSAGE_PRIORITY.car_addon_refund,
      });
    }
    return out;
  },
};
