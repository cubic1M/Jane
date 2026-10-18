import { ALERT_TYPES, ALERTS_PAGE_LIMIT } from "@/config/alerts";
import { moneyFound } from "@/detection/engine";
import { alertPrefs } from "@/lib/alerts";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { offerFor } from "@/lib/membership/service";
import { sendEmail } from "@/lib/email";
import { buildDigest, type DigestPayload } from "./build";
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
  const [actions, findings, found, last, offer, user] = await Promise.all([
    db.actions.findMany({
      select: {
        status: true,
        completedAt: true,
        userTodo: true,
        decision: { select: { cardSnapshot: true } },
      },
    }),
    db.findings.findMany({
      where: { status: { in: ["new", "shown"] } },
      select: { title: true, annualSavingsCents: true, createdAt: true },
    }),
    moneyFound(userId, { client }),
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
  return buildDigest({
    now,
    lastSentAt: last?.sentAt ?? null,
    moneyFoundCents: found,
    membershipOffer: offer.show,
    actions: actions.map((a) => ({
      status: a.status,
      completedAt: a.completedAt,
      userTodo: a.userTodo,
      ...titleOf(a.decision.cardSnapshot),
    })),
    findings,
    alerts,
  });
}

function linksFor(digestId: string, userId: string): DigestLinks {
  return {
    report: clickLink(digestId, "/report"),
    actions: clickLink(digestId, "/actions"),
    alerts: clickLink(digestId, "/alerts"),
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
    select: { id: true, email: true, timezone: true },
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
      const links = linksFor(digest.id, user.id);
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
