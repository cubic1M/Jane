import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { escapeHtml, sendEmail } from "@/lib/email";
import { teamEmails } from "@/lib/health";
import { log } from "@/lib/log";
import { siteOrigin } from "@/lib/site-origin";
import { systemDb } from "@/lib/system-db";
import { latestAccuracy } from "./accuracy";

const WHY = "The daily accuracy email claims its day in the system's own notices";

// The daily health email's accuracy part: when the day's accuracy checks found something wrong,
// the team gets the names of the checks and their counts, once a day, with a link to
// /admin/accuracy. Never an amount, a merchant, a name or who.
export async function sendAccuracyEmail({
  client = defaultClient,
  now = new Date(),
  send = sendEmail,
}: { client?: PrismaClient; now?: Date; send?: typeof sendEmail } = {}): Promise<boolean> {
  const to = teamEmails();
  if (to.length === 0) return false;
  const latest = await latestAccuracy({ client });
  // Only a run from the last day: an old one was already sent.
  if (!latest || now.getTime() - latest.at.getTime() > 24 * 60 * 60 * 1000) return false;
  const failing = latest.summary.checks.filter((c) => c.failed > 0);
  const unreached = latest.summary.notChecked + latest.summary.errored;
  if (failing.length === 0 && unreached === 0) return false;
  const key = `accuracy:${now.toISOString().slice(0, 10)}`;
  const { count } = await systemDb(WHY, client).healthNotice.createMany({
    data: [{ key, reportedAt: now }],
    skipDuplicates: true,
  });
  if (count === 0) return false;
  const lines = [
    ...failing.map((c) => `${c.name}: ${c.failed} of ${c.passed + c.failed} failed`),
    ...(latest.summary.errored > 0 ? [`${latest.summary.errored} people's checks threw`] : []),
    ...(latest.summary.notChecked > 0
      ? [`${latest.summary.notChecked} people not reached in the run's time`]
      : []),
  ];
  const link = `${siteOrigin() ?? ""}/admin/accuracy`;
  const intro = `Jane's accuracy checks on ${latest.summary.checked} real people found something wrong:`;
  try {
    await Promise.all(
      to.map((address) =>
        send({
          to: address,
          subject: `Jane accuracy: ${failing.length} ${failing.length === 1 ? "check" : "checks"} failing`,
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
