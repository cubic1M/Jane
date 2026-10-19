import type { PrismaClient } from "@/generated/prisma/client";
import { loadPayoff } from "@/lib/debt-plan";
import { loadDebts } from "@/lib/debts";
import { loadTransfers } from "@/lib/balance-transfers";
import { loadStudentLoans } from "@/lib/student-loans";
import { loadMortgage } from "@/lib/mortgage";
import { loadCredit } from "@/lib/credit";
import { listApplications } from "@/lib/loan-applications";
import { checkRates, loadRefinance } from "@/lib/refinance";
import type { DebtIntent } from "./debt-intents";
import { debtReply, payoffReply } from "./debt-replies";
import { loanStatusReply, refinanceReply, transferReply } from "./refinance-replies";
import { studentReply } from "./student-replies";
import { mortgageReply } from "./mortgage-replies";
import { creditReply } from "./credit-replies";
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
      return refinanceReply(intent.target, refi, await loadDebts(userId, { client, now }));
    }
    case "credit_score":
      return creditReply(await loadCredit(userId, { client, now }));
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
