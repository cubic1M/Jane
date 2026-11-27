import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { escapeHtml } from "@/lib/escape-html";
import { sendEmail } from "@/lib/email";
import { teamEmails } from "@/lib/health";
import { log } from "@/lib/log";
import { siteOrigin } from "@/lib/site-origin";
import { systemDb } from "@/lib/system-db";
import { taxCheckDay, taxYearReady, type TaxYearReady } from "./nightly";
import { latestAccuracy } from "./accuracy";

const WHY = "The daily accuracy email claims its day in the system's own notices";

// The daily health email's accuracy part: when the day's accuracy checks found something wrong,
// the team gets the names of the checks and their counts, once a day, with a link to
// /admin/accuracy. Never an amount, a merchant, a name or who.
export async function sendAccuracyEmail({
  client = defaultClient,
  now = new Date(),
  send = sendEmail,
  taxReady = taxYearReady,
}: {
  client?: PrismaClient;
  now?: Date;
  send?: typeof sendEmail;
  taxReady?: (day: string) => TaxYearReady;
} = {}): Promise<boolean> {
  const to = teamEmails();
  if (to.length === 0) return false;
  const latest = await latestAccuracy({ client });
  // Only a run from the last day: an old one was already sent.
  const fresh =
    latest && now.getTime() - latest.at.getTime() <= 24 * 60 * 60 * 1000 ? latest : null;
  const failing = fresh?.summary.checks.filter((c) => c.failed > 0) ?? [];
  const unreached = fresh ? fresh.summary.notChecked + fresh.summary.errored : 0;
  // Tax T32: a missing or stale tax year rides in this email (names and years only).
  const taxDay = taxCheckDay(now);
  const tax = taxReady(taxDay);
  const accuracyReason = failing.length > 0 || unreached > 0;
  // Less email noise: a tax warning alone is sent on Mondays only (stateless: the weekday of the
  // check's day). Red is sent every day, and anything rides along when the email goes out anyway.
  const monday = new Date(`${taxDay}T00:00:00Z`).getUTCDay() === 1;
  const taxSends = tax.state === "red" || (tax.state === "warning" && monday);
  const taxLines = tax.state === "ok" || (!accuracyReason && !taxSends) ? [] : tax.messages;
  if (!accuracyReason && taxLines.length === 0) return false;
  const key = `accuracy:${now.toISOString().slice(0, 10)}`;
  const { count } = await systemDb(WHY, client).healthNotice.createMany({
    data: [{ key, reportedAt: now }],
    skipDuplicates: true,
  });
  if (count === 0) return false;
  const lines = [
    ...taxLines.map((m) => `tax figures (${tax.state}): ${m}`),
    ...failing.map((c) => `${c.name}: ${c.failed} of ${c.passed + c.failed} failed`),
    ...(fresh && fresh.summary.errored > 0
      ? [`${fresh.summary.errored} people's checks threw`]
      : []),
    ...(fresh && fresh.summary.notChecked > 0
      ? [`${fresh.summary.notChecked} people not reached in the run's time`]
      : []),
  ];
  const link = `${siteOrigin() ?? ""}/admin/accuracy`;
  const intro =
    fresh && (failing.length > 0 || unreached > 0)
      ? `Jane's accuracy checks on ${fresh.summary.checked} real people found something wrong:`
      : "Jane's nightly checks found something to act on:";
  const taxMark = tax.state === "red" ? " (and a tax year is red)" : "";
  const subject =
    failing.length > 0
      ? `Jane accuracy: ${failing.length} ${failing.length === 1 ? "check" : "checks"} failing${taxMark}`
      : unreached > 0
        ? `Jane accuracy: people not reached${taxMark}`
        : `Jane tax figures: ${tax.state}`;
  try {
    await Promise.all(
      to.map((address) =>
        send({
          to: address,
          subject,
          text: [intro, ...lines.map((l) => `- ${l}`), `Counts by check: ${link}`].join("\n"),
          html: `<p>${escapeHtml(intro)}</p><ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul><p>Counts by check: <a href="${escapeHtml(link)}">/admin/accuracy</a></p>`,
        }),
      ),
    );
  } catch (error) {
    // Unclaim, so the next run tries again.
    await systemDb(WHY, client).healthNotice.deleteMany({ where: { key } });
    log.error("Accuracy email failed", { error: String(error) });
    return false;
  }
  return true;
}
