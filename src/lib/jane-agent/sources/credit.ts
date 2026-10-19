import { CREDIT_SCORE_MOVE_POINTS, UTILISATION_HIGH } from "@/config/debt";
import { MESSAGE_PRIORITY } from "@/config/agent-chat";
import { formatCents } from "@/lib/money";
import { percent } from "@/planning/credit";
import { CREDIT_PAGE, STAND_IN_LABEL } from "../credit-replies";
import type { Candidate } from "../types";
import { snoozeButton, type MessageSource } from "./source";

// The credit score (spec step 116). After each monthly pull Jane brings up card use high
// enough to hurt the score, with what to pay to bring it down, and a score that moved by
// CREDIT_SCORE_MOVE_POINTS or more. Each once per pull.

export const creditSource: MessageSource = {
  key: "credit",
  gather: (snapshot): Candidate[] => {
    const credit = snapshot.credit;
    const latest = credit?.latest;
    if (!credit || !latest) return [];
    const label = latest.demo ? ` ${STAND_IN_LABEL}` : "";
    const out: Candidate[] = [];
    const u = latest.utilisation;
    if (u && u.share > UTILISATION_HIGH) {
      out.push({
        kind: "heads_up",
        body: `Your cards are at ${percent(u.share)} of their limits (${formatCents(u.balanceCents)} of ${formatCents(u.limitCents)}), which pulls your credit score down. Paying ${formatCents(u.toUnderHighCents)} before the statement closes brings it under ${percent(UTILISATION_HIGH)}.${label}`,
        refs: {},
        actions: [CREDIT_PAGE, snoozeButton()],
        dedupeKey: `use:${latest.pulledOn}`,
        priority: MESSAGE_PRIORITY.credit_utilisation,
      });
    }
    if (
      credit.previousScore !== null &&
      Math.abs(latest.score - credit.previousScore) >= CREDIT_SCORE_MOVE_POINTS
    ) {
      const up = latest.score > credit.previousScore;
      const reason = latest.factors.find((f) => f.impact === (up ? "helping" : "hurting"));
      out.push({
        kind: up ? "done" : "heads_up",
        body: `Your credit score went ${up ? "up" : "down"} ${Math.abs(latest.score - credit.previousScore)} points to ${latest.score}.${reason ? ` ${reason.label}: ${reason.detail}` : ""}${label}`,
        refs: {},
        actions: [CREDIT_PAGE],
        dedupeKey: `moved:${latest.pulledOn}`,
        priority: MESSAGE_PRIORITY.credit_moved,
      });
    }
    return out;
  },
};
