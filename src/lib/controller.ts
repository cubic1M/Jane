import type { PlaidApi } from "plaid";
import {
  CONTROLLER_BUDGET_MS,
  CONTROLLER_CRON_BUDGET_MS,
  CONTROLLER_STEPS,
  CONTROLLER_SYNC_HOURS,
  type ControllerStep,
} from "@/config/controller";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { loadChanges } from "@/lib/changes";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { refreshDebts } from "@/lib/debt-refresh";
import { insuranceAutopilot } from "@/lib/insurance/autopilot";
import { reshopPerson } from "@/lib/insurance/shop";
import { loadRebalance } from "@/lib/investments/rebalance";
import { enqueueJob, runDueJobs } from "@/lib/jobs";
import { runPaycheckPlan } from "@/lib/money-movement/paycheck";
import { settleTransfers } from "@/lib/money-movement/transfers";
import { runBillPay } from "@/lib/money-movement/bill-pay";
import { runPlanUpkeep } from "@/lib/plan-upkeep";
import { ITEM_STATUS, syncItem } from "@/lib/plaid/sync";
import { scrub } from "@/lib/scrub";
import { runTaxAutopilot } from "@/lib/tax-autopilot";
import { runStrategist } from "@/lib/strategist";
import { planQuestion } from "@/lib/questions";
import { scanSuggestions } from "@/lib/suggestions";
import { markCashIncome } from "@/categorize/cash-income";
import { reapplyRules } from "@/categorize/reapply";
import { runDetection } from "@/detection/engine";
import { plural } from "@/lib/plural";

// The nightly controller run (spec step 142): one run per person each night that does every
// sector's checks, in CONTROLLER_STEPS' order, through the sectors' own code: sync the
// banks, see what changed, reshop insurance (and switch within its autopilot caps), keep
// debts and rates current, the tax set-aside, portfolio drift, and goals and budgets. A
// failing step is logged and retried on its own through the jobs table; it never stops the
// others. Each run is kept as a log: what ran, what it did, what changed.

type Options = { client?: PrismaClient; now?: Date; api?: PlaidApi };

export type { LastRun, StepLog, StepResult } from "./controller-log";
import type { StepLog, StepResult } from "./controller-log";
import { logsOf } from "./controller-log";
import { isoDay as day } from "@/lib/dates";
import { ownedBy, type OnlyPeople } from "@/lib/only-people";

const HOUR_MS = 60 * 60 * 1000;

// Each step, through its sector's own code. Every one says what it did in a line.
const STEPS: Record<
  ControllerStep,
  (userId: string, o: Required<Pick<Options, "client" | "now">> & Options) => Promise<StepResult>
> = {
  async sync(userId, { client, now, api }) {
    const items = await scopedFor(userId, client).plaidItems.findMany({
      where: {
        status: ITEM_STATUS.active,
        OR: [
          { lastSyncedAt: null },
          { lastSyncedAt: { lt: new Date(now.getTime() - CONTROLLER_SYNC_HOURS * HOUR_MS) } },
        ],
      },
      select: { id: true },
    });
    let added = 0;
    for (const item of items) {
      const result = await syncItem(item.id, { client, now, ...(api ? { api } : {}) });
      added += result.added;
    }
    // Rows saved before a keyword rule got better (uploads especially) are brought up to date,
    // and findings found again from them.
    const recategorized =
      (await reapplyRules(userId, { client })) + (await markCashIncome(scopedFor(userId, client)));
    if (recategorized > 0) await runDetection(userId, { client, now });
    const fixed =
      recategorized > 0
        ? ` Re-sorted ${plural(recategorized, "transaction")} by updated rules.`
        : "";
    if (items.length === 0) return { did: `Already up to date.${fixed}`, changed: recategorized };
    return {
      did: `Synced ${plural(items.length, "bank")}: ${plural(added, "new transaction")}.${fixed}`,
      changed: added + recategorized,
    };
  },
  async changes(userId, { client, now }) {
    const changes = await loadChanges(userId, { client, now });
    return {
      did:
        changes.length === 0
          ? "Nothing new to flag."
          : `${plural(changes.length, "change")} to look at.`,
      changed: changes.length,
    };
  },
  async insurance(userId, { client, now }) {
    const shops = await reshopPerson(userId, { client, now });
    const switched = await insuranceAutopilot(userId, { client, now });
    const better = shops.filter((s) => s.pick !== null).length;
    if (shops.length === 0 && switched === 0) {
      return { did: "No policy due for a reshop.", changed: 0 };
    }
    return {
      did: `Reshopped ${plural(shops.length, "policy", "policies")}: ${better} cheaper for the same cover${switched > 0 ? `, ${switched} switched within your caps` : ""}.`,
      changed: better + switched,
    };
  },
  async debt(userId, { client, now }) {
    // The debt lane's own refresh: the payoff plan's check, refinance rates, loan applications.
    await refreshDebts(userId, { client, now });
    return { did: "Kept your debts, rates and payoff plan current.", changed: 0 };
  },
  async taxes(userId, { client, now }) {
    const { goalStarted } = await runTaxAutopilot(userId, { client, now });
    return {
      did: goalStarted ? "Started your tax set-aside goal." : "Tax set-aside up to date.",
      changed: goalStarted ? 1 : 0,
    };
  },
  async investing(userId, { client, now }) {
    const { plan, investments } = await loadRebalance(userId, { client, now });
    if (investments.accounts.length === 0) return { did: "No investment accounts.", changed: 0 };
    if (!plan) return { did: "Balances checked.", changed: 0 };
    return plan.orders.length === 0
      ? { did: "Your mix is on target.", changed: 0 }
      : {
          did: `Your mix drifted: ${plural(plan.orders.length, "trade")} would bring it back.`,
          changed: plan.orders.length,
        };
  },
  async goals(userId, { client, now }) {
    const { tuned, counted } = await runPlanUpkeep(userId, { client, now });
    if (tuned === 0 && counted === 0) return { did: "Goals and budgets up to date.", changed: 0 };
    return {
      did: [
        tuned > 0 ? `tuned ${plural(tuned, "budget")}` : null,
        counted > 0 ? `counted ${plural(counted, "transfer")} toward your goal` : null,
      ]
        .filter(Boolean)
        .join(", ")
        .replace(/^./, (c) => c.toUpperCase())
        .concat("."),
      changed: tuned + counted,
    };
  },
  async money(userId, { client, now }) {
    const settled = await settleTransfers(userId, { client, now });
    const plan = await runPaycheckPlan(userId, { client, now });
    const auto = plan?.moves.filter((m) => m.status === "auto").length ?? 0;
    const asked = plan?.moves.filter((m) => m.status === "asked").length ?? 0;
    const bills = await runBillPay(userId, { client, now });
    if (settled === 0 && auto === 0 && asked === 0 && bills === 0) {
      return { did: "Nothing to move.", changed: 0 };
    }
    return {
      did: [
        settled > 0 ? `${plural(settled, "transfer")} went through` : null,
        auto > 0 ? `moved ${plural(auto, "part")} of a paycheck by myself` : null,
        asked > 0 ? `${plural(asked, "part")} of a paycheck to ask you about` : null,
        bills > 0 ? `scheduled ${plural(bills, "bill payment")} on time` : null,
      ]
        .filter(Boolean)
        .join(", ")
        .replace(/^./, (c) => c.toUpperCase())
        .concat("."),
      changed: settled + auto + asked + bills,
    };
  },
  async suggestions(userId, { client, now }) {
    // Spec step 256: once a week Claude looks for combinations; its ideas join tonight's
    // ranking. It's optional (no key, past the cost cap, any failure) and never stops the scan.
    await runStrategist(userId, { client, now }).catch((error) =>
      console.error("Strategist failed", { userId, error: scrub(String(error)) }),
    );
    const { fired, selected } = await scanSuggestions(userId, { client, now });
    // Spec step 257: which question to ask next, kept for the chat to read.
    await planQuestion(userId, { client, now });
    // The numbers for Claude, saved for the chat to read in one query (loaded here: that file
    // reaches this one again through the jobs).
    await import("@/lib/jane-agent/claude-tools")
      .then((m) => m.refreshPrimer(userId, { client, now }))
      .catch((error) =>
        console.error("Saving the numbers for Claude failed", {
          userId,
          error: scrub(String(error)),
        }),
      );
    if (fired === 0) return { did: "Nothing new to suggest.", changed: 0 };
    return {
      did: `Checked everything for you: ${plural(fired, "idea")} fit, ${selected.length} worth your attention today.`,
      changed: selected.length,
    };
  },
};

type StepRunner = (typeof STEPS)[ControllerStep];

async function runStep(
  userId: string,
  step: ControllerStep,
  options: Required<Pick<Options, "client" | "now">> & Options,
  run: StepRunner = STEPS[step],
): Promise<StepLog> {
  const started = Date.now();
  try {
    const result = await run(userId, options);
    return { step, status: "ok", ...result, ms: Date.now() - started };
  } catch (error) {
    console.error("Controller step failed", { userId, step, error: scrub(String(error)) });
    return {
      step,
      status: "failed",
      did: "Couldn't check tonight; I'll try again.",
      changed: 0,
      ms: Date.now() - started,
    };
  }
}

// One person's run for tonight, every step in order within the time budget. Runs once a
// day: a second call the same day returns the run already done.
export async function runController(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    api,
    budgetMs = CONTROLLER_BUDGET_MS,
    steps: overrides = {},
  }: Options & {
    budgetMs?: number;
    // Tests replace a step to make it fail or count its calls.
    steps?: Partial<Record<ControllerStep, StepRunner>>;
  } = {},
): Promise<StepLog[]> {
  const db = scopedFor(userId, client);
  const today = day(now);
  const existing = await db.controllerRuns.findFirst({ where: { day: today } });
  if (existing?.finishedAt) return logsOf(existing.steps);
  if (!existing) {
    await db.controllerRuns.createMany({
      data: [{ userId, day: today, startedAt: now }],
      skipDuplicates: true,
    });
  }
  const started = Date.now();
  const logs: StepLog[] = [];
  for (const step of CONTROLLER_STEPS) {
    if (Date.now() - started > budgetMs) {
      logs.push({
        step,
        status: "skipped",
        did: "Out of time tonight; tomorrow.",
        changed: 0,
        ms: 0,
      });
      continue;
    }
    const log = await runStep(userId, step, { client, now, api }, overrides[step]);
    logs.push(log);
    // A failed step is retried on its own, with the jobs table's waits.
    if (log.status === "failed") {
      await enqueueJob("controller_step", { userId, step }, { client, now });
    }
  }
  await db.controllerRuns.updateMany({
    where: { day: today },
    data: {
      steps: logs as unknown as Prisma.InputJsonArray,
      finishedAt: new Date(now.getTime() + (Date.now() - started)),
    },
  });
  return logs;
}

// The jobs table's retry of one failed step: throws on failure, so the job tries again
// later; on success, the night's log shows it.
export async function retryControllerStep(
  userId: string,
  step: string,
  { client = defaultClient, now = new Date(), api }: Options = {},
): Promise<void> {
  if (!(CONTROLLER_STEPS as readonly string[]).includes(step)) throw new Error("Unknown step");
  const name = step as ControllerStep;
  const started = Date.now();
  const result = await STEPS[name](userId, { client, now, api });
  const db = scopedFor(userId, client);
  const run = await db.controllerRuns.findFirst({
    where: { day: { lte: day(now) } },
    orderBy: { day: "desc" },
  });
  if (!run) return;
  const steps = logsOf(run.steps).map((s) =>
    s.step === name ? { ...s, status: "ok" as const, ...result, ms: Date.now() - started } : s,
  );
  await db.controllerRuns.updateMany({
    where: { id: run.id },
    data: { steps: steps as unknown as Prisma.InputJsonArray },
  });
}

// The cron's part (spec step 142): a controller_run job for everyone with an account who
// hasn't had tonight's run, then as many jobs as fit in the time budget. The rest wait in
// the queue for the next job runner.
export async function queueNightlyRuns({
  client = defaultClient,
  now = new Date(),
  budgetMs = CONTROLLER_CRON_BUDGET_MS,
  drain = runDueJobs,
  userIds,
}: Options & { budgetMs?: number; drain?: typeof runDueJobs } & OnlyPeople = {}): Promise<{
  queued: number;
  done: number;
}> {
  const today = day(now);
  // A system job across people: ids only. Each run is scoped to its person.
  const [people, ran, waiting] = await Promise.all([
    client.account.findMany({
      where: ownedBy(userIds),
      distinct: ["userId"],
      select: { userId: true },
    }),
    client.controllerRun.findMany({ where: { day: today }, select: { userId: true } }),
    client.job.findMany({
      where: { kind: "controller_run", status: { in: ["queued", "running"] } },
      select: { payload: true },
    }),
  ]);
  const skip = new Set([
    ...ran.map((r) => r.userId),
    ...waiting.map((j) => (j.payload as { userId?: string } | null)?.userId ?? ""),
  ]);
  const due = people.map((p) => p.userId).filter((id) => !skip.has(id));
  for (const userId of due) await enqueueJob("controller_run", { userId }, { client, now });
  let done = 0;
  const started = Date.now();
  while (Date.now() - started < budgetMs) {
    const counts = await drain({ client, now, userIds });
    const handled = counts.done + counts.retried + counts.failed;
    done += counts.done;
    if (handled === 0) break;
  }
  return { queued: due.length, done };
}
