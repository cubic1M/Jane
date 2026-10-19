import type { PrismaClient } from "@/generated/prisma/client";
import { refreshDebtPlan } from "@/lib/debt-plan";

// What Jane keeps current about debts by herself before her brain looks at the person's
// money (src/lib/jane-agent/run.ts): the payoff plan's monthly check (spec step 110). One
// failing never stops the others or the run.
export async function refreshDebts(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<void> {
  const steps: [string, () => Promise<unknown>][] = [
    ["payoff plan", () => refreshDebtPlan(userId, { client, now })],
  ];
  for (const [what, run] of steps) {
    await run().catch((error) =>
      console.error(`Debt refresh failed: ${what}`, { userId, error: String(error) }),
    );
  }
}
