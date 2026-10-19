import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { autopilotOf } from "@/lib/autopilot";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { addGoal } from "@/lib/goals";
import { loadSelfEmployed } from "@/lib/self-employed";

// What Jane does about taxes by herself before she talks (spec steps 123–127), at the
// autopilot levels that let her act (src/config/tax.ts TAX_AUTOPILOT). Nothing here moves
// money, signs or files: it only sets up things the person can see and change.
//
// Step 123: for freelance income, in demo advice mode, a "Taxes set aside" goal for the
// year's estimated tax, so each payment has somewhere to go.

type Options = { client?: PrismaClient; now?: Date };

const ACTS = ["safe", "all", "custom"];

export const setAsideGoalName = (year: number) => `Taxes set aside for ${year}`;

export async function runTaxAutopilot(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ goalStarted: boolean }> {
  const level = await autopilotOf(userId, { client });
  if (!ACTS.includes(level ?? "")) return { goalStarted: false };
  const self = await loadSelfEmployed(userId, { client, now });
  if (!self.advice || !self.active || !self.federal.needed) return { goalStarted: false };
  const name = setAsideGoalName(self.year);
  const db = scopedFor(userId, client);
  if (await db.savingsGoals.count({ where: { name } })) return { goalStarted: false };
  const target = self.federal.owedCents + (self.state?.owedCents ?? 0);
  const last = self.federal.payments.at(-1)?.date ?? `${self.year + 1}-01-15`;
  await addGoal(
    userId,
    { name, target: (target / 100).toFixed(2), targetDate: last, accountId: "", saved: "" },
    { client },
  );
  await track(userId, "tax_set_aside_goal_started", { by: "autopilot" });
  return { goalStarted: true };
}

// Never lets the chat's run fail.
export async function runTaxAutopilotSafely(userId: string, options: Options = {}): Promise<void> {
  try {
    await runTaxAutopilot(userId, options);
  } catch (error) {
    console.error("Tax autopilot failed", { userId, error: String(error) });
  }
}
