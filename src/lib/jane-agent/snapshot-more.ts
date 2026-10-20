import type { PrismaClient } from "@/generated/prisma/client";
import { switchOf } from "@/lib/agent/switch";
import { autopilotOf } from "@/lib/autopilot";
import { loadPayoff, type Payoff } from "@/lib/debt-plan";
import { loadDebts } from "@/lib/debts";
import { loadTransfers, type Transfers } from "@/lib/balance-transfers";
import { loadStudentLoans, type StudentLoans } from "@/lib/student-loans";
import { loadMortgage, type Mortgage } from "@/lib/mortgage";
import { loadCredit, type Credit } from "@/lib/credit";
import { loadCreditCards, type CreditCards } from "@/lib/credit-cards";
import { loadCreditBuilding, type CreditBuilding } from "@/lib/credit-building";
import { loadBnpl, type Bnpl } from "@/lib/bnpl";
import { loadTightMoney, type TightMoney } from "@/lib/tight-money";
import { loadMedicalBills, type MedicalBills } from "@/lib/medical-bills";
import { loadReportFixes, type ReportFixes } from "@/lib/credit-report-fixes";
import { loadCardInterest, type CardInterest } from "@/lib/card-interest";
import { loadStudentLongGame, type LongGame } from "@/lib/student-long-game";
import { loadFamilyLoans, type FamilyLoans } from "@/lib/family-loans";
import { loadCreditGoals, type CreditGoals } from "@/lib/credit-goals";
import { loadDebtTrouble, type DebtTrouble } from "@/lib/debt-trouble";
import { loadHomeEquity, type HomeEquity } from "@/lib/home-equity";
import type { DetectionInput } from "@/detection/types";
import { loadDebtAutopilot, type DebtAutopilot } from "@/lib/debt-autopilot";
import { listApplications, type LoanApplicationView } from "@/lib/loan-applications";
import { loadRefinance, type Refinance } from "@/lib/refinance";
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
  // Spec step 110: the payoff plan across them, and the one the person started.
  payoff?: Payoff;
  // Spec step 111: the refinance offers Jane keeps, compared with each debt.
  refinance?: Refinance;
  // Spec step 112: the person's loan applications, newest first.
  loanApplications?: LoanApplicationView[];
  // Spec step 113: 0% transfer offers for each card, and the transfers Jane keeps in view.
  transfers?: Transfers;
  // Spec step 114: the student loan plans compared, and forgiveness tracking.
  student?: StudentLoans;
  // Spec step 115: the mortgage, watched.
  mortgage?: Mortgage | null;
  // Spec step 116: the latest credit score Jane pulled, and what's behind it.
  credit?: Credit;
  // Spec step 117: what Jane does about debts by herself, and what she found.
  debtAutopilot?: DebtAutopilot;
  // Spec step 174: what each card earns on the person's spending, and a card that'd earn more.
  creditCards?: CreditCards;
  // Spec step 175: paying before the statement, the on-time streak, the simulator.
  creditBuilding?: CreditBuilding;
  // Spec step 176: buy now, pay later plans, their installments and the forecast.
  bnpl?: Bnpl;
  // Spec step 177: a tight month's plan, and the requests sent.
  tightMoney?: TightMoney;
  // Spec step 180: medical bills found, and the requests sent about them.
  medicalBills?: MedicalBills;
  // Spec step 181: collections and errors on the credit report, and the letters sent.
  reportFixes?: ReportFixes;
  // Spec step 224: card interest, promotions and rate requests.
  cardInterest?: CardInterest;
  // Spec step 225: the long game on student loans.
  studentLongGame?: LongGame;
  // Spec step 226: money between family and friends.
  familyLoans?: FamilyLoans;
  // Spec step 227: credit score plans for a goal.
  creditGoals?: CreditGoals;
  homeEquity?: HomeEquity;
  debtTrouble?: DebtTrouble;
  // Insurance (spec Phase X), from the same loader as /insurance. Optional, so a snapshot
  // built without it (in tests) says nothing about insurance.
  insurance?: InsuranceSnapshot;
};

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function loadMore(
  userId: string,
  { client, now = new Date(), input }: { client: PrismaClient; now?: Date; input?: DetectionInput },
): Promise<MoreSnapshot> {
  const db = scopedFor(userId, client);
  // Every debt loader below works from the same debt book, loaded once.
  const book = await loadDebts(userId, { client, now });
  const refinance = await loadRefinance(userId, { client, now, book });
  const [
    autopilot,
    proposals,
    waiting,
    loans,
    owned,
    payoff,
    loanApplications,
    transfers,
    student,
    mortgage,
    credit,
    debtAutopilot,
    creditCards,
    creditBuilding,
    bnpl,
    tightMoney,
    medicalBills,
    reportFixes,
    cardInterest,
    studentLongGame,
    familyLoans,
    creditGoals,
    debtTrouble,
  ] = await Promise.all([
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
    loadPayoff(userId, { client, now, book }),
    listApplications(userId, { client }),
    loadTransfers(userId, { client, now, book }),
    loadStudentLoans(userId, { client, now, book }),
    loadMortgage(userId, { client, now, book, refinance }),
    loadCredit(userId, { client, now, book }),
    loadDebtAutopilot(userId, { client, now, book }),
    loadCreditCards(userId, { client, now, book }),
    loadCreditBuilding(userId, { client, now, book }),
    loadBnpl(userId, { client, now, book, input }),
    loadTightMoney(userId, { client, now, book, input }),
    loadMedicalBills(userId, { client, now }),
    loadReportFixes(userId, { client, now }),
    loadCardInterest(userId, { client, now, book }),
    loadStudentLongGame(userId, { client, now, book }),
    loadFamilyLoans(userId, { client, now, book }),
    loadCreditGoals(userId, { client, now, book }),
    loadDebtTrouble(userId, { client, now, book, input }),
  ]);
  const homeEquity = await loadHomeEquity(userId, { client, now, mortgage });
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
    debts: payoff.book,
    payoff,
    refinance,
    loanApplications,
    transfers,
    student,
    mortgage,
    credit,
    debtAutopilot,
    creditCards,
    creditBuilding,
    bnpl,
    tightMoney,
    medicalBills,
    reportFixes,
    cardInterest,
    studentLongGame,
    familyLoans,
    creditGoals,
    homeEquity,
    debtTrouble,
    insurance,
  };
}
