import type { PrismaClient } from "@/generated/prisma/client";
import { loadPayoff } from "@/lib/debt-plan";
import { loadDebts } from "@/lib/debts";
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
import { PROJECT_YEARS_DEFAULT } from "@/config/home-equity";
import { checkGoalDraft, loadCreditGoals, planFor } from "@/lib/credit-goals";
import { loadCostlyBorrowing } from "@/lib/costly-borrowing";
import { loadRenting } from "@/lib/renting";
import { ensureBorrowingChecked, loadBorrowingPower } from "@/lib/borrowing-power";
import { computeCreditMonthly, loadCreditMonthly } from "@/lib/credit-monthly";
import { loadFamilyCredit } from "@/lib/family-credit";
import { MortgageMoneyError, loadMortgageMoney } from "@/lib/mortgage-money";
import { loadCarLoan } from "@/lib/car-loan";
import { decide } from "@/lib/debt-decisions";
import { loadFit } from "@/lib/fit";
import { loadDebtReview } from "@/lib/debt-review";
import { loadDebtTrouble } from "@/lib/debt-trouble";
import { compareHomeProject, loadHomeEquity } from "@/lib/home-equity";
import { pullCredit } from "@/lib/credit";
import { listApplications } from "@/lib/loan-applications";
import { checkRates, loadRefinance } from "@/lib/refinance";
import { withCashPayoffs } from "@/lib/refinance-cash";
import type { DebtIntent } from "./debt-intents";
import { debtReply, payoffReply } from "./debt-replies";
import { loanStatusReply, refinanceReply, transferReply } from "./refinance-replies";
import { studentReply } from "./student-replies";
import { mortgageReply } from "./mortgage-replies";
import { creditReply } from "./credit-replies";
import { debtAutopilotReply, debtDueReply } from "./debt-autopilot-replies";
import { betterCardReply, cardFeeReply, cardForReply } from "./credit-card-replies";
import { buildCreditReply, simulateReply } from "./credit-building-replies";
import { bnplNewPlanReply, bnplReply } from "./bnpl-replies";
import { tightReply } from "./tight-money-replies";
import { carDealerReply, carReply } from "./car-replies";
import { homeReply } from "./home-buying-replies";
import { medicalReply } from "./medical-bills-replies";
import { reportFixReply } from "./credit-report-fixes-replies";
import { cardInterestReply } from "./card-interest-replies";
import { longGameReply } from "./student-long-game-replies";
import { familyLoansReply } from "./family-loans-replies";
import { creditGoalReply } from "./credit-goal-replies";
import { costlyReply } from "./costly-borrowing-replies";
import { rentingReply } from "./renting-replies";
import { borrowingReply } from "./borrowing-power-replies";
import { creditMonthlyReply } from "./credit-monthly-replies";
import { familyCreditReply } from "./family-credit-replies";
import { mortgageMoneyReply } from "./mortgage-money-replies";
import { carLoanReply } from "./car-loan-replies";
import { decisionReply } from "./debt-decision-replies";
import { defaultAmount, loanFitReply } from "./loan-fit-replies";
import { debtReviewReply } from "./debt-review-replies";
import { debtTroubleReply } from "./debt-trouble-replies";
import { homeEquityReply } from "./home-equity-replies";
import type { Reply } from "./replies";

// Answers questions about debts by rules (spec Phase Y), with the same loaders as the
// pages, scoped to the person. Called from ./answer.ts.
export async function answerDebt(
  userId: string,
  intent: DebtIntent,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  switch (intent.kind) {
    case "debts":
    case "debt_detail":
      return debtReply(intent, await loadDebts(userId, { client, now }));
    case "payoff_plan":
      return payoffReply(
        await loadPayoff(userId, { client, now, extraCents: intent.extraCents ?? undefined }),
        now.toISOString().slice(0, 10),
      );
    case "refinance": {
      let refi = await loadRefinance(userId, { client, now });
      // Asked before Jane's first monthly check: she checks now.
      if (refi.available && refi.checkedOn === null) {
        await checkRates(userId, { client, now });
        refi = await loadRefinance(userId, { client, now });
      }
      return refinanceReply(
        intent.target,
        await withCashPayoffs(userId, refi, { client, now }),
        await loadDebts(userId, { client, now }),
      );
    }
    case "debt_autopilot":
      return debtAutopilotReply(await loadDebtAutopilot(userId, { client, now }));
    case "debt_due":
      return debtDueReply(await loadDebtAutopilot(userId, { client, now }));
    case "build_credit":
    case "credit_simulate": {
      let data = await loadCreditBuilding(userId, { client, now });
      // Asked before Jane's first monthly pull: she pulls now (a soft pull).
      if (data.available && data.score === null) {
        await pullCredit(userId, { client, now });
        data = await loadCreditBuilding(userId, { client, now });
      }
      return intent.kind === "build_credit" ? buildCreditReply(data) : simulateReply(data);
    }
    case "credit_goal": {
      const goals = await loadCreditGoals(userId, { client, now });
      // A target and a time: preview the plan, ready to start on a tap.
      if (intent.targetScore !== null && intent.months !== null) {
        const asOf = now.toISOString().slice(0, 10);
        const d = new Date(now.getTime());
        d.setUTCMonth(d.getUTCMonth() + intent.months);
        try {
          const draft = checkGoalDraft(
            {
              kind: intent.goalKind,
              targetScore: intent.targetScore,
              targetDate: d.toISOString().slice(0, 10),
            },
            asOf,
          );
          return creditGoalReply(
            goals,
            { ...draft, view: await planFor(userId, draft, { client, now }) },
            { score: intent.targetScore },
          );
        } catch {
          // An out-of-range score falls through to the plan or the prompt.
        }
      }
      return creditGoalReply(goals, null, { score: intent.targetScore });
    }
    case "costly_borrowing":
      return costlyReply(await loadCostlyBorrowing(userId, { client, now }));
    case "credit_monthly":
      return creditMonthlyReply(
        (await loadCreditMonthly(userId, { client })) ??
          (await computeCreditMonthly(userId, { client, now })),
      );
    case "borrowing_power":
      await ensureBorrowingChecked(userId, { client, now });
      return borrowingReply(await loadBorrowingPower(userId, { client, now }));
    case "family_credit":
      return familyCreditReply(await loadFamilyCredit(userId, { client, now }));
    case "renting":
      return rentingReply(await loadRenting(userId, { client, now }));
    case "mortgage_money": {
      try {
        return mortgageMoneyReply(
          await loadMortgageMoney(
            userId,
            {
              lumpCents: intent.lumpCents ?? undefined,
              extraMonthlyCents: intent.extraMonthlyCents ?? undefined,
            },
            { client, now },
          ),
        );
      } catch (error) {
        if (!(error instanceof MortgageMoneyError)) throw error;
        return { body: error.message, actions: [], refs: {} };
      }
    }
    case "loan_fit": {
      const assumed = intent.amountCents === null && defaultAmount(intent.need) > 0;
      const amountCents = intent.amountCents ?? defaultAmount(intent.need);
      return loanFitReply(
        await loadFit(
          userId,
          { need: intent.need, ...(amountCents > 0 ? { amountCents } : {}) },
          { client, now },
        ),
        assumed,
      );
    }
    case "debt_decision":
      return decisionReply(await decide(userId, intent.which, { client, now }));
    case "car_loan":
      return carLoanReply(await loadCarLoan(userId, { client, now }));
    case "debt_review":
      return debtReviewReply(await loadDebtReview(userId, { client, now }));
    case "debt_trouble":
      return debtTroubleReply(await loadDebtTrouble(userId, { client, now }));
    case "home_equity": {
      const data = await loadHomeEquity(userId, { client, now });
      const project =
        intent.topic === "project" && intent.projectCents !== null
          ? await compareHomeProject(
              userId,
              { projectCents: intent.projectCents, years: intent.years ?? PROJECT_YEARS_DEFAULT },
              { client, now },
            ).catch(() => null)
          : null;
      return homeEquityReply(data, intent.topic, project);
    }
    case "family_loans":
      return familyLoansReply(await loadFamilyLoans(userId, { client, now }));
    case "student_long":
      return longGameReply(await loadStudentLongGame(userId, { client, now }));
    case "card_interest":
      return cardInterestReply(await loadCardInterest(userId, { client, now }));
    case "report_fixes":
      return reportFixReply(await loadReportFixes(userId, { client, now }));
    case "medical_bills":
      return medicalReply(await loadMedicalBills(userId, { client, now }));
    case "home_afford":
      return homeReply(
        await loadHomeBuying(
          userId,
          { priceCents: intent.priceCents ?? undefined },
          { client, now },
        ),
        intent.priceCents !== null,
      );
    case "car_afford":
      return carReply(
        await loadCar(userId, { priceCents: intent.priceCents ?? undefined }, { client, now }),
        intent.priceCents !== null,
      );
    case "car_dealer": {
      const price = intent.priceCents ?? undefined;
      return carDealerReply(
        await loadCar(
          userId,
          {
            priceCents: price,
            dealer:
              intent.aprBps !== null && intent.termMonths !== null
                ? { aprBps: intent.aprBps, termMonths: intent.termMonths, feesCents: 0 }
                : undefined,
          },
          { client, now },
        ),
      );
    }
    case "tight_money":
      return tightReply(await loadTightMoney(userId, { client, now }));
    case "bnpl":
      return bnplReply(await loadBnpl(userId, { client, now }));
    case "bnpl_new": {
      const data = await loadBnpl(userId, { client, now });
      if (intent.totalCents === null) {
        return {
          body: 'How much is the plan? Tell me the total, like "can I afford a $300 Klarna plan", and I\'ll check it against your forecast.',
          actions: [],
          refs: {},
        };
      }
      return bnplNewPlanReply(data, intent.totalCents);
    }
    case "card_for":
      return cardForReply(await loadCreditCards(userId, { client, now }), intent.category);
    case "card_fee":
      return cardFeeReply(await loadCreditCards(userId, { client, now }));
    case "card_better":
      return betterCardReply(await loadCreditCards(userId, { client, now }));
    case "credit_score": {
      let credit = await loadCredit(userId, { client, now });
      // Asked before Jane's first monthly pull: she pulls now (a soft pull), then answers.
      if (credit.available && !credit.latest) {
        await pullCredit(userId, { client, now });
        credit = await loadCredit(userId, { client, now });
      }
      return creditReply(credit);
    }
    case "mortgage":
      return mortgageReply(await loadMortgage(userId, { client, now }));
    case "student_loans":
      return studentReply(await loadStudentLoans(userId, { client, now }));
    case "balance_transfer":
      return transferReply(await loadTransfers(userId, { client, now }));
    case "loan_status":
      return loanStatusReply(await listApplications(userId, { client }));
  }
}
