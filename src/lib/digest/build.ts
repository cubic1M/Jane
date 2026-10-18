import { DIGEST_BUDGET_NEAR_SHARE } from "@/config/digest";
import type { ActionStatus } from "@/generated/prisma/client";

// What goes in a week's digest, and whether to send one at all. Pure, so the skip rule
// and the totals are tested directly.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING: ActionStatus[] = ["queued", "in_progress", "waiting_on_user"];

export type DigestInput = {
  now: Date;
  // When the last digest went out; null for someone's first.
  lastSentAt: Date | null;
  moneyFoundCents: number;
  // Whether the membership offer is due (src/lib/membership/offer.ts).
  membershipOffer: boolean;
  actions: {
    status: ActionStatus;
    completedAt: Date | null;
    userTodo: string | null;
    // From the card the person approved.
    title: string;
    annualSavingsCents: number | null;
  }[];
  // Open findings on the report.
  findings: { title: string; annualSavingsCents: number | null; createdAt: Date }[];
  // Alerts the person gets (not turned off). Ones already emailed aren't repeated.
  alerts: { title: string; createdAt: Date; emailedAt: Date | null }[];
  // Budgets, goals and net worth, for people who use them.
  plans?: DigestPlans;
  // The action agent's week (src/lib/what-jane-did.ts).
  janeDid?: {
    finished: number;
    confirmedCents: number;
    contacts: number;
    working: number;
    waiting: number;
  };
};

export type DigestPlans = {
  budgets: { category: string; spentCents: number; budgetCents: number }[];
  goals: { name: string; percent: number; savedChangeCents: number | null }[];
  netWorth: { nowCents: number; weekAgoCents: number | null } | null;
};

export type DigestPayload = {
  savedThisWeekCents: number;
  savedToDateCents: number;
  moneyFoundCents: number;
  finishedThisWeek: { title: string; annualSavingsCents: number | null }[];
  pending: { title: string; status: ActionStatus; userTodo: string | null }[];
  newFindings: { title: string; annualSavingsCents: number | null }[];
  alerts: { title: string }[];
  membershipOffer: boolean;
  // Older payloads (before step 39) have none of these.
  budgets?: { category: string; spentCents: number; budgetCents: number; over: boolean }[];
  goals?: { name: string; percent: number; savedChangeCents: number | null }[];
  netWorth?: { nowCents: number; changeCents: number } | null;
  // Jane's plan: how many open findings wait for a yes or no (none before step 49).
  plan?: { items: number };
  // What the action agent did this week (none before step 56).
  janeDid?: DigestInput["janeDid"];
};

const total = (rows: { annualSavingsCents: number | null }[]) =>
  rows.reduce((sum, r) => sum + (r.annualSavingsCents ?? 0), 0);

// Null when there's nothing new, nothing pending and nothing on Jane's plan: we never send
// an empty digest.
export function buildDigest(input: DigestInput): DigestPayload | null {
  const weekAgo = new Date(input.now.getTime() - WEEK_MS);
  const done = input.actions.filter((a) => a.status === "done");
  const finishedThisWeek = done.filter((a) => a.completedAt && a.completedAt > weekAgo);
  const pending = input.actions.filter((a) => PENDING.includes(a.status));
  const since = input.lastSentAt ?? new Date(0);
  const newFindings = input.findings.filter((f) => f.createdAt > since);
  const alerts = input.alerts.filter((a) => a.createdAt > since && a.emailedAt === null);
  // Budgets close to or over their limit; goals; net worth when last week is known.
  const budgets = (input.plans?.budgets ?? [])
    .filter((b) => b.spentCents >= b.budgetCents * DIGEST_BUDGET_NEAR_SHARE)
    .map((b) => ({ ...b, over: b.spentCents > b.budgetCents }));
  const goals = input.plans?.goals ?? [];
  const worth = input.plans?.netWorth;
  const netWorth =
    worth && worth.weekAgoCents !== null
      ? { nowCents: worth.nowCents, changeCents: worth.nowCents - worth.weekAgoCents }
      : null;

  if (
    finishedThisWeek.length === 0 &&
    pending.length === 0 &&
    newFindings.length === 0 &&
    alerts.length === 0 &&
    input.findings.length === 0 &&
    budgets.length === 0 &&
    goals.length === 0 &&
    netWorth === null
  ) {
    return null;
  }
  return {
    savedThisWeekCents: total(finishedThisWeek),
    savedToDateCents: total(done),
    moneyFoundCents: input.moneyFoundCents,
    finishedThisWeek: finishedThisWeek.map(({ title, annualSavingsCents }) => ({
      title,
      annualSavingsCents,
    })),
    // Things waiting on the person come first.
    pending: pending
      .map(({ title, status, userTodo }) => ({ title, status, userTodo }))
      .sort(
        (a, b) => Number(b.status === "waiting_on_user") - Number(a.status === "waiting_on_user"),
      ),
    newFindings: newFindings.map(({ title, annualSavingsCents }) => ({
      title,
      annualSavingsCents,
    })),
    alerts: alerts.map(({ title }) => ({ title })),
    membershipOffer: input.membershipOffer,
    budgets,
    goals,
    netWorth,
    plan: { items: input.findings.length },
    janeDid: input.janeDid,
  };
}
