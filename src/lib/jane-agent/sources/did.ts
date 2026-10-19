import { DID_LOOKBACK_DAYS, MESSAGE_PRIORITY } from "@/config/agent-chat";
import { RULE_UNDO_HOURS } from "@/config/rules";
import { formatCents } from "@/lib/money";
import type { Candidate } from "../types";
import type { MessageSource } from "./source";

// "I did this" (spec step 82): what Jane did on autopilot that it hasn't said yet. A yes a
// standing rule gave (with Undo while it can still be taken back, RULE_UNDO_HOURS) and
// work the agent finished (src/lib/what-jane-did.ts). Each once.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const didSource: MessageSource = {
  key: "did",
  gather(snapshot, { now }) {
    const rules = snapshot.ruleApprovals.map((approval): Candidate => {
      const undoUntil = new Date(approval.createdAt.getTime() + RULE_UNDO_HOURS * HOUR_MS);
      const canUndo = approval.canUndo && undoUntil > now;
      return {
        kind: "done",
        body: canUndo
          ? `I said yes to "${approval.title}" for you, under your rule: ${approval.ruleLabel}. You can undo it for a day, until the work starts.`
          : `I said yes to "${approval.title}" for you, under your rule: ${approval.ruleLabel}.`,
        refs: { decisionId: approval.decisionId, undoUntil: undoUntil.toISOString() },
        actions: [
          ...(canUndo
            ? [{ id: "undo.rule" as const, label: "Undo", kind: "secondary" as const }]
            : []),
          { id: "open", label: "Open", kind: "link", href: "/plan" },
        ],
        dedupeKey: `rule:${approval.decisionId}`,
        priority: MESSAGE_PRIORITY.rule_approval,
      };
    });

    const since = now.getTime() - DID_LOOKBACK_DAYS * DAY_MS;
    const finished = snapshot.finished
      .filter((a) => a.completedAt !== null && a.completedAt.getTime() >= since)
      .map((action): Candidate => ({
        kind: "done",
        body:
          action.confirmedCents !== null && action.confirmedCents > 0
            ? `Done: "${action.title}". ${formatCents(action.confirmedCents)} confirmed back or saved.`
            : `Done: "${action.title}".`,
        refs: { actionId: action.actionId },
        actions: [{ id: "open", label: "See every step", kind: "link", href: "/actions" }],
        dedupeKey: `action:${action.actionId}`,
        priority: MESSAGE_PRIORITY.finished,
      }));
    return [...rules, ...finished];
  },
};
