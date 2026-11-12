import {
  OPS_ALERT_MINUTES,
  OPS_DIGEST_CODES,
  OPS_EVENT_DAYS,
  OPS_EVENT_KINDS,
  OPS_EVENTS_PER_KIND_HOUR,
  type OpsEventKind,
} from "@/config/ops-alerts";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { escapeHtml, sendEmail } from "@/lib/email";
import { teamEmails } from "@/lib/health";
import { log } from "@/lib/log";
import { siteOrigin } from "@/lib/site-origin";
import { systemDb } from "@/lib/system-db";
import { isTrialUser } from "@/lib/trial-ids";

const WHY = "Ops events and their alerts are the system's own records";

// The closed beta's alarms for what isn't a thrown server error (those are src/lib/error-alerts.ts):
// a sign-in email that didn't send, a Plaid webhook or sync that failed, a bank connection that
// broke. Each is a row with its kind and at most Plaid's error code: never a person, an address, an
// item id or anything from a bank. Urgent kinds email the team (ADMIN_EMAILS) at once, at most once
// per kind each OPS_ALERT_MINUTES; the daily digest counts every kind and sends nothing on a quiet
// day. Trial people (sample data) are never counted.

type Options = { client?: PrismaClient; now?: Date; send?: typeof sendEmail };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Plaid's codes and our own are SHOUTING_SNAKE: anything else (a message, an address) is dropped.
export const safeCode = (code: string | null | undefined): string | null =>
  code && /^[A-Z0-9_]{1,64}$/.test(code) ? code : null;

const adminLink = (path: string) => `${siteOrigin() ?? ""}${path}`;

// Records one event and, for an urgent kind, emails the team unless it did in the last
// OPS_ALERT_MINUTES. Never throws: an alarm must not break what it watches.
export async function recordOpsEvent(
  kind: OpsEventKind,
  {
    code = null,
    userId = null,
    client = defaultClient,
    now = new Date(),
    send = sendEmail,
  }: Options & { code?: string | null; userId?: string | null } = {},
): Promise<{ recorded: boolean; emailed: boolean }> {
  if (userId && isTrialUser(userId)) return { recorded: false, emailed: false };
  try {
    const recent = await systemDb(WHY, client).opsEvent.count({
      where: { kind, createdAt: { gte: new Date(now.getTime() - HOUR) } },
    });
    if (recent >= OPS_EVENTS_PER_KIND_HOUR) return { recorded: false, emailed: false };
    await systemDb(WHY, client).opsEvent.create({
      data: { kind, code: safeCode(code), createdAt: now },
    });
    if (!OPS_EVENT_KINDS[kind].urgent) return { recorded: true, emailed: false };
    return { recorded: true, emailed: await alertNow(kind, recent + 1, { client, now, send }) };
  } catch (failure) {
    log.error("Recording an ops event failed", { kind, error: String(failure) });
    return { recorded: false, emailed: false };
  }
}

async function alertNow(
  kind: OpsEventKind,
  lastHour: number,
  { client, now, send }: Required<Options>,
): Promise<boolean> {
  const to = teamEmails();
  if (to.length === 0) return false;
  const key = `ops:${kind}`;
  // Claims the alert, so two failures at once send one email.
  const created = await systemDb(WHY, client).healthNotice.createMany({
    data: [{ key, reportedAt: now }],
    skipDuplicates: true,
  });
  let claimed = created.count === 1;
  if (!claimed) {
    const { count } = await systemDb(WHY, client).healthNotice.updateMany({
      where: { key, reportedAt: { lt: new Date(now.getTime() - OPS_ALERT_MINUTES * MINUTE) } },
      data: { reportedAt: now },
    });
    claimed = count === 1;
  }
  if (!claimed) return false;
  const label = OPS_EVENT_KINDS[kind].label;
  const at = `${now.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const lines = [
    `Jane: ${lastHour} ${label} in the last hour (latest ${at}).`,
    `See /admin/health: ${adminLink("/admin/health")}`,
    `You'll get at most one email about this each ${OPS_ALERT_MINUTES} minutes; the daily email counts the rest.`,
  ];
  try {
    await Promise.all(
      to.map((address) =>
        send({
          to: address,
          subject: `Jane: ${label}`,
          text: lines.join("\n\n"),
          html: lines.map((l) => `<p>${escapeHtml(l)}</p>`).join(""),
        }),
      ),
    );
    return true;
  } catch (failure) {
    // Unclaim, so the next one tries again (a sign-in email failing can mean Resend is down for
    // this one too: /admin/health still counts it).
    await systemDb(WHY, client).healthNotice.deleteMany({ where: { key } });
    log.error("Ops alert email failed", { kind, error: String(failure) });
    return false;
  }
}

export type OpsCount = { kind: OpsEventKind; label: string; count: number; codes: string[] };

// Counts by kind since `since`, most first, with each kind's commonest codes.
export async function opsCounts(
  since: Date,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<OpsCount[]> {
  const rows = await systemDb(WHY, client).opsEvent.groupBy({
    by: ["kind", "code"],
    where: { createdAt: { gte: since, lt: now } },
    _count: { _all: true },
  });
  const byKind = new Map<OpsEventKind, { count: number; codes: [string, number][] }>();
  for (const row of rows) {
    if (!(row.kind in OPS_EVENT_KINDS)) continue;
    const kind = row.kind as OpsEventKind;
    const entry = byKind.get(kind) ?? { count: 0, codes: [] };
    entry.count += row._count._all;
    if (row.code) entry.codes.push([row.code, row._count._all]);
    byKind.set(kind, entry);
  }
  return [...byKind.entries()]
    .map(([kind, e]) => ({
      kind,
      label: OPS_EVENT_KINDS[kind].label,
      count: e.count,
      codes: e.codes
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, OPS_DIGEST_CODES)
        .map(([code, n]) => `${code} ×${n}`),
    }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

// Once a day (the daily digest job): the last day's events by kind. Nothing on a quiet day, and at
// most once a day however often it runs. Returns how many events it covered.
export async function sendOpsDigest({
  client = defaultClient,
  now = new Date(),
  send = sendEmail,
}: Options = {}): Promise<number> {
  await systemDb(WHY, client).opsEvent.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - OPS_EVENT_DAYS * DAY) } },
  });
  const to = teamEmails();
  if (to.length === 0) return 0;
  const counts = await opsCounts(new Date(now.getTime() - DAY), { client, now });
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  if (total === 0) return 0;
  const key = `ops-digest:${now.toISOString().slice(0, 10)}`;
  const { count } = await systemDb(WHY, client).healthNotice.createMany({
    data: [{ key, reportedAt: now }],
    skipDuplicates: true,
  });
  if (count === 0) return 0;
  const lines = counts.map(
    (c) => `${c.count} ${c.label}${c.codes.length > 0 ? ` (${c.codes.join(", ")})` : ""}`,
  );
  const link = adminLink("/admin/health");
  try {
    await Promise.all(
      to.map((address) =>
        send({
          to: address,
          subject: `Jane, last 24 hours: ${lines[0]}${counts.length > 1 ? ` and ${counts.length - 1} more` : ""}`,
          text: ["In the last 24 hours:", ...lines.map((l) => `- ${l}`), `Details: ${link}`].join(
            "\n",
          ),
          html: `<p>In the last 24 hours:</p><ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul><p>Details: <a href="${escapeHtml(link)}">/admin/health</a></p>`,
        }),
      ),
    );
  } catch (failure) {
    await systemDb(WHY, client).healthNotice.deleteMany({ where: { key } });
    log.error("Ops digest failed", { error: String(failure) });
    return 0;
  }
  return total;
}
