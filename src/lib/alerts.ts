import {
  ALERT_EMAILS_PER_DAY,
  ALERT_LABELS,
  ALERT_TYPES,
  ALERTS_PAGE_LIMIT,
  DEFAULT_ALERT_DELIVERY,
  URGENT_ALERT_TYPES,
  type AlertDelivery,
} from "@/config/alerts";
import type { AlertCandidate } from "@/detection/alerts";
import type { AlertType, PrismaClient } from "@/generated/prisma/client";
import { renderAlertEmail } from "@/lib/alert-email";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { appBase } from "@/lib/digest/links";
import { unsubscribeToken } from "@/lib/digest/unsubscribe";
import { sendEmail } from "@/lib/email";
import { pushEnabled, sendPush } from "@/lib/push";

// Saving alerts and emailing the urgent ones. Which alerts exist is decided in
// src/detection/alerts.ts; this module applies the person's preferences, makes sure each
// event is stored once, and keeps alert emails under the daily cap.

const DAY_MS = 24 * 60 * 60 * 1000;

export type AlertPrefs = Record<AlertType, AlertDelivery>;

export const isUrgent = (type: AlertType) => URGENT_ALERT_TYPES.includes(type);

// The person's saved choices over the defaults. Anything unrecognised falls back to the
// default, and only urgent types can be emailed right away.
export function alertPrefs(saved: unknown): AlertPrefs {
  const raw = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
  const prefs = { ...DEFAULT_ALERT_DELIVERY };
  for (const type of ALERT_TYPES) {
    const value = raw[type];
    if (value === "app" || value === "off") prefs[type] = value;
    else if (value === "email") prefs[type] = isUrgent(type) ? "email" : "app";
  }
  return prefs;
}

// Every emailed type turned down to in-app only: what "unsubscribe" means for alerts.
export function withoutAlertEmails(prefs: AlertPrefs): AlertPrefs {
  return Object.fromEntries(
    Object.entries(prefs).map(([type, value]) => [type, value === "email" ? "app" : value]),
  ) as AlertPrefs;
}

type Options = {
  client?: PrismaClient;
  now?: Date;
  send?: typeof sendEmail;
  push?: typeof sendPush;
};

// Stores the alerts the person hasn't turned off. An event already stored (same type and
// key) is skipped by the unique index, so rescans never raise it twice. Then emails any
// urgent ones.
export async function raiseAlerts(
  userId: string,
  alerts: AlertCandidate[],
  { client = defaultClient, now = new Date(), send = sendEmail, push = sendPush }: Options = {},
): Promise<{ raised: number; emailed: number }> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { alertPrefs: true, deletedAt: true },
  });
  if (!user || user.deletedAt) return { raised: 0, emailed: 0 };
  const prefs = alertPrefs(user.alertPrefs);

  const wanted = alerts.filter((a) => prefs[a.type] !== "off");
  if (wanted.length === 0) return { raised: 0, emailed: 0 };

  const created = await scopedFor(userId, client).alerts.createManyAndReturn({
    data: wanted.map((a) => ({ userId, ...a, urgent: isUrgent(a.type), createdAt: now })),
    skipDuplicates: true,
    select: { type: true },
  });
  if (created.length > 0) {
    const byType = Object.fromEntries(ALERT_TYPES.map((t) => [t, 0])) as Record<AlertType, number>;
    for (const row of created) byType[row.type] += 1;
    await track(userId, "alerts_raised", { ...byType, total: created.length });
  }
  const emailed = await emailUrgentAlerts(userId, { client, now, send, push });
  return { raised: created.length, emailed };
}

// Sends urgent alerts from the last day that haven't gone out, oldest first, while the
// person is under ALERT_EMAILS_PER_DAY in the last 24 hours: as a phone notification when
// push is set up and they turned it on, by email otherwise (and if no device takes it).
// emailed_at records either. Whatever doesn't fit, or fails, goes in the weekly email.
export async function emailUrgentAlerts(
  userId: string,
  { client = defaultClient, now = new Date(), send = sendEmail, push = sendPush }: Options = {},
): Promise<number> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { email: true, alertPrefs: true, deletedAt: true },
  });
  if (!user || user.deletedAt) return 0;
  const prefs = alertPrefs(user.alertPrefs);
  const emailTypes = ALERT_TYPES.filter((t) => prefs[t] === "email");
  if (emailTypes.length === 0) return 0;

  const db = scopedFor(userId, client);
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const sentToday = await db.alerts.count({ where: { emailedAt: { gt: dayAgo } } });
  const room = ALERT_EMAILS_PER_DAY - sentToday;
  if (room <= 0) return 0;

  const due = await db.alerts.findMany({
    where: {
      urgent: true,
      emailedAt: null,
      readAt: null,
      type: { in: emailTypes },
      createdAt: { gt: dayAgo },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: room,
    select: { id: true, type: true, title: true, body: true },
  });

  const query = new URLSearchParams({ token: unsubscribeToken(userId), what: "alerts" });
  const links = {
    alerts: `${appBase()}/alerts`,
    settings: `${appBase()}/settings#alerts`,
    unsubscribe: `${appBase()}/unsubscribe?${query}`,
  };
  const usePush = pushEnabled() && (await db.pushSubscriptions.count()) > 0;
  let emailed = 0;
  for (const alert of due) {
    // Claim the alert first, so two scans running at once can't both email it.
    const { count } = await db.alerts.updateMany({
      where: { id: alert.id, emailedAt: null },
      data: { emailedAt: now },
    });
    if (count === 0) continue;
    if (usePush) {
      const label = ALERT_LABELS[alert.type].label;
      const pushed = await push(
        userId,
        { title: `${label}: ${alert.title}`, body: alert.body, url: "/alerts" },
        { client },
      );
      if (pushed > 0) {
        await track(userId, "alert_pushed", { type: alert.type });
        emailed += 1;
        continue;
      }
    }
    try {
      await send({
        to: user.email,
        ...renderAlertEmail(alert, links),
        headers: {
          // One-click unsubscribe from the mail app (RFC 8058): turns alert emails off.
          "List-Unsubscribe": `<${appBase()}/api/unsubscribe?${query}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
    } catch (error) {
      // Unclaim it: it shows in the app, and the weekly email picks it up.
      await db.alerts.updateMany({ where: { id: alert.id }, data: { emailedAt: null } });
      console.error("Alert email failed", { userId, alertId: alert.id, error: String(error) });
      continue;
    }
    await track(userId, "alert_emailed", { type: alert.type });
    emailed += 1;
  }
  return emailed;
}

// The types the person still wants to see; alerts of a type they turned off are hidden.
async function shownTypes(userId: string, client: PrismaClient): Promise<AlertType[]> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { alertPrefs: true },
  });
  const prefs = alertPrefs(user?.alertPrefs);
  return ALERT_TYPES.filter((t) => prefs[t] !== "off");
}

// The newest alerts for /alerts.
export async function listAlerts(
  userId: string,
  { client = defaultClient }: Pick<Options, "client"> = {},
) {
  return scopedFor(userId, client).alerts.findMany({
    where: { type: { in: await shownTypes(userId, client) } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: ALERTS_PAGE_LIMIT,
    select: { id: true, type: true, title: true, body: true, createdAt: true, readAt: true },
  });
}

export async function unreadAlertCount(
  userId: string,
  { client = defaultClient }: Pick<Options, "client"> = {},
): Promise<number> {
  return scopedFor(userId, client).alerts.count({
    where: { readAt: null, type: { in: await shownTypes(userId, client) } },
  });
}

// Once the person has seen /alerts, everything there is read (and won't be emailed late).
export async function markAlertsRead(
  userId: string,
  { client = defaultClient, now = new Date() }: Pick<Options, "client" | "now"> = {},
): Promise<void> {
  await scopedFor(userId, client).alerts.updateMany({
    where: { readAt: null },
    data: { readAt: now },
  });
}
