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
  const tax = taxReady(taxCheckDay(now));
  const taxLines = tax.state === "ok" ? [] : tax.messages;
  if (failing.length === 0 && unreached === 0 && taxLines.length === 0) return false;
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
  const intro = fresh
    ? `Jane's accuracy checks on ${fresh.summary.checked} real people found something wrong:`
    : "Jane's nightly checks found something to act on:";
  const subject =
    failing.length > 0
      ? `Jane accuracy: ${failing.length} ${failing.length === 1 ? "check" : "checks"} failing`
      : unreached > 0
        ? "Jane accuracy: people not reached"
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
