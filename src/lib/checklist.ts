import { CHECKLIST_CARDS_TO_REVIEW, CHECKLIST_DAYS } from "@/config/home";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// The checklist on Home for someone's first weeks. Each item ticks itself from what the
// person has actually done (never from clicks on the checklist), and each fires a funnel
// event the first time it's seen done.

export type ChecklistKey = "link_bank" | "review_cards" | "budget_or_goal" | "alerts";

export type ChecklistItem = {
  key: ChecklistKey;
  label: string;
  href: string;
  done: boolean;
  // e.g. "1 of 3", while partly done.
  progress?: string;
};

export type Checklist = {
  items: ChecklistItem[];
  // Done now but not recorded yet: these get their funnel event.
  newlyDone: ChecklistKey[];
  // Every item done: the checklist is no longer shown.
  complete: boolean;
};

type Options = { client?: PrismaClient; now?: Date };

const DAY_MS = 24 * 60 * 60 * 1000;

const progressOf = (value: unknown): Record<string, string> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, string>)
    : {};

// Null when it isn't shown at all: hidden by the person, or past the first weeks.
export async function firstWeekChecklist(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<Checklist | null> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      createdAt: true,
      checklistDismissedAt: true,
      checklistProgress: true,
      alertPrefs: true,
    },
  });
  if (!user || user.checklistDismissedAt) return null;
  if (now.getTime() - user.createdAt.getTime() > CHECKLIST_DAYS * DAY_MS) return null;

  const db = scopedFor(userId, client);
  const [accounts, decisions, budgets, goals, devices] = await Promise.all([
    db.accounts.count(),
    db.decisions.count({ where: { undoneAt: null } }),
    db.budgets.count(),
    db.savingsGoals.count(),
    db.pushSubscriptions.count(),
  ]);
  // Alert preferences start empty ({}) and are saved whole from /settings.
  const alertsChosen = Object.keys(progressOf(user.alertPrefs)).length > 0 || devices > 0;
  const reviewed = Math.min(decisions, CHECKLIST_CARDS_TO_REVIEW);

  const items: ChecklistItem[] = [
    {
      key: "link_bank",
      label: "Link a bank or import a statement",
      href: "/connect",
      done: accounts > 0,
    },
    {
      key: "review_cards",
      label: `Decide on ${CHECKLIST_CARDS_TO_REVIEW} of your cards`,
      href: "/report",
      done: decisions >= CHECKLIST_CARDS_TO_REVIEW,
      progress:
        reviewed > 0 && reviewed < CHECKLIST_CARDS_TO_REVIEW
          ? `${reviewed} of ${CHECKLIST_CARDS_TO_REVIEW}`
          : undefined,
    },
    {
      key: "budget_or_goal",
      label: "Set a budget or a savings goal",
      href: "/budgets",
      done: budgets + goals > 0,
    },
    {
      key: "alerts",
      label: "Choose how alerts reach you",
      href: "/settings#alerts",
      done: alertsChosen,
    },
  ];
  const recorded = progressOf(user.checklistProgress);
  return {
    items,
    newlyDone: items.filter((i) => i.done && !(i.key in recorded)).map((i) => i.key),
    complete: items.every((i) => i.done),
  };
}

// Records items first seen done and sends one funnel event for each (and one when the
// whole list is done). Safe to call twice at once: the row is locked, so each event
// fires once.
export async function recordChecklistProgress(
  userId: string,
  checklist: Checklist,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  if (checklist.newlyDone.length === 0) return;
  const fresh = await client.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ checklist_progress: unknown }[]>`
      SELECT checklist_progress FROM users WHERE id = ${userId} FOR UPDATE`;
    if (!row) return [];
    const progress = progressOf(row.checklist_progress);
    const added = checklist.newlyDone.filter((key) => !(key in progress));
    if (added.length === 0) return [];
    for (const key of added) progress[key] = now.toISOString();
    await tx.user.update({ where: { id: userId }, data: { checklistProgress: progress } });
    return added;
  });
  for (const item of fresh) await track(userId, "checklist_item_done", { item });
  if (fresh.length > 0 && checklist.complete) await track(userId, "checklist_completed");
}

// "Hide this": gone for good.
export async function dismissChecklist(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const { count } = await client.user.updateMany({
    where: { id: userId, checklistDismissedAt: null },
    data: { checklistDismissedAt: now },
  });
  if (count > 0) await track(userId, "checklist_dismissed");
}
