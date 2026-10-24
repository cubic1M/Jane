import {
  CHAT_EMAIL_AFTER_MINUTES,
  CHAT_EMAIL_MAX_MESSAGES,
  CHAT_EMAILS_PER_DAY,
  CHAT_URGENT_FROM_PRIORITY,
  CHAT_NOTIFY_DAILY_LIMIT,
  CHAT_NOTIFY_KINDS,
  CHAT_NOTIFY_MAX_AGE_HOURS,
  CHAT_PUSH_BODY_LENGTH,
  CHAT_PUSH_BUTTONS,
} from "@/config/chat-notify";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { appBase } from "@/lib/digest/links";
import { unsubscribeToken } from "@/lib/digest/unsubscribe";
import { sendEmail } from "@/lib/email";
import { enqueueJob, runJob } from "@/lib/jobs";
import { pushEnabled, sendPush, type PushMessage } from "@/lib/push";
import { renderChatEmail, type EmailMessage } from "./notify-email";
import { alwaysSaid, sourceOf, type Attention } from "./attention";
import { loadAttention } from "./attention-load";
import { chatNotifyPrefs, notifiesKind, type ChatNotifyPrefs } from "./notify-prefs";
import { inQuietHours } from "./quiet-hours";
import type { Trigger } from "./sources";
import { createReplyLink } from "./reply-links";
import { parseActions, parseRefs, type MessageAction } from "./types";

// Jane's chat messages as notifications (spec step 85). When Jane's brain posts, the
// important messages go out: as a phone notification straight away where push is on, or,
// once they've sat unread for a while, in one email of everything waiting. Never in quiet
// hours, never past the daily cap, never a message the person already read, answered or
// was told about, and never one twice (jane_messages.notified_at). Delivery is a job
// (src/lib/jobs.ts), so a failure is retried.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// What a notification needs of a message.
export type Notifiable = {
  id: string;
  // Spec step 147: its source, for what's urgent.
  dedupeKey?: string;
  kind: string;
  body: string;
  refs: unknown;
  actions: unknown;
  createdAt: Date;
  notifiedAt?: Date | null;
  notifiedVia: string | null;
  // How it was placed (MESSAGE_PRIORITY), for what can't wait.
  priority?: number;
};

type Channel = "push" | "email" | "both";
const SENT: Channel[] = ["push", "email", "both"];

// The buttons a notification offers: the message's own, minus links and an Undo whose
// time is up. Every one is checked again when tapped.
export function notificationButtons(message: Notifiable, now: Date): MessageAction[] {
  const { undoUntil } = parseRefs(message.refs);
  const undoOver = undoUntil !== undefined && new Date(undoUntil) <= now;
  return parseActions(message.actions).filter(
    (a) => a.kind !== "link" && !(undoOver && a.id.startsWith("undo.")),
  );
}

// The text, cut at a word to fit a notification.
export function trimBody(body: string, max = CHAT_PUSH_BODY_LENGTH): string {
  const text = body.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// The push notification: "Jane", the message, its first buttons, opening it in the chat.
export function chatPushMessage(message: Notifiable, now: Date): PushMessage {
  return {
    title: "Jane",
    body: trimBody(message.body),
    url: `/chat#${message.id}`,
    tag: `jane-${message.id}`,
    messageId: message.id,
    actions: notificationButtons(message, now)
      .slice(0, CHAT_PUSH_BUTTONS)
      .map((a) => ({ action: a.id, title: a.label })),
  };
}

// Spec step 147: several things that aren't urgent go out as one notification, opening the
// chat, instead of one each.
export function bundledPushMessage(messages: Notifiable[]): PushMessage {
  return {
    title: "Jane",
    body: trimBody(`${messages.length} things for you. ${messages[0].body}`),
    url: "/chat",
    tag: "jane-bundle",
  };
}

// Urgent: alerts, deadlines and bills (src/config/attention.ts), never bundled or held back
// from a channel.
const urgent = (m: Notifiable) => alwaysSaid(sourceOf(m.dedupeKey ?? ":"));

// Spec step 147: for someone who wants both, what isn't urgent goes only the way they
// answer (learned from their answers); urgent things go both ways.
export function channelFor(
  m: Notifiable,
  prefs: ChatNotifyPrefs,
  attention: Pick<Attention, "channel"> | null,
): ChatNotifyPrefs["channel"] {
  if (prefs.channel !== "both" || !attention?.channel || urgent(m)) return prefs.channel;
  return attention.channel;
}

// Which messages may go out, most important first: kinds the person wants, and never one
// about an alert (alerts have their own delivery, preferences and cap in
// src/lib/alerts.ts, so they aren't sent twice).
export function chooseToNotify<T extends Notifiable>(messages: T[], prefs: ChatNotifyPrefs): T[] {
  return messages.filter((m) => {
    const refs = parseRefs(m.refs);
    // Spec step 184: the day's agenda goes out like a decision when something on it needs a
    // yes (what it lists is hidden behind it, so it's the only message that can).
    const kind = m.kind === "brief" && (refs.items?.length ?? 0) > 0 ? "decision" : m.kind;
    return notifiesKind(prefs, kind) && refs.alertId === undefined;
  });
}

// Email: real with Resend's key; printed to the console in local development (like the
// sign-in link), where it stays on the developer's own machine; otherwise off.
type Send = typeof sendEmail;
function emailSender(send: Send | undefined): Send | null {
  if (send) return send;
  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) return sendEmail;
  if (process.env.NODE_ENV === "development") {
    return async (email) => console.info(`[dev] Jane's email:\n${email.subject}\n\n${email.text}`);
  }
  return null;
}

type Options = { client?: PrismaClient; now?: Date };
type DeliverOptions = Options & {
  push?: typeof sendPush;
  send?: Send;
  // Email only messages unread at least this long.
  emailAfterMinutes?: number;
};

const MESSAGE_FIELDS = {
  id: true,
  dedupeKey: true,
  kind: true,
  priority: true,
  body: true,
  refs: true,
  actions: true,
  createdAt: true,
  notifiedAt: true,
  notifiedVia: true,
} as const;

// The job: sends what's due for one person. Returns how many messages went each way.
export async function deliverChatNotifications(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    push = sendPush,
    send,
    emailAfterMinutes = CHAT_EMAIL_AFTER_MINUTES,
  }: DeliverOptions = {},
): Promise<{ pushed: number; emailed: number }> {
  const none = { pushed: 0, emailed: 0 };
  // Users have their own helpers, so a read of these columns by id.
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { email: true, timezone: true, deletedAt: true, chatNotifyPrefs: true },
  });
  if (!user || user.deletedAt) return none;
  const prefs = chatNotifyPrefs(user.chatNotifyPrefs);
  if (prefs.channel === "off" || inQuietHours(now, user.timezone)) return none;

  const db = scopedFor(userId, client);
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const [waiting, sentToday, emailTimes] = await Promise.all([
    db.janeMessages.findMany({
      where: {
        status: "open",
        readAt: null,
        kind: { in: [...CHAT_NOTIFY_KINDS] },
        createdAt: { gt: new Date(now.getTime() - CHAT_NOTIFY_MAX_AGE_HOURS * HOUR_MS) },
        // Not sent yet, or (to someone who wants both) pushed but not emailed yet.
        OR: [{ notifiedAt: null }, ...(prefs.channel === "both" ? [{ notifiedVia: "push" }] : [])],
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      select: MESSAGE_FIELDS,
    }),
    db.janeMessages.count({ where: { notifiedAt: { gt: dayAgo }, notifiedVia: { in: SENT } } }),
    db.janeMessages.findMany({
      where: { notifiedAt: { gt: dayAgo }, notifiedVia: { in: ["email", "both"] } },
      distinct: ["notifiedAt"],
      select: { notifiedAt: true },
    }),
  ]);
  const due = chooseToNotify(waiting, prefs);
  let room = CHAT_NOTIFY_DAILY_LIMIT - sentToday;
  // Spec step 147: which way this person answers, for what isn't urgent.
  const attention =
    prefs.channel === "both"
      ? await loadAttention(userId, { client, now, timezone: user.timezone })
      : null;
  const wants = (m: Notifiable, via: "push" | "email") => {
    const channel = channelFor(m, prefs, attention);
    return channel === via || channel === "both";
  };

  // Takes a message for one channel, only if nobody else has meanwhile.
  const claim = async (m: Notifiable, via: Channel) =>
    (
      await db.janeMessages.updateMany({
        where: { id: m.id, notifiedVia: m.notifiedVia },
        data: { notifiedAt: now, notifiedVia: via },
      })
    ).count === 1;
  const unclaim = (m: Notifiable) =>
    db.janeMessages.updateMany({
      where: { id: m.id },
      data: { notifiedAt: m.notifiedAt ?? null, notifiedVia: m.notifiedVia },
    });
  const record = async (m: Notifiable, channel: Channel) => {
    await logAudit(
      SYSTEM_ACTOR,
      "chat_notification_sent",
      { type: "jane_message", id: m.id },
      {
        channel,
        kind: m.kind,
      },
    );
    await track(userId, "chat_notification_sent", { channel, kind: m.kind });
  };

  // Push, straight away.
  let pushed = 0;
  let pushWorks = false;
  const pushedIds = new Set<string>();
  if (prefs.channel !== "email" && pushEnabled() && (await db.pushSubscriptions.count()) > 0) {
    pushWorks = true;
    const toPush = due.filter((d) => d.notifiedVia === null && wants(d, "push"));
    // Urgent ones each on their own, with their buttons; the rest together (spec step 147).
    const quiet = toPush.filter((m) => !urgent(m));
    const groups = [
      ...toPush.filter(urgent).map((m) => [m]),
      ...(quiet.length > 1 ? [quiet] : quiet.map((m) => [m])),
    ];
    for (const group of groups) {
      if (room <= 0) break;
      const claimed: Notifiable[] = [];
      for (const m of group.slice(0, room)) if (await claim(m, "push")) claimed.push(m);
      if (claimed.length === 0) continue;
      const message =
        claimed.length === 1 ? chatPushMessage(claimed[0], now) : bundledPushMessage(claimed);
      if ((await push(userId, message, { client })) === 0) {
        // No device took it (all gone): give them back for email.
        for (const m of claimed) await unclaim(m);
        pushWorks = false;
        break;
      }
      for (const m of claimed) {
        pushedIds.add(m.id);
        pushed += 1;
        room -= 1;
        await record(m, "push");
      }
    }
  }

  // Email: to people who want it, or who chose push but have no device that takes it.
  const wantsEmail = prefs.channel === "email" || prefs.channel === "both" || !pushWorks;
  const sender = wantsEmail ? emailSender(send) : null;
  if (!sender) return { pushed, emailed: 0 };
  // Today's email has gone: only what can't wait, in an email of its own.
  const onlyUrgent = emailTimes.length >= CHAT_EMAILS_PER_DAY;
  const pressing = (m: Notifiable) =>
    m.kind !== "brief" && (m.priority ?? 0) >= CHAT_URGENT_FROM_PRIORITY;
  const unreadSince = now.getTime() - emailAfterMinutes * MINUTE_MS;
  const batch: Notifiable[] = [];
  for (const m of due) {
    if (batch.length >= CHAT_EMAIL_MAX_MESSAGES) break;
    if (pushedIds.has(m.id) || m.createdAt.getTime() > unreadSince) continue;
    if (onlyUrgent && !pressing(m)) continue;
    // Spec step 147: what isn't urgent goes only the way they answer, when Jane knows it.
    if (pushWorks && !wants(m, "email")) continue;
    // A message already pushed (to someone who wants both) doesn't count twice.
    // What can't wait goes even past the day's cap.
    if (m.notifiedVia === null) {
      if (room <= 0 && !pressing(m)) continue;
      room -= 1;
    }
    batch.push(m);
  }
  const claimed: Notifiable[] = [];
  for (const m of batch) {
    if (await claim(m, m.notifiedVia === "push" ? "both" : "email")) claimed.push(m);
  }
  if (claimed.length === 0) return { pushed, emailed: 0 };

  try {
    const messages: EmailMessage[] = [];
    for (const m of claimed) {
      const buttons = [];
      for (const a of notificationButtons(m, now)) {
        buttons.push({
          label: a.label,
          url: await createReplyLink(userId, m.id, a.id, { client, now }),
        });
      }
      messages.push({
        kind: m.kind,
        body: m.body,
        buttons,
        chatUrl: `${appBase()}/chat#${m.id}`,
      });
    }
    const query = new URLSearchParams({ token: unsubscribeToken(userId), what: "chat" });
    await sender({
      to: user.email,
      ...renderChatEmail(messages, {
        chat: `${appBase()}/chat`,
        settings: `${appBase()}/settings#jane-messages`,
        unsubscribe: `${appBase()}/unsubscribe?${query}`,
      }),
      headers: {
        // One-click unsubscribe from the mail app (RFC 8058): turns these emails off.
        "List-Unsubscribe": `<${appBase()}/api/unsubscribe?${query}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
  } catch (error) {
    // Give them back so the retry sends them; the job queue retries this whole run.
    for (const m of claimed) await unclaim(m);
    throw error;
  }
  for (const m of claimed) await record(m, "email");
  return { pushed, emailed: claimed.length };
}

// After Jane's brain runs (src/lib/jane-agent/run.ts): a job to send what's due, run
// straight away; a failure is retried by the queue. Nothing when nothing is waiting. After
// a sync or an import the person may well be in the app, so email waits until messages
// have sat unread for a while (the daily run sends them); the daily run itself emails
// straight away.
export async function queueChatNotifications(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    trigger = "sync",
    deliver = deliverChatNotifications,
  }: Options & { trigger?: Trigger; deliver?: typeof deliverChatNotifications } = {},
): Promise<string | null> {
  if (trigger === "open") return null;
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { chatNotifyPrefs: true },
  });
  const prefs = chatNotifyPrefs(user?.chatNotifyPrefs);
  const kinds = CHAT_NOTIFY_KINDS.filter((k) => notifiesKind(prefs, k));
  if (!user || kinds.length === 0) return null;
  const waiting = await scopedFor(userId, client).janeMessages.count({
    where: {
      status: "open",
      readAt: null,
      kind: { in: kinds },
      createdAt: { gt: new Date(now.getTime() - CHAT_NOTIFY_MAX_AGE_HOURS * HOUR_MS) },
      OR: [{ notifiedAt: null }, ...(prefs.channel === "both" ? [{ notifiedVia: "push" }] : [])],
    },
  });
  if (waiting === 0) return null;

  const emailAfterMinutes = trigger === "cron" ? 0 : CHAT_EMAIL_AFTER_MINUTES;
  const id = await enqueueJob("chat_notify", { userId }, { client, now });
  await runJob(id, {
    client,
    now,
    handlers: { chat_notify: () => deliver(userId, { client, now, emailAfterMinutes }) },
  });
  return id;
}

// Never lets notifications fail what called them (Jane's run after a sync or import).
export async function queueChatNotificationsSafely(
  userId: string,
  options: Options & { trigger?: Trigger } = {},
): Promise<void> {
  try {
    await queueChatNotifications(userId, options);
  } catch (error) {
    console.error("Queueing Jane's notifications failed", { userId, error: String(error) });
  }
}
