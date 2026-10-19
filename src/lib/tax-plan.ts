import { W4_LIFE_EVENTS } from "@/config/tax-plan";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { addDeadline } from "@/lib/deadlines";
import { loadInvestmentTaxes } from "@/lib/investment-taxes";
import { loadSelfEmployed, type SelfEmployedView } from "@/lib/self-employed";
import { recordAct } from "@/lib/sector-autopilot";
import { loadTaxEstimate, type TaxEstimateView } from "@/lib/tax-estimate";
import { loadTaxTags } from "@/lib/tax-organizer";
import { loadTaxSavings, type TaxSavingsView } from "@/lib/tax-savings";
import { taxPlan, type PlanMove } from "@/planning/tax-plan";

// The year-round tax plan (spec step 167), loaded from what Jane knows about the tax year.
// Each move that's open now is brought up once: at the levels that let Jane act she puts its
// reminder on the deadlines herself; otherwise "Add to my deadlines" does. Nothing past its
// deadline is offered, and nothing here moves money: contributions, payments, sales and
// gifts are always the person's.

type Options = { client?: PrismaClient; now?: Date };

export class TaxPlanError extends Error {}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export type PlanMoveView = PlanMove & { handled: "added" | "no" | null };

export type TaxPlanView = { year: number; advice: boolean; moves: PlanMoveView[] };

export async function loadTaxPlan(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    loaded,
  }: Options & {
    loaded?: {
      estimate: TaxEstimateView;
      advice: boolean;
      // Already loaded by the caller (Jane's snapshot), so not loaded twice.
      savings?: TaxSavingsView;
      selfEmployed?: SelfEmployedView;
    };
  } = {},
): Promise<TaxPlanView> {
  const [estimate, advice] = loaded
    ? [loaded.estimate, loaded.advice]
    : await Promise.all([loadTaxEstimate(userId, { client, now }), adviceMode(userId, { client })]);
  const year = estimate.year;
  const db = scopedFor(userId, client);
  const [savings, self, investments, tags, events, filed, profile] = await Promise.all([
    loaded?.savings ?? loadTaxSavings(userId, { client, now, loaded: { estimate, advice } }),
    loaded?.selfEmployed ?? loadSelfEmployed(userId, { client, now, loaded: { estimate, advice } }),
    advice ? loadInvestmentTaxes(userId, year, { client, now }) : null,
    loadTaxTags(userId, year, { client }),
    db.lifeEvents.findMany({
      where: { kind: { in: [...W4_LIFE_EVENTS] } },
      select: { kind: true, startedOn: true },
    }),
    db.taxReturns.count({ where: { year, status: { in: ["submitted", "accepted"] } } }),
    db.taxProfiles.findFirst({ select: { planHandled: true } }),
  ]);
  const top = investments?.harvest[0];
  const moves = taxPlan({
    year,
    today: iso(now),
    advice,
    savings: savings.savings,
    estimated: self.active && self.federal.needed ? self.federal.payments : [],
    harvest: top
      ? { name: top.holding.ticker ?? top.holding.name, lossCents: top.lossCents }
      : null,
    donationsCents: tags.totals.donation.totalCents,
    lifeEvents: events.map((e) => ({ kind: e.kind, startedOn: iso(e.startedOn) })),
    filed: filed > 0,
  });
  const handled = profile?.planHandled ?? [];
  return {
    year,
    advice,
    moves: moves.map((m) => ({
      ...m,
      handled: handled.includes(`${m.id}:added`)
        ? "added"
        : handled.includes(`${m.id}:no`)
          ? "no"
          : null,
    })),
  };
}

async function mark(userId: string, id: string, how: "added" | "no", client: PrismaClient) {
  const db = scopedFor(userId, client);
  const existing = await db.taxProfiles.findFirst({ select: { planHandled: true } });
  const planHandled = [...(existing?.planHandled ?? []), `${id}:${how}`];
  await db.taxProfiles.upsert({
    where: { userId },
    create: { userId, planHandled },
    update: { planHandled },
  });
}

async function openMove(userId: string, id: string, client: PrismaClient, now: Date) {
  const plan = await loadTaxPlan(userId, { client, now });
  const move = plan.moves.find((m) => m.id === id);
  // Never past its deadline: the plan leaves those out.
  if (!move) throw new TaxPlanError("That's past its deadline now.");
  if (move.handled) throw new TaxPlanError("That's already done.");
  return move;
}

// "Add to my deadlines": the move's reminder, due on its deadline.
export async function addPlanMove(
  userId: string,
  id: string,
  {
    client = defaultClient,
    now = new Date(),
    via,
  }: Options & { via: "chat" | "page" | "autopilot" },
): Promise<PlanMove> {
  const move = await openMove(userId, id, client, now);
  await addDeadline(
    userId,
    { title: move.task.title, dueOn: move.task.dueOn, kind: "other", note: move.task.note },
    { client, now },
  );
  await mark(userId, id, "added", client);
  await track(userId, "tax_plan_move_added", { move: move.key, via });
  return move;
}

export async function dismissPlanMove(
  userId: string,
  id: string,
  { client = defaultClient, now = new Date(), via }: Options & { via: "chat" | "page" },
): Promise<PlanMove> {
  const move = await openMove(userId, id, client, now);
  await mark(userId, id, "no", client);
  await track(userId, "tax_plan_move_dismissed", { move: move.key, via });
  return move;
}

// At the levels that let Jane act: every move open now and not handled goes on the
// deadlines. Returns the moves she added.
export async function addOpenPlanMoves(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<PlanMove[]> {
  const plan = await loadTaxPlan(userId, { client, now });
  const added: PlanMove[] = [];
  for (const move of plan.moves.filter((m) => m.open && !m.handled)) {
    added.push(await addPlanMove(userId, move.id, { client, now, via: "autopilot" }));
    await recordAct(userId, "taxes", 0, `Put "${move.title}" on your deadlines`, {
      client,
      now,
    });
  }
  return added;
}
