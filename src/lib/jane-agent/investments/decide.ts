import { KNOWN_COMPANIES, type DecisionKind } from "@/config/investing-decisions";
import { loadDecisionFacts } from "@/lib/investments/decision";
import type { DecideContext, Decision } from "../decision";
import { decisionReply } from "./decision-reply";

// Investing's answer to the router's decision questions (docs/decisions.md): the subjects the
// router reads as ours, and how each is answered, in three sentences or fewer from the person's
// own numbers (src/planning/investing-decision.ts).

export const INVESTING_DECIDES = ["crypto", "stocks", "invest", "payoff_or_invest"] as const;

const KIND_OF: Record<(typeof INVESTING_DECIDES)[number], DecisionKind> = {
  crypto: "buy_crypto",
  stocks: "buy_stock",
  invest: "start",
  payoff_or_invest: "invest_vs_debt",
};

export const companyIn = (text: string): string | null => {
  const found = Object.entries(KNOWN_COMPANIES).find(([k]) =>
    new RegExp(`\\b${k}\\b`, "i").test(text),
  );
  return found ? found[1] : null;
};

export async function investingDecide({
  userId,
  client,
  now,
  item,
  label,
}: DecideContext): Promise<Decision | null> {
  const kind = KIND_OF[item as keyof typeof KIND_OF];
  if (!kind) return null;
  const facts = await loadDecisionFacts(userId, { client, now });
  const reply = decisionReply(kind, facts, kind === "buy_crypto" ? label : companyIn(label));
  // How sure: lower when Jane has no emergency target or income to measure against.
  const known = facts.emergencyTargetCents > 0 && facts.monthlyIncomeCents !== null;
  return {
    body: reply.body,
    actions: reply.actions,
    confidence: known
      ? { percent: 85, reason: "your debts, savings and goals" }
      : { percent: 70, reason: "your debts and savings, with no income or cushion target yet" },
  };
}
