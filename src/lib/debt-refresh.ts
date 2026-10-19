import type { PrismaClient } from "@/generated/prisma/client";
import { refreshDebtPlan } from "@/lib/debt-plan";
import { refreshLoanApplications } from "@/lib/loan-applications";
import { refreshRefinance } from "@/lib/refinance";

// What Jane keeps current about debts by herself before her brain looks at the person's
// money (src/lib/jane-agent/run.ts): the payoff plan's monthly check (spec step 110) and
// the monthly refinance rate check (spec step 111). One
// failing never stops the others or the run.
export async function refreshDebts(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<void> {
  const steps: [string, () => Promise<unknown>][] = [
    ["payoff plan", () => refreshDebtPlan(userId, { client, now })],
    // Spec step 111: asks the lender partner for rates once a month.
    ["refinance rates", () => refreshRefinance(userId, { client, now })],
    // Spec step 112: loans funding, and old loans reaching zero.
    ["loan applications", () => refreshLoanApplications(userId, { client, now })],
  ];
  for (const [what, run] of steps) {
    await run().catch((error) =>
      console.error(`Debt refresh failed: ${what}`, { userId, error: String(error) }),
    );
  }
}
