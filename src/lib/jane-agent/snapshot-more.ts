import type { PrismaClient } from "@/generated/prisma/client";
import { switchOf } from "@/lib/agent/switch";
import { autopilotOf } from "@/lib/autopilot";
import { loadDebts } from "@/lib/debts";
import type { DebtBook } from "@/insights/debts";
import { scopedFor } from "@/lib/db-scoped";
import { assetPrompts, promptHref } from "@/lib/owned-assets";
import { openProposals } from "@/lib/proposals";
import type { BudgetProposal, GoalProposal } from "@/planning/proposals";
import { safeLink, stepOf, type AgentStep } from "./agent-steps";
import { loadInsuranceSnapshot, type InsuranceSnapshot } from "./insurance/snapshot";

// The rest of what Jane's brain looks at (spec step 83), loaded with the same code as the
// pages that show it: the autopilot choice (Settings), the set-up suggestions (the plan),
// the steps only the person can do (Actions) and the loans with nothing linked (Things).

export type SnapshotAgentStep = {
  actionId: string;
  step: AgentStep;
  // What the person said yes to, as the card said it.
  title: string;
  company: string;
  // What the agent needs from the person, as Actions says it.
  todo: string | null;
  // The company's cancel page or the new plan's sign-up page (https only).
  url: string | null;
  // The plan the person is switching to.
  switchName: string | null;
};

export type MoreSnapshot = {
  // Null until the person picks how much Jane does on its own.
  autopilot: string | null;
  // Open budget and goal suggestions (categories are filed on their own).
  setupProposals: (BudgetProposal | GoalProposal)[];
  agentSteps: SnapshotAgentStep[];
  // Mortgages and car loans with no home or car linked to them, with the link that opens
  // the add form prefilled.
  assetPrompts: { loanId: string; loanName: string; kind: "home" | "vehicle"; href: string }[];
  // Spec step 109: every debt, as on the loans page.
  debts?: DebtBook;
  // Insurance (spec Phase X), from the same loader as /insurance. Optional, so a snapshot
  // built without it (in tests) says nothing about insurance.
  insurance?: InsuranceSnapshot;
};

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function loadMore(
  userId: string,
  { client, now = new Date() }: { client: PrismaClient; now?: Date },
): Promise<MoreSnapshot> {
  const db = scopedFor(userId, client);
  const [autopilot, proposals, waiting, loans, owned, debts] = await Promise.all([
    autopilotOf(userId, { client }),
    openProposals(userId, { client }),
    db.actions.findMany({
      where: { status: "waiting_on_user" },
      select: {
        id: true,
        status: true,
        agentState: true,
        type: true,
        selfServiceUrl: true,
        userTodo: true,
        decision: {
          select: { cardSnapshot: true, options: true, finding: { select: { evidence: true } } },
        },
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    }),
    db.accounts.findMany({
      where: { type: "loan" },
      select: { id: true, name: true, type: true, subtype: true },
      orderBy: { id: "asc" },
    }),
    db.ownedAssets.findMany({ select: { loanAccountId: true } }),
    loadDebts(userId, { client, now }),
  ]);
  const insurance = await loadInsuranceSnapshot(userId, { client, now });

  return {
    autopilot,
    setupProposals: proposals.filter(
      (p): p is BudgetProposal | GoalProposal => p.kind === "budget" || p.kind === "goal",
    ),
    agentSteps: waiting.flatMap((action): SnapshotAgentStep[] => {
      const step = stepOf(action);
      if (!step) return [];
      const card = (action.decision.cardSnapshot ?? {}) as { title?: unknown };
      const evidence = (action.decision.finding.evidence ?? {}) as { merchant?: unknown };
      return [
        {
          actionId: action.id,
          step,
          title: text(card.title) ?? "Your request",
          company: text(evidence.merchant) ?? "the company",
          todo: text(action.userTodo),
          url: safeLink(action.selfServiceUrl),
          switchName: switchOf(action.decision.options)?.name ?? null,
        },
      ];
    }),
    assetPrompts: assetPrompts(
      loans,
      owned.map((o) => o.loanAccountId),
    ).flatMap((p) =>
      p.kind === "home" || p.kind === "vehicle"
        ? [{ loanId: p.loanId, loanName: p.loanName, kind: p.kind, href: promptHref(p) }]
        : [],
    ),
    debts,
    insurance,
  };
}
