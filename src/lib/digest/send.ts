import { actionWorthCents } from "@/lib/saved-amount";
import { conciergeMode } from "@/lib/concierge-mode";
import { isHiddenPage } from "@/config/hidden-pages";
import { ALERT_TYPES, ALERTS_PAGE_LIMIT } from "@/config/alerts";
import { DIGEST_CHANGE_KINDS } from "@/config/digest";
import { TRIAL_ID_PREFIX } from "@/config/trial";
import { loadDetectionInput, moneyFoundParts } from "@/detection/engine";
import { alertPrefs } from "@/lib/alerts";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { loadChanges } from "@/lib/changes";
import { loadCheckup } from "@/lib/checkup";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { offerFor, savedToDate } from "@/lib/membership/service";
import { sendEmail } from "@/lib/email";
import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import { budgetSummary } from "@/insights/budgets";
import { loadInsightTransactions } from "@/insights/load";
import { netWorth, netWorthOn, notCounting } from "@/insights/net-worth";
import { listGoals } from "@/lib/goals";
import { sendPush } from "@/lib/push";
import { whatJaneDid } from "@/lib/what-jane-did";
import { createPlanLink } from "@/lib/plan-links";
import { buildDigest, type DigestPayload, type DigestPlans } from "./build";
import { appBase, clickLink } from "./links";
import { renderDigest, type DigestLinks } from "./render";
import { whyNoDigest, type NoDigestReason } from "./recipients";
import { unsubscribeToken } from "./unsubscribe";
import { weekStart } from "./week";
import { peopleIn, type OnlyPeople } from "@/lib/only-people";

// Runs daily (Vercel Cron). Each person gets one digest per week, on the first run that
// falls on their Monday or later, so everyone gets it on Monday in their own timezone. It's the
// weekly "what changed" email: only real people get it (./recipients.ts), only when something
// changed (./build.ts), and each send is in the audit log and analytics_events.

export type DigestRun = {
  users: number;
  sent: number;
  skipped: number;
  alreadySent: number;
  failed: number;
  // People never emailed: trial people and demo-bank-only accounts, by reason.
  excluded: Partial<Record<NoDigestReason, number>>;
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
      select: {
        type: true,
        title: true,
        annualSavingsCents: true,
        createdAt: true,
        confidence: true,
      },
    }),
    moneyFoundParts(userId, { client }),
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
  // Alerts since the last digest that weren't already emailed, and still hold as the dock says
  // (src/lib/jane-agent/still-true.ts): a reminder for a bill due Nov 1 isn't news on Nov 2.
  const raised = await db.alerts.findMany({
    where: {
      type: { in: ALERT_TYPES.filter((t) => prefs[t] !== "off") },
      createdAt: { gt: last?.sentAt ?? new Date(0) },
      emailedAt: null,
    },
    select: {
      id: true,
      type: true,
      key: true,
      title: true,
      createdAt: true,
      emailedAt: true,
      confidencePercent: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: ALERTS_PAGE_LIMIT,
  });
  // Loaded here: the chat's checks reach most of the app.
  const { alertsThatHold } = await import("@/lib/jane-agent/still-true");
  const alerts = await alertsThatHold(userId, raised, { client, now });
  const [plans, concierge] = await Promise.all([
    plansFor(userId, now, client),
    conciergeMode(userId, { client }),
  ]);
  const did = await whatJaneDid(userId, { client, now });
  const { changes, checkup } = await changesAndCheckup(
    userId,
    findings.map((f) => f.type),
    now,
    client,
  );
  return buildDigest({
    now,
    lastSentAt: last?.sentAt ?? null,
    moneyFoundCents: found.cents,
    moneyFoundOnceCents: found.onceCents,
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
    changes,
    checkup,
    plans,
    readOnly: !concierge,
    janeDid: {
      finished: did.finished.length,
      confirmedCents: did.confirmedCents,
      contacts: did.contacts,
      working: did.working,
      waiting: did.waiting.length,
    },
  });
}

// What changed (src/lib/changes.ts) and the report's checkup, from one read of the
// transactions. Rules only: no Claude call. A problem here leaves them out, never the email.
async function changesAndCheckup(
  userId: string,
  open: Parameters<typeof loadCheckup>[1],
  now: Date,
  client: PrismaClient,
) {
  try {
    const input = await loadDetectionInput(userId, { client, now });
    const kinds: readonly string[] = DIGEST_CHANGE_KINDS;
    const changes = (await loadChanges(userId, { client, now, input }))
      .filter((c) => kinds.includes(c.kind))
      .map((c) => ({
        title: c.title,
        date: c.date,
        merchant: c.merchant,
        confidencePercent: c.confidence.percent,
      }));
    const checkup = await loadCheckup(userId, open, { client, now, input });
    return { changes, checkup: checkup.map((c) => ({ status: c.status })) };
  } catch (error) {
    console.error("Digest changes failed", { userId, error: String(error) });
    return { changes: [], checkup: [] };
  }
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
    netWorth: usesNetWorth ? digestNetWorth(accounts, snaps, weekAgo) : null,
  };
}

// Net worth for the digest: none when no balance is known (never a silent $0), and what it
// leaves out said beside the figure.
function digestNetWorth(
  accounts: { id: string; name: string; type: string; currentBalanceCents: number | null }[],
  snaps: Parameters<typeof netWorthOn>[1],
  weekAgo: string,
) {
  const worth = netWorth(accounts.map((a) => ({ ...a, balanceCents: a.currentBalanceCents })));
  if (!worth.known) return null;
  return {
    nowCents: worth.netCents,
    weekAgoCents: netWorthOn(accounts, snaps, weekAgo),
    notCounting: notCounting(worth.unbalanced)?.short ?? null,
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
    close: clickLink(digestId, "/close"),
    settings: clickLink(digestId, "/settings"),
    unsubscribe: `${appBase()}/unsubscribe?token=${unsubscribeToken(userId)}`,
  };
}

export async function runDigests({
  client = defaultClient,
  now = new Date(),
  dryRun = false,
  send = sendEmail,
  userIds,
}: Options & OnlyPeople = {}): Promise<DigestRun> {
  // Active people: digest on, not deleted, at least one account, never a trial person. Then
  // whyNoDigest leaves out anyone whose only bank is the demo bank.
  const candidates = await client.user.findMany({
    where: {
      digestEnabled: true,
      deletedAt: null,
      accounts: { some: {} },
      NOT: { id: { startsWith: TRIAL_ID_PREFIX } },
      ...peopleIn(userIds),
    },
    select: {
      id: true,
      email: true,
      timezone: true,
      createdAt: true,
      digestEnabled: true,
      deletedAt: true,
      plaidItems: { select: { plaidItemId: true } },
      _count: { select: { accounts: true } },
    },
    orderBy: { id: "asc" },
  });
  const csvAccounts = await client.account.groupBy({
    by: ["userId"],
    where: { source: "csv", userId: { in: candidates.map((c) => c.id) } },
    _count: { _all: true },
  });
  const csvCount = new Map(csvAccounts.map((a) => [a.userId, a._count._all]));
  const excluded: DigestRun["excluded"] = {};
  const users = candidates.filter((c) => {
    const reason = whyNoDigest({
      ...c,
      plaidItemIds: c.plaidItems.map((i) => i.plaidItemId),
      csvAccounts: csvCount.get(c.id) ?? 0,
      accounts: c._count.accounts,
    });
    if (reason) excluded[reason] = (excluded[reason] ?? 0) + 1;
    return reason === null;
  });
  const run: DigestRun = {
    users: users.length,
    sent: 0,
    skipped: 0,
    alreadySent: 0,
    failed: 0,
    excluded,
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
      let sent: Awaited<ReturnType<typeof send>>;
      try {
        sent = await send({
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
      await db.digests.updateMany({
        where: { id: digest.id },
        data: { sentAt: now, resendId: sent?.id ?? null },
      });
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
      const counts = {
        saved_this_week_cents: payload.savedThisWeekCents,
        pending: payload.pending.length,
        new_findings: payload.newFindings.length,
        alerts: payload.alerts.length,
        changes: payload.changes?.length ?? 0,
      };
      await logAudit(
        { type: "system", id: null },
        "digest_sent",
        { type: "digest", id: digest.id },
        { user_id: user.id, ...counts },
      );
      await track(user.id, "digest_sent", { digest_id: digest.id, ...counts });
      run.sent += 1;
    } catch (error) {
      console.error("Digest failed", { userId: user.id, error: String(error) });
      run.failed += 1;
    }
  }
  return run;
}
