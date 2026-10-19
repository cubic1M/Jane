import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { addGoal } from "@/lib/goals";
import { mayAct, recordAct } from "@/lib/sector-autopilot";
import { loadSelfEmployed } from "@/lib/self-employed";
import { filingPartnerFor } from "@/lib/filing";
import { FilingError, filingYear, inFilingSeason, startReturn } from "@/lib/tax-filing";
import { loadTaxForms } from "@/lib/tax-organizer";
import { collectTaxDocuments } from "@/lib/tax-documents";
import { addOpenPlanMoves } from "@/lib/tax-plan";

// What Jane does about taxes by herself before she talks (spec steps 123–127), at the
// autopilot levels that let her act (src/config/tax.ts TAX_AUTOPILOT). Nothing here moves
// money, signs or files: it only sets up things the person can see and change.
//
// Step 123: for freelance income, in demo advice mode, a "Taxes set aside" goal for the
// year's estimated tax, so each payment has somewhere to go.

type Options = { client?: PrismaClient; now?: Date };

export const setAsideGoalName = (year: number) => `Taxes set aside for ${year}`;

export async function runTaxAutopilot(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{
  goalStarted: boolean;
  returnStarted: boolean;
  documents: { collected: number; ticked: number };
  planAdded: number;
}> {
  // Spec step 141: Taxes' autopilot. Starting a return or a goal moves no money: the level
  // is enough.
  const acts = (await mayAct(userId, "taxes", { needs: "safe", cents: 0 }, { client, now })).ok;
  // Spec step 166: collecting tax forms only reads, so Jane does it at every level; ticking
  // off the ones that check out is for the levels that let her act.
  const documents = await collectTaxDocuments(userId, { client, now, tick: acts });
  if (!acts) return { goalStarted: false, returnStarted: false, documents, planAdded: 0 };
  return {
    returnStarted: await startReturnWhenReady(userId, client, now),
    goalStarted: await startSetAsideGoal(userId, client, now),
    documents,
    // Spec step 167: each tax move open now goes on the deadlines.
    planAdded: (await addOpenPlanMoves(userId, { client, now })).length,
  };
}

// Step 126: in filing season, once the profile is answered and every expected form is in,
// the return is started with the filing partner, ready to review. Never signed or filed.
async function startReturnWhenReady(userId: string, client: PrismaClient, now: Date) {
  const today = now.toISOString().slice(0, 10);
  const year = filingYear(today);
  if (!inFilingSeason(year, today)) return false;
  if (!(await filingPartnerFor(userId, { client }))) return false;
  if (await scopedFor(userId, client).taxReturns.count({ where: { year } })) return false;
  const forms = await loadTaxForms(userId, year, { client, now });
  if (forms.forms.some((f) => !f.received && !f.mayNotSend)) return false;
  try {
    await startReturn(userId, { client, now, via: "autopilot" });
    return true;
  } catch (error) {
    if (error instanceof FilingError) return false;
    throw error;
  }
}

async function startSetAsideGoal(userId: string, client: PrismaClient, now: Date) {
  const self = await loadSelfEmployed(userId, { client, now });
  if (!self.advice || !self.active || !self.federal.needed) return false;
  const name = setAsideGoalName(self.year);
  const db = scopedFor(userId, client);
  if (await db.savingsGoals.count({ where: { name } })) return false;
  const target = self.federal.owedCents + (self.state?.owedCents ?? 0);
  const last = self.federal.payments.at(-1)?.date ?? `${self.year + 1}-01-15`;
  await addGoal(
    userId,
    { name, target: (target / 100).toFixed(2), targetDate: last, accountId: "", saved: "" },
    { client },
  );
  await track(userId, "tax_set_aside_goal_started", { by: "autopilot" });
  await recordAct(userId, "taxes", 0, `Started the goal "${name}"`, { client, now });
  return true;
}

// Never lets the chat's run fail.
export async function runTaxAutopilotSafely(userId: string, options: Options = {}): Promise<void> {
  try {
    await runTaxAutopilot(userId, options);
  } catch (error) {
    console.error("Tax autopilot failed", { userId, error: String(error) });
  }
}
