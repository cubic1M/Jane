import type { PrismaClient } from "@/generated/prisma/client";
import type { ToolOutput } from "@/lib/ask/tools";
import { loadDebts } from "@/lib/debts";
import { formatCents } from "@/lib/money";
import { loadPayoff } from "@/lib/debt-plan";
import { loadTransfers } from "@/lib/balance-transfers";
import { loadStudentLoans } from "@/lib/student-loans";
import { loadMortgage } from "@/lib/mortgage";
import { loadCredit } from "@/lib/credit";
import { loadDebtAutopilot } from "@/lib/debt-autopilot";
import { loadCreditCards } from "@/lib/credit-cards";
import { loadCreditBuilding } from "@/lib/credit-building";
import { loadBnpl } from "@/lib/bnpl";
import { loadTightMoney } from "@/lib/tight-money";
import { loadCar } from "@/lib/car";
import { loadHomeBuying } from "@/lib/home-buying";
import { loadMedicalBills } from "@/lib/medical-bills";
import { loadReportFixes } from "@/lib/credit-report-fixes";
import { loadCardInterest } from "@/lib/card-interest";
import { loadStudentLongGame } from "@/lib/student-long-game";
import { loadFamilyLoans } from "@/lib/family-loans";
import { loadCreditGoals } from "@/lib/credit-goals";
import { loadCostlyBorrowing } from "@/lib/costly-borrowing";
import { loadRenting } from "@/lib/renting";
import { MortgageMoneyError, loadMortgageMoney } from "@/lib/mortgage-money";
import { loadCarLoan } from "@/lib/car-loan";
import { decide } from "@/lib/debt-decisions";
import { loadFit } from "@/lib/fit";
import { adviceMode } from "@/lib/advice-mode";
import { FIT_NEEDS, type FitNeed } from "@/config/fit";
import { DECISIONS, type DecisionId } from "@/planning/debt-decisions";
import { centsIn } from "./debt-decision-replies";
import { loadDebtReview } from "@/lib/debt-review";
import { loadDebtTrouble } from "@/lib/debt-trouble";
import { PROJECT_YEARS_DEFAULT } from "@/config/home-equity";
import { compareHomeProject, loadHomeEquity } from "@/lib/home-equity";
import { listApplications } from "@/lib/loan-applications";
import { loadRefinance } from "@/lib/refinance";
import {
  DEBT_TOOLS,
  debtsToolOutput,
  extraFromInput,
  payoffToolOutput,
  refinanceToolOutput,
  applicationsToolOutput,
  transfersToolOutput,
  studentToolOutput,
  mortgageToolOutput,
  creditToolOutput,
  debtAutopilotToolOutput,
  creditCardsToolOutput,
  creditBuildingToolOutput,
  bnplToolOutput,
  tightMoneyToolOutput,
  carToolOutput,
  homeToolOutput,
  medicalToolOutput,
  reportFixesToolOutput,
  cardInterestToolOutput,
  studentLongGameToolOutput,
  familyLoansToolOutput,
  creditGoalsToolOutput,
  homeEquityToolOutput,
  debtTroubleToolOutput,
  debtReviewToolOutput,
  carLoanToolOutput,
  mortgageMoneyToolOutput,
  costlyBorrowingToolOutput,
  rentingToolOutput,
  loanFitToolOutput,
} from "./debt-tools";

// Runs Claude's debt tools (./debt-tools.ts) for one person: read-only, scoped to them,
// every dollar figure recorded for the guardrails, like ./claude-tools.ts runChatTool.

export const isDebtTool = (name: string) => DEBT_TOOLS.some((t) => t.name === name);

export async function runDebtTool(
  userId: string,
  name: string,
  input: unknown,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<ToolOutput> {
  const cents: number[] = [];
  const money = (value: number) => {
    cents.push(Math.abs(value));
    return value < 0 ? `-${formatCents(-value)}` : formatCents(value);
  };
  const out = (value: unknown): ToolOutput => ({ content: JSON.stringify(value), cents });
  switch (name) {
    case "debts":
      return out(debtsToolOutput(await loadDebts(userId, { client, now }), money));
    case "debt_autopilot":
      return out(debtAutopilotToolOutput(await loadDebtAutopilot(userId, { client, now }), money));
    case "costly_borrowing":
      return out(
        costlyBorrowingToolOutput(await loadCostlyBorrowing(userId, { client, now }), money),
      );
    case "renting":
      return out(rentingToolOutput(await loadRenting(userId, { client, now }), money));
    case "mortgage_money": {
      const args = (input ?? {}) as { lump_cents?: unknown; extra_monthly_cents?: unknown };
      try {
        const view = await loadMortgageMoney(
          userId,
          {
            lumpCents: typeof args.lump_cents === "number" ? args.lump_cents : undefined,
            extraMonthlyCents:
              typeof args.extra_monthly_cents === "number" ? args.extra_monthly_cents : undefined,
          },
          { client, now },
        );
        return out(mortgageMoneyToolOutput(view, money));
      } catch (error) {
        if (!(error instanceof MortgageMoneyError)) throw error;
        return out({ note: error.message });
      }
    }
    case "loan_fit": {
      const a = (input ?? {}) as { need?: unknown; amount_dollars?: unknown; debt_key?: unknown };
      if (typeof a.need !== "string" || !(FIT_NEEDS as readonly string[]).includes(a.need)) {
        return out({ error: "Pick a need: car, home, refinance, consolidation or personal." });
      }
      const view = await loadFit(
        userId,
        {
          need: a.need as FitNeed,
          ...(typeof a.amount_dollars === "number" && a.amount_dollars > 0
            ? { amountCents: Math.round(a.amount_dollars * 100) }
            : {}),
          ...(typeof a.debt_key === "string" ? { debtKey: a.debt_key } : {}),
        },
        { client, now },
      );
      const advice = await adviceMode(userId, { client });
      const output = loanFitToolOutput(view, money, advice);
      // Demo advice only: the options ride along as the chat's pick-one card (refs.options).
      const card = advice && "optionCard" in output ? output.optionCard : null;
      if (!card) return out(output);
      // Told so, it names its pick and why rather than listing every option again.
      return { ...out({ ...output, shownAsACard: true }), options: card };
    }
    case "debt_decision": {
      const which = (input as { which?: unknown } | null)?.which;
      if (typeof which !== "string" || !Object.hasOwn(DECISIONS, which)) {
        return out({ error: "Pick one of the decisions in the tool's list." });
      }
      const d = await decide(userId, which as DecisionId, { client, now });
      for (const c of centsIn(d.sentences)) cents.push(c);
      return out({ answer: d.sentences, demoAdvice: d.advice, page: d.href });
    }
    case "car_loan":
      return out(carLoanToolOutput(await loadCarLoan(userId, { client, now }), money));
    case "debt_review":
      return out(debtReviewToolOutput(await loadDebtReview(userId, { client, now })));
    case "debt_trouble":
      return out(debtTroubleToolOutput(await loadDebtTrouble(userId, { client, now }), money));
    case "home_equity": {
      const args = (input ?? {}) as { project_cents?: unknown; years?: unknown };
      const project =
        typeof args.project_cents === "number"
          ? await compareHomeProject(
              userId,
              {
                projectCents: args.project_cents,
                years: typeof args.years === "number" ? args.years : PROJECT_YEARS_DEFAULT,
              },
              { client, now },
            ).catch(() => null)
          : null;
      return out(
        homeEquityToolOutput(await loadHomeEquity(userId, { client, now }), project, money),
      );
    }
    case "credit_goals":
      return out(creditGoalsToolOutput(await loadCreditGoals(userId, { client, now }), money));
    case "family_loans":
      return out(familyLoansToolOutput(await loadFamilyLoans(userId, { client, now }), money));
    case "student_long_game":
      return out(
        studentLongGameToolOutput(await loadStudentLongGame(userId, { client, now }), money),
      );
    case "card_interest":
      return out(cardInterestToolOutput(await loadCardInterest(userId, { client, now }), money));
    case "credit_report_fixes":
      return out(reportFixesToolOutput(await loadReportFixes(userId, { client, now }), money));
    case "medical_bills":
      return out(medicalToolOutput(await loadMedicalBills(userId, { client, now }), money));
    case "home_purchase": {
      const price = (input as { price_cents?: unknown } | null)?.price_cents;
      return out(
        homeToolOutput(
          await loadHomeBuying(
            userId,
            { priceCents: typeof price === "number" && price > 0 ? Math.round(price) : undefined },
            { client, now },
          ),
          money,
        ),
      );
    }
    case "car_purchase": {
      const i = (input ?? {}) as Record<string, unknown>;
      const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : undefined);
      const apr = num(i.dealer_apr_percent);
      const months = num(i.dealer_months);
      const car = await loadCar(
        userId,
        {
          priceCents: num(i.price_cents) && Math.round(num(i.price_cents)!),
          dealer:
            apr !== undefined && months !== undefined
              ? { aprBps: Math.round(apr * 100), termMonths: Math.round(months), feesCents: 0 }
              : undefined,
        },
        { client, now },
      );
      return out(carToolOutput(car, money));
    }
    case "tight_money":
      return out(tightMoneyToolOutput(await loadTightMoney(userId, { client, now }), money));
    case "bnpl_installments": {
      const total = (input as { total_cents?: unknown } | null)?.total_cents;
      return out(
        bnplToolOutput(
          await loadBnpl(userId, { client, now }),
          typeof total === "number" && Number.isInteger(total) && total > 0 ? total : null,
          money,
        ),
      );
    }
    case "credit_building":
      return out(
        creditBuildingToolOutput(await loadCreditBuilding(userId, { client, now }), money),
      );
    case "credit_cards":
      return out(creditCardsToolOutput(await loadCreditCards(userId, { client, now }), money));
    case "credit_score":
      return out(creditToolOutput(await loadCredit(userId, { client, now }), money));
    case "mortgage":
      return out(mortgageToolOutput(await loadMortgage(userId, { client, now }), money));
    case "student_loans":
      return out(studentToolOutput(await loadStudentLoans(userId, { client, now }), money));
    case "balance_transfers":
      return out(transfersToolOutput(await loadTransfers(userId, { client, now }), money));
    case "loan_applications":
      return out(applicationsToolOutput(await listApplications(userId, { client }), money));
    case "refinance_offers":
      return out(refinanceToolOutput(await loadRefinance(userId, { client, now }), money));
    case "payoff_plan": {
      const payoff = await loadPayoff(userId, { client, now, extraCents: extraFromInput(input) });
      return out(payoffToolOutput(payoff, now.toISOString().slice(0, 10), money));
    }
    default:
      return { content: JSON.stringify({ error: `There's no tool called ${name}.` }), cents: [] };
  }
}
