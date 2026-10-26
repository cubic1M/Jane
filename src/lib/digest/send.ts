import { actionWorthCents } from "@/lib/saved-amount";
import { isHiddenPage } from "@/config/hidden-pages";
import { ALERT_TYPES, ALERTS_PAGE_LIMIT } from "@/config/alerts";
import { moneyFound } from "@/detection/engine";
import { alertPrefs } from "@/lib/alerts";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { offerFor, savedToDate } from "@/lib/membership/service";
import { sendEmail } from "@/lib/email";
import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import { budgetSummary } from "@/insights/budgets";
import { loadInsightTransactions } from "@/insights/load";
import { netWorth, netWorthOn } from "@/insights/net-worth";
import { listGoals } from "@/lib/goals";
import { sendPush } from "@/lib/push";
import { whatJaneDid } from "@/lib/what-jane-did";
import { createPlanLink } from "@/lib/plan-links";
import { buildDigest, type DigestPayload, type DigestPlans } from "./build";
import { appBase, clickLink } from "./links";
import { renderDigest, type DigestLinks } from "./render";
import { unsubscribeToken } from "./unsubscribe";
import { weekStart } from "./week";

// Runs daily (Vercel Cron). Each person gets one digest per week, on the first run that
// falls on their Monday or later, so everyone gets it on Monday in their own timezone.

export type DigestRun = {
  users: number;
  sent: number;
  skipped: number;
  alreadySent: number;
  failed: number;
  previews: { userId: string; subject: string; text: string }[];
};

type Options = {
  client?: PrismaClient;
  now?: Date;
  // Builds and renders every digest but sends and stores nothing.
  dryRun?: boolean;
  send?: typeof sendEmail;
};

const titleOf = (snapshot: unknown) => {
  const card = (snapshot ?? {}) as { title?: unknown; annualSavingsCents?: unknown };
  return {
    title: typeof card.title === "string" ? card.title : "Your request",
    annualSavingsCents:
      typeof card.annualSavingsCents === "number" ? card.annualSavingsCents : null,
  };
};

async function payloadFor(userId: string, now: Date, client: PrismaClient) {
  const db = scopedFor(userId, client);
  const [actions, findings, found, saved, last, offer, user] = await Promise.all([
    db.actions.findMany({
      select: {
        status: true,
        completedAt: true,
        userTodo: true,
        refundCents: true,
        confirmedAnnualCents: true,
        decision: { select: { cardSnapshot: true } },
      },
    }),
    db.findings.findMany({
      where: { status: { in: ["new", "shown"] } },
      select: { title: true, annualSavingsCents: true, createdAt: true },
    }),
    moneyFound(userId, { client }),
    savedToDate(userId, { client }),
    db.digests.findFirst({
      where: { sentAt: { not: null } },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    }),
    offerFor(userId, { client, now }),
    client.user.findUnique({ where: { id: userId }, select: { alertPrefs: true } }),
  ]);
  const prefs = alertPrefs(user?.alertPrefs);
  // Alerts since the last digest that weren't already emailed.
  const alerts = await db.alerts.findMany({
    where: {
      type: { in: ALERT_TYPES.filter((t) => prefs[t] !== "off") },
      createdAt: { gt: last?.sentAt ?? new Date(0) },
      emailedAt: null,
    },
    select: { title: true, createdAt: true, emailedAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: ALERTS_PAGE_LIMIT,
  });
  const plans = await plansFor(userId, now, client);
  const did = await whatJaneDid(userId, { client, now });
  return buildDigest({
    now,
    lastSentAt: last?.sentAt ?? null,
    moneyFoundCents: found,
    savedToDateCents: saved,
    membershipOffer: offer.show,
    actions: actions.map((a) => ({
      status: a.status,
      completedAt: a.completedAt,
      userTodo: a.userTodo,
      ...titleOf(a.decision.cardSnapshot),
      // A refund seen in the transactions, or a lower price confirmed on a call, counts for
      // what actually happened.
      ...(actionWorthCents(a) !== null ? { annualSavingsCents: actionWorthCents(a) } : {}),
    })),
    findings,
    alerts,
    plans,
    janeDid: {
      finished: did.finished.length,
      confirmedCents: did.confirmedCents,
      contacts: did.contacts,
      working: did.working,
      waiting: did.waiting.length,
    },
  });
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Budgets, goals and net worth, from the same functions as their pages.
async function plansFor(userId: string, now: Date, client: PrismaClient): Promise<DigestPlans> {
  const db = scopedFor(userId, client);
  const asOf = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - WEEK_MS).toISOString().slice(0, 10);
  const [budgetRows, goals, accounts, snapshots] = await Promise.all([
    db.budgets.findMany({ select: { category: true, amountCents: true } }),
    listGoals(userId, { client, now }),
    db.accounts.findMany({
      select: { id: true, name: true, type: true, currentBalanceCents: true },
    }),
    db.balanceSnapshots.findMany({
      where: { date: { lte: new Date(`${weekAgo}T00:00:00Z`) } },
      select: { accountId: true, date: true, balanceCents: true },
    }),
  ]);
  const summary =
    budgetRows.length === 0
      ? null
      : budgetSummary(
          await loadInsightTransactions(db, asOf, BUDGET_SUGGESTION_MONTHS + 1),
          budgetRows,
          asOf,
        );
  const snaps = snapshots.map((s) => ({ ...s, date: s.date.toISOString().slice(0, 10) }));
  const balanceThen = (accountId: string) =>
    snaps
      .filter((s) => s.accountId === accountId)
      .sort((a, b) => a.date.localeCompare(b.date))
      .at(-1)?.balanceCents;
  const usesNetWorth = snaps.length > 0;
  return {
    budgets: (summary?.progress ?? []).map((p) => ({
      category: p.category,
      spentCents: p.spentCents,
      budgetCents: p.budgetCents,
    })),
    goals: goals.map((g) => {
      const then = g.accountId && g.accountName ? balanceThen(g.accountId) : undefined;
      return {
        name: g.name,
        percent: g.progress.percent,
        savedChangeCents: then === undefined ? null : g.progress.savedCents - Math.max(0, then),
      };
    }),
    netWorth: usesNetWorth
      ? {
          nowCents: netWorth(accounts.map((a) => ({ ...a, balanceCents: a.currentBalanceCents })))
            .netCents,
          weekAgoCents: netWorthOn(accounts, snaps, weekAgo),
        }
      : null,
  };
}

function linksFor(digestId: string, userId: string): DigestLinks {
  return {
    plan: clickLink(digestId, "/plan"),
    report: clickLink(digestId, "/report"),
    actions: clickLink(digestId, "/jane"),
    alerts: clickLink(digestId, "/jane"),
    budgets: clickLink(digestId, "/budgets"),
    goals: clickLink(digestId, "/goals"),
    netWorth: clickLink(digestId, "/net-worth"),
    settings: clickLink(digestId, "/settings"),
    unsubscribe: `${appBase()}/unsubscribe?token=${unsubscribeToken(userId)}`,
  };
}

export async function runDigests({
  client = defaultClient,
  now = new Date(),
  dryRun = false,
  send = sendEmail,
}: Options = {}): Promise<DigestRun> {
  // Active people: digest on, not deleted, at least one account.
  const users = await client.user.findMany({
    where: { digestEnabled: true, deletedAt: null, accounts: { some: {} } },
    select: { id: true, email: true, timezone: true, createdAt: true },
    orderBy: { id: "asc" },
  });
  const run: DigestRun = {
    users: users.length,
    sent: 0,
    skipped: 0,
    alreadySent: 0,
    failed: 0,
    previews: [],
  };

  for (const user of users) {
    // One person's problem (e.g. their account deleted mid-run) never stops the rest.
    try {
      const week = weekStart(now, user.timezone);
      // Real-user QA: someone who signed up this week gets their first one next Monday, not on
      // the first daily run after signing up and again four days later.
      if (
        user.createdAt <= now &&
        weekStart(user.createdAt, user.timezone).getTime() === week.getTime()
      ) {
        run.skipped += 1;
        continue;
      }
      const db = scopedFor(user.id, client);
      if (await db.digests.findFirst({ where: { weekStart: week }, select: { id: true } })) {
        run.alreadySent += 1;
        continue;
      }
      const payload = await payloadFor(user.id, now, client);
      if (!payload) {
        run.skipped += 1;
        continue;
      }

      if (dryRun) {
        const email = renderDigest(payload, linksFor("preview", user.id));
        run.previews.push({ userId: user.id, subject: email.subject, text: email.text });
        continue;
      }

      const digest = await db.digests.create({
        data: { userId: user.id, weekStart: week, payload: payload as DigestPayload },
        select: { id: true },
      });
      // A one-tap link for this week's no-risk items. Its token only goes in the email
      // (and the notification), never in the stored digest.
      // The one-tap go-ahead page (/plan/go) is hidden in the read-only beta.
      const goAhead = isHiddenPage("/plan/go")
        ? null
        : await createPlanLink(user.id, { client, now }).catch(() => null);
      const links = { ...linksFor(digest.id, user.id), ...(goAhead ? { goAhead } : {}) };
      const email = renderDigest(payload, links);
      try {
        await send({
          to: user.email,
          ...email,
          headers: {
            // One-click unsubscribe from the mail app (RFC 8058).
            "List-Unsubscribe": `<${appBase()}/api/unsubscribe?token=${unsubscribeToken(user.id)}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
      } catch (error) {
        // Remove the row so tomorrow's run tries again.
        await db.digests.deleteMany({ where: { id: digest.id } });
        console.error("Digest email failed", { userId: user.id, error: String(error) });
        run.failed += 1;
        continue;
      }
      await db.digests.updateMany({ where: { id: digest.id }, data: { sentAt: now } });
      // A phone notification too, for people who turned them on.
      if (payload.plan && payload.plan.items > 0) {
        const n = payload.plan.items;
        await sendPush(
          user.id,
          {
            title: "Jane's plan is ready",
            body: goAhead
              ? `Tap to let Jane go ahead with ${goAhead.count} ${goAhead.count === 1 ? "thing" : "things"}.`
              : `${n} ${n === 1 ? "thing" : "things"} to say yes or no to.`,
            url: goAhead?.url ?? "/plan",
          },
          { client },
        ).catch((error) =>
          console.error("Plan push failed", { userId: user.id, error: String(error) }),
        );
      }
      await track(user.id, "digest_sent", {
        saved_this_week_cents: payload.savedThisWeekCents,
        pending: payload.pending.length,
        new_findings: payload.newFindings.length,
        alerts: payload.alerts.length,
      });
      run.sent += 1;
    } catch (error) {
      console.error("Digest failed", { userId: user.id, error: String(error) });
      run.failed += 1;
    }
  }
  return run;
}
