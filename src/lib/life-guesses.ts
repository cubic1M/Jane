import { BUDGET_SUGGESTION_MONTHS, BUDGET_SUGGESTION_ROUNDING_CENTS } from "@/config/budgets";
import { LIFE_EVENTS, isLifeEventKind, type LifeEventKind } from "@/config/life-events";
import { LIFE_AUTOMATION } from "@/config/life-signals";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadDetectionInput } from "@/detection/engine";
import type { DetectionInput } from "@/detection/types";
import { addDays } from "@/detection/units";
import { budgetSummary } from "@/insights/budgets";
import { lifeEventGuesses, type LifeGuess } from "@/insights/life-signals";
import { loadInsightTransactions } from "@/insights/load";
import { track } from "@/lib/analytics";
import { setBudget } from "@/lib/budgets";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { addDeadline } from "@/lib/deadlines";
import { LifeEventError, startLifeEvent, toggleLifeEventItem } from "@/lib/life-events";

// Life events spotted (spec step 100): Jane's guesses (src/insights/life-signals.ts) for
// one person, minus the kinds they answered, and what it does on its own on Yes: starts
// the checklist (step 72), sets the budgets it needs, flags insurance to review and puts
// reminders on Deadlines. Nothing here moves money, so Yes runs it at every autopilot
// level; nothing runs without the Yes.

type Options = { client?: PrismaClient; now?: Date };

export const LIFE_ANSWERS = ["yes", "not_me", "never"] as const;
export type LifeAnswer = (typeof LIFE_ANSWERS)[number];

// "Don't ask again" covers every kind.
const ALL = "all";

export async function lifeGuessesFor(
  userId: string,
  { client = defaultClient, now = new Date(), input }: Options & { input?: DetectionInput } = {},
): Promise<LifeGuess[]> {
  const db = scopedFor(userId, client);
  const [answers, open] = await Promise.all([
    db.lifeEventAnswers.findMany({ select: { kind: true } }),
    db.lifeEvents.findMany({ where: { completedAt: null }, select: { kind: true } }),
  ]);
  const answered = new Set(answers.map((a) => a.kind));
  if (answered.has(ALL)) return [];
  const going = new Set(open.map((e) => e.kind));
  const guesses = lifeEventGuesses(input ?? (await loadDetectionInput(userId, { client, now })));
  return guesses.filter((g) => !answered.has(g.kind) && !going.has(g.kind));
}

async function record(userId: string, kind: string, answer: LifeAnswer, client: PrismaClient) {
  await scopedFor(userId, client).lifeEventAnswers.upsert({
    where: { userId_kind: { userId, kind } },
    create: { userId, kind, answer },
    update: { answer },
  });
  await track(userId, "life_event_answered", { kind, answer });
}

// "Not me" (this kind) or "Don't ask again" (every kind): never asked again.
export async function declineLifeGuess(
  userId: string,
  kind: LifeEventKind,
  answer: Exclude<LifeAnswer, "yes">,
  { client = defaultClient }: Options = {},
): Promise<void> {
  await record(userId, answer === "never" ? ALL : kind, answer, client);
}

export type ChecklistRun = {
  eventId: string;
  budgets: { category: string; amountCents: number }[];
  reminders: { title: string; dueOn: string }[];
};

// Yes: the checklist, run by Jane as far as it can.
export async function runLifeChecklist(
  userId: string,
  kind: LifeEventKind,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ChecklistRun> {
  const eventId = await startLifeEvent(userId, kind, { client, now });
  await record(userId, kind, "yes", client);
  const plan = LIFE_AUTOMATION[kind];
  const db = scopedFor(userId, client);
  const asOf = now.toISOString().slice(0, 10);

  // Budgets at a usual month, for the categories that don't have one yet.
  const [existing, transactions] = await Promise.all([
    db.budgets.findMany({ select: { category: true } }),
    loadInsightTransactions(db, asOf, BUDGET_SUGGESTION_MONTHS + 1),
  ]);
  const has = new Set(existing.map((b) => b.category));
  const { suggestions } = budgetSummary(transactions, [], asOf);
  const budgets: ChecklistRun["budgets"] = [];
  for (const category of plan.budgets) {
    const cents = suggestions[category] ?? 0;
    if (has.has(category) || cents < BUDGET_SUGGESTION_ROUNDING_CENTS) continue;
    await setBudget(userId, category, (cents / 100).toFixed(2), { client });
    budgets.push({ category, amountCents: cents });
  }
  if (budgets.length > 0 || plan.budgets.some((c) => has.has(c))) {
    await toggleLifeEventItem(userId, eventId, "budget", { client });
  }

  // Insurance to review and the dated items, on Deadlines.
  const reminders: ChecklistRun["reminders"] = [];
  const note = `From your ${LIFE_EVENTS[kind].title.toLowerCase()} checklist.`;
  for (const r of [...(plan.insurance ? [plan.insurance] : []), ...plan.reminders]) {
    const dueOn = addDays(asOf, r.inDays);
    await addDeadline(userId, { title: r.title, dueOn, kind: "other", note }, { client, now });
    reminders.push({ title: r.title, dueOn });
  }
  await track(userId, "life_event_started", { kind, source: "jane" });
  return { eventId, budgets, reminders };
}

export { LifeEventError, isLifeEventKind };
