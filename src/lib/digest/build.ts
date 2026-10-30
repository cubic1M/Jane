import { DIGEST_BUDGET_NEAR_SHARE, DIGEST_MAX_CHANGES } from "@/config/digest";
import type { CheckStatus } from "@/detection/checkup";
import type { ActionStatus, Confidence } from "@/generated/prisma/client";

// What goes in a week's digest, and whether to send one at all. Pure, so the skip rule
// and the totals are tested directly. It's the weekly "what changed" email: it goes out only
// when something changed (a new finding, a change or alert, something finished or waiting on
// the person, a budget gone over), never for an unchanged plan, goal or net worth alone.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING: ActionStatus[] = ["queued", "in_progress", "waiting_on_user"];

export type DigestInput = {
  now: Date;
  // When the last digest went out; null for someone's first.
  lastSentAt: Date | null;
  moneyFoundCents: number;
  // "Saved so far": the same total as /jane and Home (savedToDate in
  // src/lib/membership/service.ts), so the email never shows a different number
  // (docs/feature-audit.md, cluster 9).
  savedToDateCents: number;
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
  findings: {
    title: string;
    annualSavingsCents: number | null;
    createdAt: Date;
    confidence?: Confidence;
  }[];
  // Alerts the person gets (not turned off). Ones already emailed aren't repeated. Their
  // confidence is null on alerts from before it was stored.
  alerts: {
    title: string;
    createdAt: Date;
    emailedAt: Date | null;
    confidencePercent?: number | null;
  }[];
  // Changes Jane noticed (src/insights/changes.ts, DIGEST_CHANGE_KINDS), minus the ones the
  // person said were expected. `date` is YYYY-MM-DD.
  changes?: { title: string; date: string; merchant: string | null; confidencePercent: number }[];
  // The report's checkup (src/detection/checkup.ts): each check's status.
  checkup?: { status: CheckStatus }[];
  // Budgets, goals and net worth, for people who use them.
  plans?: DigestPlans;
  // Read-only mode (src/lib/concierge-mode.ts): nobody acts for this person, so the plan is
  // theirs to do with Jane's steps.
  readOnly?: boolean;
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
  // What net worth leaves out for want of a balance ("not counting card balance"), or null.
  netWorth: { nowCents: number; weekAgoCents: number | null; notCounting?: string | null } | null;
};

export type DigestPayload = {
  savedThisWeekCents: number;
  savedToDateCents: number;
  moneyFoundCents: number;
  finishedThisWeek: { title: string; annualSavingsCents: number | null }[];
  pending: { title: string; status: ActionStatus; userTodo: string | null }[];
  newFindings: { title: string; annualSavingsCents: number | null; confidence?: Confidence }[];
  // Older payloads have no confidence on alerts, and no changes or checkup.
  alerts: { title: string; percent?: number | null }[];
  changes?: { title: string; percent: number }[];
  checkup?: DigestCheckup | null;
  membershipOffer: boolean;
  // Older payloads (before step 39) have none of these.
  budgets?: { category: string; spentCents: number; budgetCents: number; over: boolean }[];
  goals?: { name: string; percent: number; savedChangeCents: number | null }[];
  netWorth?: { nowCents: number; changeCents: number; notCounting?: string | null } | null;
  // Jane's plan: how many open findings wait for a yes or no (none before step 49).
  plan?: { items: number; readOnly?: boolean };
  // What the action agent did this week (none before step 56).
  janeDid?: DigestInput["janeDid"];
};

export type DigestCheckup = {
  checks: number;
  found: number;
  passed: number;
  notEnoughData: number;
};

const total = (rows: { annualSavingsCents: number | null }[]) =>
  rows.reduce((sum, r) => sum + (r.annualSavingsCents ?? 0), 0);

const day = (d: Date) => d.toISOString().slice(0, 10);

// Changes since the last email (or the last week, for someone's first), the surest first. A
// change an alert already says (the same merchant) isn't said twice.
export function changesSince(
  changes: NonNullable<DigestInput["changes"]>,
  alerts: readonly { title: string }[],
  since: Date,
): { title: string; percent: number }[] {
  const alerted = alerts.map((a) => a.title.toLowerCase());
  return changes
    .filter(
      (c) =>
        c.date > day(since) &&
        !alerted.some((t) => c.merchant && t.includes(c.merchant.toLowerCase())),
    )
    .sort((a, b) => b.confidencePercent - a.confidencePercent || b.date.localeCompare(a.date))
    .slice(0, DIGEST_MAX_CHANGES)
    .map((c) => ({ title: c.title, percent: c.confidencePercent }));
}

// "Jane ran 12 checks: 2 found something, 9 found nothing, 1 needs more data."
export function checkupCounts(lines: readonly { status: CheckStatus }[]): DigestCheckup | null {
  if (lines.length === 0) return null;
  const count = (status: CheckStatus) => lines.filter((l) => l.status === status).length;
  return {
    checks: lines.length,
    found: count("found"),
    passed: count("passed"),
    notEnoughData: count("not_enough_data"),
  };
}

// Null when nothing changed: we never send an empty digest, or one that only repeats last
// week's plan, goals and net worth.
export function buildDigest(input: DigestInput): DigestPayload | null {
  const weekAgo = new Date(input.now.getTime() - WEEK_MS);
  const done = input.actions.filter((a) => a.status === "done");
  const finishedThisWeek = done.filter((a) => a.completedAt && a.completedAt > weekAgo);
  const pending = input.actions.filter((a) => PENDING.includes(a.status));
  const since = input.lastSentAt ?? new Date(0);
  const newFindings = input.findings.filter((f) => f.createdAt > since);
  const alerts = input.alerts.filter((a) => a.createdAt > since && a.emailedAt === null);
  const changes = changesSince(input.changes ?? [], alerts, input.lastSentAt ?? weekAgo);
  // Budgets close to or over their limit; goals; net worth when last week is known.
  const budgets = (input.plans?.budgets ?? [])
    .filter((b) => b.spentCents >= b.budgetCents * DIGEST_BUDGET_NEAR_SHARE)
    .map((b) => ({ ...b, over: b.spentCents > b.budgetCents }));
  const goals = input.plans?.goals ?? [];
  const worth = input.plans?.netWorth;
  const netWorth =
    worth && worth.weekAgoCents !== null
      ? {
          nowCents: worth.nowCents,
          changeCents: worth.nowCents - worth.weekAgoCents,
          notCounting: worth.notCounting ?? null,
        }
      : null;

  const changed =
    finishedThisWeek.length > 0 ||
    pending.some((a) => a.status === "waiting_on_user") ||
    newFindings.length > 0 ||
    alerts.length > 0 ||
    changes.length > 0 ||
    budgets.some((b) => b.over);
  if (!changed) return null;
  return {
    savedThisWeekCents: total(finishedThisWeek),
    savedToDateCents: input.savedToDateCents,
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
    newFindings: newFindings.map(({ title, annualSavingsCents, confidence }) => ({
      title,
      annualSavingsCents,
      ...(confidence ? { confidence } : {}),
    })),
    alerts: alerts.map(({ title, confidencePercent }) => ({
      title,
      percent: confidencePercent ?? null,
    })),
    changes,
    checkup: checkupCounts(input.checkup ?? []),
    membershipOffer: input.membershipOffer,
    budgets,
    goals,
    netWorth,
    plan: { items: input.findings.length, ...(input.readOnly ? { readOnly: true } : {}) },
    janeDid: input.janeDid,
  };
}
