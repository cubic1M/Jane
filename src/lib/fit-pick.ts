import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { CARD_SELECT, buildCard } from "@/lib/cards";
import { currentHash } from "@/lib/card-text";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { loadFit } from "@/lib/fit";
import { fitCard, parseFitTopic } from "@/lib/fit-card";
import { formatCents } from "@/lib/money";
import { formatRate } from "@/insights/loans";

// Picking a loan option (spec step 282): one tap queues it for the concierge team through the
// usual path: a finding for the choice, a decision with the chosen option kept in its options,
// and a queued action, which shows in /admin/queue. It never applies for a loan or moves money:
// the team sends the person the lender's own steps, and the person applies themselves. Keeping
// what they have is recorded too, with nothing queued. Only in demo advice mode (the lender is
// the stand-in). The options are priced again here, so a stale or made-up option is refused;
// picking twice in a month queues once.

type Options = { client?: PrismaClient; now?: Date };

export class FitPickError extends Error {}

// What the decision keeps about the pick, for the concierge (src/lib/plan-options.ts shows it).
export type LoanPickOptions = {
  loanPick: {
    topic: string;
    optionId: string;
    lender: string;
    aprBps: number;
    termMonths: number;
    paymentCents: number;
    totalCostCents: number;
    feeCents: number;
    savesCents: number | null;
    // Whether it was Jane's pick.
    wasPick: boolean;
  };
};

export type FitPickResult = { decisionId: string; actionId: string | null; kept: boolean };

const ALREADY = "You've already chosen one of these this month.";

export async function pickFitOption(
  userId: string,
  topic: string,
  optionId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<FitPickResult> {
  if (!(await adviceMode(userId, { client }))) {
    throw new FitPickError("Loan options to pick from are only available in demo mode for now.");
  }
  const want = parseFitTopic(topic);
  const view = want ? await loadFit(userId, want, { client, now }) : null;
  const card = view ? fitCard(view, true) : null;
  const option = view?.options.find((o) => o.id === optionId);
  if (!view || !card || !option || !card.options.some((o) => o.id === optionId)) {
    throw new FitPickError("That option isn't available anymore. Ask me for fresh ones.");
  }
  const shown = card.options.find((o) => o.id === optionId)!;
  const kept = option.label === "keep";
  const db = scopedFor(userId, client);
  const key = `loan:${card.topic}:${now.toISOString().slice(0, 7)}`;
  if (await db.findings.findFirst({ where: { key }, select: { id: true } })) {
    throw new FitPickError(ALREADY);
  }

  const what =
    option.label === "payoff"
      ? `Pay off ${view.baseline?.label ?? "the debt"} with your cash`
      : kept
        ? `Keep ${view.baseline?.label ?? "what you have"}`
        : `${option.lender} at ${formatRate(option.aprBps)} for ${option.termMonths} months`;
  const finding = {
    type: "card_interest" as const,
    title: what,
    annualSavingsCents: 0,
    amountCents: option.label === "payoff" ? option.totalCostCents : view.amountCents,
    evidence: {
      loanPick: true,
      need: view.need,
      lender: option.lender,
      // The lender they would apply with themselves; none to pay off with cash or keep.
      applyWith: option.label === "payoff" || kept ? null : option.lender,
      paymentCents: option.paymentCents,
      totalCostCents: option.totalCostCents,
      transactions: [],
    },
  };
  // The card's text is written here, not by the explainer: a card-interest template would talk
  // about card interest. The hash marks it current, so it is never rewritten.
  const explanation = {
    title: what,
    explanation: `${shown.headline}. ${shown.whyThisOne}`,
    giveUp: kept
      ? "Nothing changes."
      : option.label === "payoff"
        ? `${formatCents(option.totalCostCents)} of your cash goes to the debt.`
        : "You apply with the lender yourself; they decide, and the rate can change until they do.",
    alternatives: card.options.filter((o) => o.id !== optionId).map((o) => o.headline),
  };
  const options: LoanPickOptions = {
    loanPick: {
      topic: card.topic,
      optionId,
      lender: option.lender,
      aprBps: option.aprBps,
      termMonths: option.termMonths,
      paymentCents: option.paymentCents,
      totalCostCents: option.totalCostCents,
      feeCents: option.feeCents,
      savesCents: option.savesCents,
      wasPick: optionId === view.pick,
    },
  };

  const result = await db.transaction(async (tx) => {
    const row = await tx.findings
      .create({
        data: {
          userId,
          key,
          ...finding,
          status: kept ? "declined" : "approved",
          confidence: "medium",
          explanation,
          explanationHash: currentHash(finding),
        },
        select: CARD_SELECT,
      })
      .catch((error: unknown) => {
        // Two taps at once: the second finds the key taken.
        if ((error as { code?: string }).code === "P2002") throw new FitPickError(ALREADY);
        throw error;
      });
    const decision = await tx.decisions.create({
      data: {
        userId,
        findingId: row.id,
        choice: kept ? "no" : "yes",
        cardSnapshot: buildCard(row) as unknown as Prisma.InputJsonObject,
        source: "chat",
        options: options as unknown as Prisma.InputJsonObject,
      },
      select: { id: true },
    });
    const action = kept
      ? null
      : await tx.actions.create({
          data: { userId, decisionId: decision.id, type: "card_interest" },
          select: { id: true },
        });
    return { findingId: row.id, decisionId: decision.id, actionId: action?.id ?? null };
  });

  await logAudit(
    { type: "user", id: userId },
    "decision_made",
    { type: "finding", id: result.findingId },
    {
      choice: kept ? "no" : "yes",
      source: "chat",
      changed_options: true,
      decision_id: result.decisionId,
      action_id: result.actionId,
      loan_pick: `${card.topic}:${optionId}`,
      payment: formatCents(option.paymentCents),
    },
  );
  await track(userId, "loan_option_picked", {
    need: view.need,
    kept,
    was_pick: optionId === view.pick,
  });
  return { decisionId: result.decisionId, actionId: result.actionId, kept };
}
