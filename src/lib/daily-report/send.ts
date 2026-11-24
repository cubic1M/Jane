import { ALERT_TYPES } from "@/config/alerts";
import {
  DAILY_REPORT_AHEAD_DAYS,
  DAILY_REPORT_AHEAD_LIMIT,
  DAILY_REPORT_CHANGE_MEMORY_DAYS,
  DAILY_REPORT_FIRST_LOOKBACK_DAYS,
  DAILY_REPORT_MAX_HEADS_UP,
  DAILY_REPORT_MONTHS,
} from "@/config/daily-report";
import { CHAT_NOTIFY_MAX_AGE_HOURS } from "@/config/chat-notify";
import { DIGEST_CHANGE_KINDS } from "@/config/digest";
import { NOT_FROM_A_BANK } from "@/data-sources/types";
import { addDays } from "@/detection/units";
import type { PrismaClient } from "@/generated/prisma/client";
import { comingUp } from "@/insights/coming-up";
import { loadInsightTransactions } from "@/insights/load";
import { alertPrefs } from "@/lib/alerts";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { loadChanges } from "@/lib/changes";
import { loadComingUp } from "@/lib/coming-up";
import { statementsReach } from "@/lib/data-reach";
import { db as defaultClient } from "@/lib/db";
import { scopedFor, type ScopedDb } from "@/lib/db-scoped";
import { appBase } from "@/lib/digest/links";
import { loadRecipients } from "@/lib/digest/load-recipients";
import type { NoDigestReason } from "@/lib/digest/recipients";
import { unsubscribeToken } from "@/lib/digest/unsubscribe";
import { validTimezone } from "@/lib/digest/week";
import { sendEmail } from "@/lib/email";
import { parseRefs } from "@/lib/jane-agent/types";
import { log } from "@/lib/log";
import type { OnlyPeople } from "@/lib/only-people";
import { forRealAccount } from "@/lib/suggestions";
import { localDate } from "@/lib/today";
import { buildDailyReport, type DailyReportInput } from "./build";
import { newChanges } from "./changes";
import { renderDailyReport } from "./render";
import { postedSince, spendingDay } from "./spending-day";
import { inReportWindow } from "./window";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Runs with the daily cron (/api/cron/digest). One report per person per local day, to people who
// turned it on in /settings (off for everyone until then): never to trial people or demo-bank-only
// accounts (src/lib/digest/recipients.ts), only from 7am to 8pm on their own clock, and each send is
// in the audit log and analytics_events. The cron runs once a day, so its hour decides who is inside
// their window on a given day (docs/daily-report.md).

export type DailyReportRun = {
  users: number;
  sent: number;
  // Not sent: outside 7am to 8pm for them, or already sent for their day.
  outsideWindow: number;
  alreadySent: number;
  failed: number;
  // Left unclaimed because the run's time was used up: the next run takes them.
  deferred: number;
  excluded: Partial<Record<NoDigestReason, number>>;
  previews: { userId: string; subject: string; text: string }[];
};

type Options = {
  client?: PrismaClient;
  now?: Date;
  // Builds and renders every report but sends and stores nothing.
  dryRun?: boolean;
  send?: typeof sendEmail;
  // How long the run may work before it stops between people (the cron passes what is left of its
  // time). The rest are not claimed, so the next run takes them.
  budgetMs?: number;
};

// The day's row is taken before the send, and the unique (user, day) refuses a second.
const isTaken = (error: unknown) => (error as { code?: unknown } | null)?.code === "P2002";

// A write after the email went: tried twice, and if it still fails it is said in the log (with the
// person's id, never a figure or an address), never dropped silently.
async function recorded(what: string, userId: string, write: () => Promise<unknown>) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await write();
      return;
    } catch (error) {
      if (attempt === 2) {
        log.error(`Daily report sent, but ${what} was not recorded`, {
          userId,
          error: String(error),
        });
      }
    }
  }
}

// How many things wait for the person's answer in the chat: the Yes items bundled behind the day's
// open morning briefs (refs.items, src/lib/jane-agent/agenda.ts), those still open. The brief's email
// no longer goes once the daily report does (src/lib/jane-agent/notify.ts), and the report can't hold
// the answers (it has text and a link), so it says how many wait and where.
async function waitingForAnswer(db: ScopedDb, now: Date): Promise<number> {
  const briefs = await db.janeMessages.findMany({
    where: {
      kind: "brief",
      status: "open",
      createdAt: { gt: new Date(now.getTime() - CHAT_NOTIFY_MAX_AGE_HOURS * HOUR_MS), lte: now },
    },
    select: { refs: true },
  });
  const keys = [
    ...new Set(briefs.flatMap((b) => (parseRefs(b.refs).items ?? []).map((i) => i.dedupeKey))),
  ];
  if (keys.length === 0) return 0;
  return db.janeMessages.count({ where: { dedupeKey: { in: keys }, status: "open" } });
}

// The facts for one person's report, read by the functions the pages use (docs/daily-report.md).
// `lastSentAt` is the run clock of the last report: what arrived after it, and no later than `now`,
// is this report's, so a suggestion, an alert or a posted line is in one report and not two.
async function reportInputFor(
  userId: string,
  timezone: string | null,
  lastSentAt: Date | null,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<{ input: DailyReportInput }> {
  const db = scopedFor(userId, client);
  const coming = await loadComingUp(userId, { client, now, days: DAILY_REPORT_AHEAD_DAYS });
  const today = coming.asOf;
  const yesterday = addDays(today, -1);
  const since = lastSentAt ?? new Date(now.getTime() - DAILY_REPORT_FIRST_LOOKBACK_DAYS * DAY_MS);

  const [transactions, reach, bank, suggestions, me, arrived] = await Promise.all([
    loadInsightTransactions(db, today, DAILY_REPORT_MONTHS),
    statementsReach(db, today, validTimezone(timezone)),
    db.plaidItems.findFirst({
      where: { lastSyncedAt: { not: null } },
      orderBy: { lastSyncedAt: "desc" },
      select: { lastSyncedAt: true },
    }),
    db.suggestions.findMany({
      where: {
        status: { in: ["waiting", "selected"] },
        // The first report lists what is open now; later ones only what is new.
        firstSeenAt: { ...(lastSentAt ? { gt: lastSentAt } : {}), lte: now },
      },
      select: {
        headline: true,
        short: true,
        title: true,
        why: true,
        topic: true,
        confidencePercent: true,
        worthCents: true,
        actionHref: true,
      },
      orderBy: [{ score: "desc" }, { key: "asc" }],
    }),
    db.me.findUnique({ where: { id: userId }, select: { alertPrefs: true } }),
    // The lines a linked bank sent since the last report (never an upload's, which arrives whole).
    lastSentAt
      ? db.transactions.findMany({
          where: {
            createdAt: { gt: lastSentAt, lte: now },
            source: { notIn: [...NOT_FROM_A_BANK] },
          },
          select: { id: true },
        })
      : [],
  ]);
  const prefs = alertPrefs(me?.alertPrefs);
  const alerts = await db.alerts.findMany({
    where: {
      type: { in: ALERT_TYPES.filter((t) => prefs[t] !== "off") },
      createdAt: { gt: since, lte: now },
      // An urgent alert already emailed isn't said again.
      emailedAt: null,
    },
    select: { title: true, createdAt: true, emailedAt: true, confidencePercent: true },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: DAILY_REPORT_MAX_HEADS_UP,
  });
  // Changes are the ones no earlier report listed (by key), so one Jane noticed after the last report
  // is new even when its event is dated before it.
  const kinds: readonly string[] = DIGEST_CHANGE_KINDS;
  const remembered = await db.dailyReports.findMany({
    where: {
      sentAt: { gte: new Date(now.getTime() - DAILY_REPORT_CHANGE_MEMORY_DAYS * DAY_MS) },
    },
    select: { changeKeys: true },
  });
  const changes = newChanges(
    (await loadChanges(userId, { client, now, input: coming.input }))
      .filter((c) => kinds.includes(c.kind))
      .map((c) => ({
        key: c.key,
        title: c.title,
        merchant: c.merchant,
        confidencePercent: c.confidence.percent,
      })),
    new Set(remembered.flatMap((r) => r.changeKeys)),
    alerts,
    DAILY_REPORT_MAX_HEADS_UP,
  );

  const rows = comingUp(coming.bills, coming.deadlines, today, {
    days: DAILY_REPORT_AHEAD_DAYS,
    limit: DAILY_REPORT_AHEAD_LIMIT,
  }).map((r) => ({
    label: r.label,
    date: r.date,
    amountCents: r.amountCents,
    daysLeft: r.daysLeft,
  }));
  const pay = coming.deposits
    .filter((d) => d.date >= today && d.date <= addDays(today, DAILY_REPORT_AHEAD_DAYS))
    .map((d) => ({
      label: `Expected pay from ${d.merchant}`,
      date: d.date,
      amountCents: d.amountCents,
      daysLeft: Math.round((Date.parse(d.date) - Date.parse(today)) / DAY_MS),
    }));
  // What a real account may see (the report goes to no one else): no advice topic, no card telling
  // them what to do with their money, as the chat's cards are chosen (src/lib/suggestions.ts).
  const mayShow = suggestions.filter(forRealAccount);

  return {
    input: {
      today,
      spending: spendingDay(transactions, yesterday),
      postedSince: postedSince(transactions, new Set(arrived.map((t) => t.id)), yesterday),
      // With no line at all there is nothing to say a day was quiet or missing.
      reach: coming.input.transactions.length === 0 ? null : reach,
      bankUpdated: bank?.lastSyncedAt ? localDate(bank.lastSyncedAt, timezone) : null,
      suggestions: mayShow.map((s) => ({
        headline: s.headline || s.title,
        short: s.short,
        percent: s.confidencePercent,
        worthCents: s.worthCents,
        path: s.actionHref,
      })),
      suggestionsTotal: mayShow.length,
      headsUp: [
        ...alerts.map((a) => ({ title: a.title, percent: a.confidencePercent })),
        ...changes.map((c) => ({
          title: c.title,
          percent: c.confidencePercent,
          changeKey: c.key,
        })),
      ],
      waiting: await waitingForAnswer(db, now),
      ahead: [...rows, ...pay]
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, DAILY_REPORT_AHEAD_LIMIT),
    },
  };
}

export async function runDailyReports({
  client = defaultClient,
  now = new Date(),
  dryRun = false,
  send = sendEmail,
  userIds,
  budgetMs = Infinity,
}: Options & OnlyPeople = {}): Promise<DailyReportRun> {
  const startedAt = Date.now();
  const { users, excluded } = await loadRecipients(client, "dailyReportEnabled", userIds);
  const run: DailyReportRun = {
    users: users.length,
    sent: 0,
    outsideWindow: 0,
    alreadySent: 0,
    failed: 0,
    deferred: 0,
    excluded,
    previews: [],
  };
  const settings = `${appBase()}/settings`;

  for (const user of users) {
    // One person's problem never stops the rest.
    try {
      if (!inReportWindow(now, user.timezone)) {
        run.outsideWindow += 1;
        continue;
      }
      const db = scopedFor(user.id, client);
      const day = new Date(`${localDate(now, user.timezone)}T00:00:00Z`);
      if (await db.dailyReports.findFirst({ where: { day }, select: { id: true } })) {
        run.alreadySent += 1;
        continue;
      }
      // Out of time: stop before the next person, leaving them unclaimed for the next run, so what
      // the cron does after this (the chat, the news, the due jobs) still has its time.
      if (Date.now() - startedAt >= budgetMs) {
        run.deferred += 1;
        continue;
      }
      const last = await db.dailyReports.findFirst({
        where: { sentAt: { not: null } },
        orderBy: { sentAt: "desc" },
        select: { sentAt: true },
      });
      const lastSentAt = last?.sentAt ?? null;
      const token = unsubscribeToken(user.id);
      const links = {
        settings,
        unsubscribe: `${appBase()}/unsubscribe?token=${token}&what=daily`,
      };
      if (dryRun) {
        const { input } = await reportInputFor(user.id, user.timezone, lastSentAt, { client, now });
        const email = renderDailyReport(buildDailyReport(input), links);
        run.previews.push({ userId: user.id, subject: email.subject, text: email.text });
        continue;
      }
      // The day is taken first, so two runs never send one day twice: the second finds it taken.
      let claimed: { id: string };
      try {
        claimed = await db.dailyReports.create({
          data: { userId: user.id, day },
          select: { id: true },
        });
      } catch (error) {
        if (!isTaken(error)) throw error;
        run.alreadySent += 1;
        continue;
      }
      let report;
      let changeKeys: string[];
      try {
        const built = await reportInputFor(user.id, user.timezone, lastSentAt, { client, now });
        report = buildDailyReport(built.input);
        // Only the changes the report really lists are remembered as listed: one cut by the limit, or
        // left out by the guardrails, is still new for the next report.
        changeKeys = report.sections.flatMap((s) => s.items).flatMap((i) => (i.key ? [i.key] : []));
        await send({
          to: user.email,
          ...renderDailyReport(report, links),
          headers: {
            // One-click unsubscribe from the mail app (RFC 8058).
            "List-Unsubscribe": `<${appBase()}/api/unsubscribe?token=${token}&what=daily>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
      } catch (error) {
        // Given back, so the next run tries again.
        await db.dailyReports.deleteMany({ where: { id: claimed.id } });
        log.error("Daily report email failed", { userId: user.id, error: String(error) });
        run.failed += 1;
        continue;
      }
      // Delivered: counted now. What is recorded after it is recorded on its own, so a write that
      // fails can't turn a delivered email into a failure (and, with the day's row kept, a spent day).
      run.sent += 1;
      // Counts only: never a figure, a name or an address.
      const counts = {
        sections: report.sections.length,
        busy: report.busy,
        suggestions: report.sections.find((s) => s.heading === "New from Jane")?.items.length ?? 0,
      };
      await recorded("its time", user.id, () =>
        db.dailyReports.updateMany({
          where: { id: claimed.id },
          data: { sentAt: now, changeKeys },
        }),
      );
      await recorded("the audit log entry", user.id, () =>
        logAudit(
          { type: "system", id: null },
          "daily_report_sent",
          { type: "user", id: user.id },
          counts,
        ),
      );
      await recorded("the analytics event", user.id, () =>
        track(user.id, "daily_report_sent", counts),
      );
    } catch (error) {
      log.error("Daily report failed", { userId: user.id, error: String(error) });
      run.failed += 1;
    }
  }
  return run;
}
