import { DECISION_CONFIDENCE } from "@/config/debt-decisions";
import { decide } from "@/lib/debt-decisions";
import type { DecisionId } from "@/planning/debt-decisions";
import { decisionLink } from "./debt-decision-replies";
import { DECISION_PATTERNS } from "./debt-intents";
import type { DecideContext, Decision } from "./decision";

// The loans sector's answer to "should I ...?" (docs/decisions.md): the question is matched to
// one of the straight answers in src/planning/debt-decisions.ts, which are worked out from the
// person's own debts, cash and rates. Null when the question isn't one of them, and the router
// gives the general answer.

export function decisionIdFor(item: string, label: string): DecisionId | null {
  if (item === "payoff_or_invest") return "pay_or_invest";
  const text = `should i ${label.toLowerCase()}`;
  return DECISION_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

export async function debtDecide(c: DecideContext): Promise<Decision | null> {
  const id = decisionIdFor(c.item, c.label);
  if (!id) return null;
  const d = await decide(c.userId, id, { client: c.client, now: c.now });
  return {
    body: d.sentences.join(" "),
    actions: [decisionLink(d.href)],
    confidence: DECISION_CONFIDENCE[id],
  };
}
