import { ERROR_ALERT_MINUTES, ERROR_DIGEST_KINDS } from "@/config/health";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { teamEmails } from "@/lib/health";

// Knowing when Jane breaks before people tell us (founder, 2026-10-26): a server error emails the
// team (ADMIN_EMAILS, through Resend) at most once per kind of error per ERROR_ALERT_MINUTES,
// and a short digest of the day's errors goes out once a day. The emails carry only the kind of
// error (its class), where it happened (the path, ids taken out) and counts: never a message,
// a stack, an email address, a token or anything from someone's bank. The details stay in
// /admin/errors, already scrubbed (src/lib/error-log.ts).

type Options = { client?: PrismaClient; now?: Date; send?: typeof sendEmail };

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

// The kind of error ("TypeError") from a stored message ("TypeError: ..."), nothing after it.
export function errorKind(message: string): string {
  const name = message.split(":")[0].trim();
  return /^[A-Za-z][\w.]{0,60}$/.test(name) ? name : "Error";
}

// A path with nothing that could name someone: any part with a digit, or a long one (an id),
// becomes ":id"; no query string.
export function safePath(path: string | null | undefined): string {
  if (!path) return "(no path)";
  return (
    path
      .split("?")[0]
      .split("/")
      .map((part) => (/\d/.test(part) || part.length > 24 ? ":id" : part))
      .join("/")
      .slice(0, 120) || "/"
  );
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const adminLink = (path: string) => `${process.env.APP_URL ?? ""}${path}`;

// Emails the team about this error unless the same kind, in the same place, was emailed in the
// last ERROR_ALERT_MINUTES. Returns whether it emailed. Never throws: an alert must not cause
// another error.
export async function alertError(
  error: { message: string; path?: string | null },
  { client = defaultClient, now = new Date(), send = sendEmail }: Options = {},
): Promise<boolean> {
  try {
    const to = teamEmails();
    if (to.length === 0) return false;
    const kind = errorKind(error.message);
    const where = safePath(error.path);
    const key = `error:${kind}:${where}`;
    // Claims the alert: a new kind, or one last emailed long enough ago. Two errors at once
    // send one email.
    const created = await client.healthNotice.createMany({
      data: [{ key, reportedAt: now }],
      skipDuplicates: true,
    });
    let claimed = created.count === 1;
    if (!claimed) {
      const { count } = await client.healthNotice.updateMany({
        where: { key, reportedAt: { lt: new Date(now.getTime() - ERROR_ALERT_MINUTES * MINUTE) } },
        data: { reportedAt: now },
      });
      claimed = count === 1;
    }
    if (!claimed) return false;
    const at = `${now.toISOString().slice(0, 16).replace("T", " ")} UTC`;
    const message = {
      subject: `Jane error: ${kind} on ${where}`,
      text: [
        `A server error (${kind}) happened on ${where} at ${at}.`,
        `Details, scrubbed: ${adminLink("/admin/errors")}`,
        `You'll get at most one email for this kind of error, in this place, each ${ERROR_ALERT_MINUTES} minutes.`,
      ].join("\n\n"),
      html: `<p>A server error (<b>${escape(kind)}</b>) happened on <code>${escape(where)}</code> at ${at}.</p><p>Details, scrubbed: <a href="${escape(adminLink("/admin/errors"))}">/admin/errors</a></p><p>You'll get at most one email for this kind of error, in this place, each ${ERROR_ALERT_MINUTES} minutes.</p>`,
    };
    await Promise.all(to.map((address) => send({ ...message, to: address })));
    return true;
  } catch (failure) {
    console.error("Error alert failed", { error: String(failure) });
    return false;
  }
}

export type ErrorDigestLine = { kind: string; where: string; count: number };

// The day's errors by kind and place, most first.
export function digestLines(
  events: readonly { message: string; path: string | null }[],
): ErrorDigestLine[] {
  const counts = new Map<string, ErrorDigestLine>();
  for (const e of events) {
    const kind = errorKind(e.message);
    const where = safePath(e.path);
    const key = `${kind} ${where}`;
    const line = counts.get(key) ?? { kind, where, count: 0 };
    line.count += 1;
    counts.set(key, line);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}

// Once a day (from the daily digest job): the last day's errors, counted by kind and place.
// Nothing is sent on a day without errors. Returns how many errors it covered.
export async function sendErrorDigest({
  client = defaultClient,
  now = new Date(),
  send = sendEmail,
}: Options = {}): Promise<number> {
  const to = teamEmails();
  if (to.length === 0) return 0;
  const events = await client.errorEvent.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - DAY), lt: now } },
    select: { message: true, path: true },
    take: 10_000,
  });
  if (events.length === 0) return 0;
  // Once per day, even if the job runs twice.
  const { count } = await client.healthNotice.createMany({
    data: [{ key: `error-digest:${now.toISOString().slice(0, 10)}`, reportedAt: now }],
    skipDuplicates: true,
  });
  if (count === 0) return 0;
  const lines = digestLines(events);
  const shown = lines.slice(0, ERROR_DIGEST_KINDS);
  const more = lines.length - shown.length;
  const message = {
    subject: `Jane errors, last 24 hours: ${events.length}`,
    text: [
      `${events.length} server ${events.length === 1 ? "error" : "errors"} in the last 24 hours:`,
      ...shown.map((l) => `- ${l.count} × ${l.kind} on ${l.where}`),
      ...(more > 0 ? [`- and ${more} more kinds`] : []),
      `Details, scrubbed: ${adminLink("/admin/errors")}`,
    ].join("\n"),
    html: `<p>${events.length} server ${events.length === 1 ? "error" : "errors"} in the last 24 hours:</p><ul>${shown
      .map(
        (l) => `<li>${l.count} × <b>${escape(l.kind)}</b> on <code>${escape(l.where)}</code></li>`,
      )
      .join(
        "",
      )}${more > 0 ? `<li>and ${more} more kinds</li>` : ""}</ul><p>Details, scrubbed: <a href="${escape(adminLink("/admin/errors"))}">/admin/errors</a></p>`,
  };
  try {
    await Promise.all(to.map((address) => send({ ...message, to: address })));
  } catch (failure) {
    // Unclaim, so the next run tries again.
    await client.healthNotice.deleteMany({
      where: { key: `error-digest:${now.toISOString().slice(0, 10)}` },
    });
    console.error("Error digest failed", { error: String(failure) });
    return 0;
  }
  return events.length;
}
