import { MONTHLY_REPORT_DAYS } from "@/config/monthly-report";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { previousMonth } from "@/insights/check-in";
import { track } from "@/lib/analytics";
import { loadCheckIn, summaryFor } from "@/lib/check-in";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { appBase } from "@/lib/digest/links";
import { unsubscribeToken } from "@/lib/digest/unsubscribe";
import { localDate } from "@/lib/digest/week";
import { sendEmail } from "@/lib/email";
import { healthFor } from "@/lib/health-score";
import { rankedFor } from "@/lib/jane-agent/priorities";
import { loadSnapshot } from "@/lib/jane-agent/snapshot";
import { verifiedSavings } from "@/lib/savings-proof";
import {
  monthName,
  receiptWords,
  reportLines,
  type MonthlyReport,
  type YearInReport,
} from "@/planning/monthly-report";
import { storedReport, type StoredReport } from "./monthly-report-store";
import { yearInReview } from "./year";
import { loadYearPlan } from "./year-plan";
import { resultsByKind } from "./worked";

// The monthly money report (spec step 148): in the first days of a month, what the month
// just ended came to (saved, earned, paid down, moved), the health score's change, what's
// next and the receipts. Each figure comes from the loader of the page it links to, so it
// matches that page. Made once per person and month, kept, posted in the chat and emailed.
// It is the month's one report and one email: the monthly check-in's figures and summary
// (spec step 45) are part of it, and December's carries the year in review (spec step 35)
// (docs/feature-audit.md, cluster 2).

type Options = { client?: PrismaClient; now?: Date };

export async function buildMonthlyReport(
  userId: string,
  month: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<MonthlyReport> {
  const db = scopedFor(userId, client);
  const [saved, checkIn, transfers, snapshot, health] = await Promise.all([
    verifiedSavings(userId, { client, now }),
    loadCheckIn(userId, month, { client, now }),
    db.moneyTransfers.findMany({
      where: {
        status: "completed",
        runOn: {
          gte: new Date(`${month}-01T00:00:00Z`),
          lt: new Date(`${nextMonth(month)}-01T00:00:00Z`),
        },
      },
      select: { amountCents: true },
    }),
    loadSnapshot(userId, { client, now }),
    healthFor(userId, { client, now }),
  ]);
  const yearPlanView = await loadYearPlan(userId, { client, now }).catch(() => null);
  const planned = yearPlanView?.months.find((m) => m.month === month);
  const upcoming = yearPlanView?.months.find((m) => m.month === yearPlanView.currentMonth);
  const kinds = await resultsByKind(userId, { client, now });
  const receipts = saved.actions.confirmed.filter((r) => r.seen.date.startsWith(month));
  // Suggestions the person acted on, first seen in the transactions this month.
  const fromSuggestions = saved.suggestions.confirmed.filter((o) =>
    o.verifiedOn?.startsWith(month),
  );
  const [next] = snapshot ? rankedFor(snapshot) : [];
  const [summary, year] = await Promise.all([
    summaryFor(userId, checkIn, { client }),
    month.endsWith("-12") ? yearSection(userId, Number(month.slice(0, 4)), client, now) : null,
  ]);
  return {
    month,
    summary,
    spent: { cents: checkIn.spendingCents, previousCents: checkIn.previousSpendingCents },
    budgets: {
      kept: checkIn.budgets.filter((b) => b.kept).length,
      over: checkIn.budgets.filter((b) => !b.kept).map((b) => b.category),
    },
    netWorth: checkIn.netWorth,
    year,
    saved: {
      totalCents: saved.confirmedCents,
      monthCents:
        receipts.reduce((s, r) => s + r.cents, 0) +
        fromSuggestions.reduce((s, o) => s + (o.confirmedCents ?? 0), 0),
    },
    earnedCents: checkIn.incomeCents,
    paidDownCents: checkIn.debtPaymentsCents,
    moved: { cents: transfers.reduce((s, t) => s + t.amountCents, 0), count: transfers.length },
    next: next ? { title: next.title, href: next.href } : null,
    health: health && {
      score: health.score,
      band: health.band,
      change: health.change?.delta ?? null,
    },
    worked: {
      confirmed: receipts.length + fromSuggestions.length,
      notShown: kinds.reduce((s, k) => s + k.notShown, 0),
    },
    plan:
      planned && upcoming
        ? {
            planned: {
              saving: planned.targets.saving,
              debt: planned.targets.debt,
              investing: planned.targets.investing,
            },
            did: planned.actual,
            nextTargets: {
              saving: upcoming.targets.saving,
              debt: upcoming.targets.debt,
              investing: upcoming.targets.investing,
            },
          }
        : null,
    receipts: receipts.map((r) => ({
      title: r.title,
      cents: r.cents,
      yearly: r.yearly,
      proof: r.proof,
    })),
  };
}

// The year in review's headline figures, from /year's own loader.
async function yearSection(
  userId: string,
  year: number,
  client: PrismaClient,
  now: Date,
): Promise<YearInReport> {
  const review = await yearInReview(userId, year, { client, now });
  return {
    year,
    spendingCents: review.spendingCents,
    incomeCents: review.incomeCents,
    found: review.found.findings,
    foundAnnualCents: review.found.annualSavingsCents,
    savedCents: review.savedCents,
  };
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

const empty = (r: MonthlyReport) =>
  (r.spent?.cents ?? 0) === 0 &&
  r.earnedCents === 0 &&
  r.paidDownCents === 0 &&
  r.saved.monthCents === 0 &&
  r.moved.count === 0;

// Last month's report, made once in the first days of this month (the person's own), kept.
// Null outside those days or for a month with nothing in it.
export async function monthlyReportFor(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<StoredReport | null> {
  const user = await client.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  const today = localDate(now, user?.timezone);
  if (Number(today.slice(8, 10)) > MONTHLY_REPORT_DAYS) return null;
  const month = previousMonth(today);
  const kept = await storedReport(userId, month, { client });
  if (kept) return kept;
  // Nothing in the month at all: say so cheaply, without building the report each run.
  const from = new Date(`${month}-01T00:00:00Z`);
  const to = new Date(`${nextMonth(month)}-01T00:00:00Z`);
  const db = scopedFor(userId, client);
  const [transactions, transfers] = await Promise.all([
    db.transactions.count({ where: { date: { gte: from, lt: to } } }),
    db.moneyTransfers.count({ where: { status: "completed", runOn: { gte: from, lt: to } } }),
  ]);
  if (transactions === 0 && transfers === 0) return null;
  const report = await buildMonthlyReport(userId, month, { client, now });
  if (empty(report)) return null;
  await db.monthlyReports
    .create({
      data: {
        userId,
        month,
        figures: report as unknown as Prisma.InputJsonObject,
        createdAt: now,
      },
    })
    // Made meanwhile by another run: keep that one.
    .catch(() => null);
  await track(userId, "monthly_report_made", { month });
  return storedReport(userId, month, { client });
}

const esc = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export function renderMonthlyReportEmail(
  report: MonthlyReport,
  links: { base: string; unsubscribe: string },
) {
  const subject = `Your money report for ${monthName(report.month)}`;
  const lines = reportLines(report);
  const receipts = report.receipts.map((r) => `${receiptWords(r)}. ${r.proof}`);
  const page = `${links.base}/monthly?m=${report.month}`;
  const text = [
    subject,
    "",
    ...(report.summary ? [report.summary, ""] : []),
    ...lines.map((l) => `${l.label}: ${l.text} ${links.base}${l.href}`),
    ...(receipts.length > 0 ? ["", "Receipts:", ...receipts.map((r) => `- ${r}`)] : []),
    "",
    `See it all: ${page}`,
    "",
    `Unsubscribe: ${links.unsubscribe}`,
  ].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#171717;line-height:1.5">
<h1 style="font-size:22px">${esc(subject)}</h1>
${report.summary ? `<p>${esc(report.summary)}</p>` : ""}
<ul>${lines
    .map(
      (l) =>
        `<li><strong>${esc(l.label)}:</strong> ${esc(l.text)} <a href="${esc(`${links.base}${l.href}`)}" style="color:#171717">See it</a></li>`,
    )
    .join("")}</ul>
${receipts.length > 0 ? `<h2 style="font-size:16px">Receipts</h2><ul>${receipts.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
<p><a href="${esc(page)}" style="color:#171717">See it all</a></p>
<p style="margin-top:32px;font-size:12px;color:#737373"><a href="${esc(links.unsubscribe)}" style="color:#737373">Unsubscribe</a></p>
</div>`;
  return { subject, text, html };
}

// The daily run (the digest cron): last month's report to everyone who gets Jane's
// emails, once, in the first days of the month.
export async function runMonthlyReports({
  client = defaultClient,
  now = new Date(),
  send = sendEmail,
}: Options & { send?: typeof sendEmail } = {}): Promise<{
  sent: number;
  skipped: number;
  failed: number;
}> {
  const users = await client.user.findMany({
    where: { digestEnabled: true, deletedAt: null, accounts: { some: {} } },
    select: { id: true, email: true },
    orderBy: { id: "asc" },
  });
  const run = { sent: 0, skipped: 0, failed: 0 };
  for (const user of users) {
    try {
      const kept = await monthlyReportFor(user.id, { client, now });
      const db = scopedFor(user.id, client);
      if (!kept) {
        run.skipped += 1;
        continue;
      }
      // Claimed first, so two runs never send it twice.
      const { count } = await db.monthlyReports.updateMany({
        where: { id: kept.id, emailedAt: null },
        data: { emailedAt: now },
      });
      if (count === 0) {
        run.skipped += 1;
        continue;
      }
      const token = unsubscribeToken(user.id);
      try {
        await send({
          to: user.email,
          ...renderMonthlyReportEmail(kept.report, {
            base: appBase(),
            unsubscribe: `${appBase()}/unsubscribe?token=${token}`,
          }),
          headers: {
            "List-Unsubscribe": `<${appBase()}/api/unsubscribe?token=${token}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
      } catch (error) {
        await db.monthlyReports.updateMany({ where: { id: kept.id }, data: { emailedAt: null } });
        throw error;
      }
      await track(user.id, "monthly_report_emailed", { month: kept.month });
      run.sent += 1;
    } catch (error) {
      console.error("Monthly report email failed", { userId: user.id, error: String(error) });
      run.failed += 1;
    }
  }
  return run;
}
