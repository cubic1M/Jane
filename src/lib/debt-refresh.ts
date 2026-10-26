import type { PrismaClient } from "@/generated/prisma/client";
import { refreshBorrowing } from "@/lib/borrowing-power";
import { runCreditMonthly } from "@/lib/credit-monthly";
import { refreshCredit } from "@/lib/credit";
import { runDebtAutopilot } from "@/lib/debt-autopilot";
import { runCreditBuilding } from "@/lib/credit-building";
import { refreshTightMoney } from "@/lib/tight-money";
import { refreshMedicalBills } from "@/lib/medical-bills";
import { refreshReportFixes } from "@/lib/credit-report-fixes";
import { refreshCardInterest } from "@/lib/card-interest";
import { refreshCarLoan } from "@/lib/car-loan";
import { runDebtReview } from "@/lib/debt-review";
import { syncStudentDeadlines } from "@/lib/student-long-game";
import { refreshFamilyLoans } from "@/lib/family-loans";
import { refreshDebtPlan } from "@/lib/debt-plan";
import { refreshLoanApplications } from "@/lib/loan-applications";
import { refreshRefinance } from "@/lib/refinance";

// What Jane keeps current about debts on its own before its brain looks at the person's
// money (src/lib/jane-agent/run.ts): the payoff plan's monthly check (spec step 110) and
// the monthly refinance rate check (spec step 111). One
// failing never stops the others or the run.
export async function refreshDebts(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<void> {
  const steps: [string, () => Promise<unknown>][] = [
    ["payoff plan", () => refreshDebtPlan(userId, { client, now })],
    // Spec step 117: rates watched, and the payoff plan started when the debt sector allows.
    ["debt autopilot", () => runDebtAutopilot(userId, { client, now })],
    // Spec step 111: asks the lender partner for rates once a month.
    // Spec step 116: the monthly soft pull, before the rate check that's priced by it.
    ["credit score", () => refreshCredit(userId, { client, now })],
    // Spec step 175: from "Handle the safe stuff", the payment before a card's statement.
    ["statement payment", () => runCreditBuilding(userId, { client, now })],
    // Spec step 177: the lender stand-in answers requests after a couple of days.
    ["tight money requests", () => refreshTightMoney(userId, { client, now })],
    // Spec step 180: the provider stand-in answers medical bill requests after a couple of days.
    ["medical bill requests", () => refreshMedicalBills(userId, { client, now })],
    // Spec step 181: the collector and the bureaus answer letters after a few days.
    ["credit report letters", () => refreshReportFixes(userId, { client, now })],
    // Spec step 224: lender answers to rate requests, and a deadline on each promotion off pace.
    ["card interest", () => refreshCardInterest(userId, { client, now })],
    // Spec step 225: the PSLF certification, recertification and forgiven-debt tax dates.
    ["student loan dates", () => syncStudentDeadlines(userId, { client, now })],
    // Spec step 226: loans paid back in full by the transfers that came back are settled.
    ["family loans", () => refreshFamilyLoans(userId, { client, now })],
    // Spec step 230: the yearly review, after everything it looks at has been refreshed.
    ["debt review", () => runDebtReview(userId, { client, now })],
    ["refinance rates", () => refreshRefinance(userId, { client, now })],
    // Spec step 245: rates that fell or a score that rose, noticed once.
    ["car loan", () => refreshCarLoan(userId, { client, now })],
    // Spec step 250: what they could borrow, soft-checked once a month after the score.
    ["borrowing power", () => refreshBorrowing(userId, { client, now })],
    // Spec step 251: the monthly credit check-up, after every check it reads.
    ["credit check-up", () => runCreditMonthly(userId, { client, now })],
    // Spec step 112: loans funding, and old loans reaching zero.
    ["loan applications", () => refreshLoanApplications(userId, { client, now })],
  ];
  for (const [what, run] of steps) {
    await run().catch((error) =>
      console.error(`Debt refresh failed: ${what}`, { userId, error: String(error) }),
    );
  }
}
