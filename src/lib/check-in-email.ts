import { CHECK_IN_EMAIL_DAYS } from "@/config/digest";
import type { PrismaClient } from "@/generated/prisma/client";
import { previousMonth } from "@/insights/check-in";
import { track } from "@/lib/analytics";
import { isEmpty, loadCheckIn, summaryFor, type CheckIn } from "@/lib/check-in";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { appBase } from "@/lib/digest/links";
import { unsubscribeToken } from "@/lib/digest/unsubscribe";
import { localDate } from "@/lib/digest/week";
import { sendEmail } from "@/lib/email";
import { formatCents } from "@/lib/money";

// The monthly check-in email: in the first CHECK_IN_EMAIL_DAYS of each month (in the
// person's timezone), last month's check-in, once. Only for people who get the weekly
// email (the same setting and unsubscribe link), and never for an empty month.

type Options = { client?: PrismaClient; now?: Date; send?: typeof sendEmail };

const esc = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export function renderCheckInEmail(
  c: CheckIn,
  summary: string,
  links: { page: string; unsubscribe: string },
) {
  const month = new Date(`${c.month}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const lines = [
    `Spent: ${formatCents(c.spendingCents)} (month before: ${formatCents(c.previousSpendingCents)})`,
    `Came in: ${formatCents(c.incomeCents)}`,
    ...(c.budgets.length
      ? [`Budgets kept: ${c.budgets.filter((b) => b.kept).length} of ${c.budgets.length}`]
      : []),
    ...(c.netWorth
      ? [
          `Net worth: ${formatCents(c.netWorth.endCents)} (${c.netWorth.endCents >= c.netWorth.startCents ? "up" : "down"} ${formatCents(Math.abs(c.netWorth.endCents - c.netWorth.startCents))})`,
        ]
      : []),
  ];
  const subject = `Your ${month} check-in`;
  const text = [
    subject,
    "",
    summary,
    "",
    ...lines,
    "",
    `See it all: ${links.page}`,
    "",
    `Unsubscribe: ${links.unsubscribe}`,
  ].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b;line-height:1.5">
<h1 style="font-size:22px">${esc(subject)}</h1>
<p>${esc(summary)}</p>
<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
<p><a href="${esc(links.page)}" style="color:#047857">See it all</a></p>
<p style="margin-top:32px;font-size:12px;color:#71717a"><a href="${esc(links.unsubscribe)}" style="color:#71717a">Unsubscribe</a></p>
</div>`;
  return { subject, text, html };
}

export async function runMonthlyCheckIns({
  client = defaultClient,
  now = new Date(),
  send = sendEmail,
}: Options = {}): Promise<{ sent: number; skipped: number; failed: number }> {
  const users = await client.user.findMany({
    where: { digestEnabled: true, deletedAt: null, accounts: { some: {} } },
    select: { id: true, email: true, timezone: true },
    orderBy: { id: "asc" },
  });
  const run = { sent: 0, skipped: 0, failed: 0 };
  for (const user of users) {
    try {
      const today = localDate(now, user.timezone);
      if (Number(today.slice(8, 10)) > CHECK_IN_EMAIL_DAYS) {
        run.skipped += 1;
        continue;
      }
      const month = previousMonth(today);
      const db = scopedFor(user.id, client);
      const done = await db.checkIns.findFirst({
        where: { month, emailedAt: { not: null } },
        select: { id: true },
      });
      if (done) {
        run.skipped += 1;
        continue;
      }
      const checkIn = await loadCheckIn(user.id, month, { client });
      if (isEmpty(checkIn)) {
        run.skipped += 1;
        continue;
      }
      const summary = await summaryFor(user.id, checkIn, { client });
      const query = new URLSearchParams({ m: month });
      const email = renderCheckInEmail(checkIn, summary, {
        page: `${appBase()}/check-in?${query}`,
        unsubscribe: `${appBase()}/unsubscribe?token=${unsubscribeToken(user.id)}`,
      });
      await send({
        to: user.email,
        ...email,
        headers: {
          "List-Unsubscribe": `<${appBase()}/api/unsubscribe?token=${unsubscribeToken(user.id)}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      await db.checkIns.updateMany({ where: { month }, data: { emailedAt: now } });
      await track(user.id, "check_in_emailed", { month });
      run.sent += 1;
    } catch (error) {
      console.error("Check-in email failed", { userId: user.id, error: String(error) });
      run.failed += 1;
    }
  }
  return run;
}
