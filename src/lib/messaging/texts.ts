import {
  TEXT_CODE_MAX_TRIES,
  TEXT_CODE_MINUTES,
  TEXT_CONSENT_VERSION,
  TEXT_ERROR_LENGTH,
  TEXT_MAX_LENGTH,
  TEXT_PLAN_DAYS,
  TEXT_PLAN_MAX_ITEMS,
  TEXT_PLAN_TITLE_LENGTH,
} from "@/config/messaging";
import { ALERT_LABELS } from "@/config/alerts";
import { Prisma, type AlertType, type PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { decrypt, encrypt } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { appBase } from "@/lib/digest/links";
import { weekStart } from "@/lib/digest/week";
import { enqueueJob, runJob } from "@/lib/jobs";
import { noRiskItems, type LinkItem } from "@/lib/plan-links";
import { hit } from "@/lib/rate-limit";
import { scrub } from "@/lib/scrub";
import { codeMatches, hashCode, maskPhone, newCode, normalizeUsPhone, phoneHmac } from "./phone";
import { messagingMode, sendText, type MessagingMode } from "./provider";
import { inQuietHours, sendTime } from "./quiet-hours";

// Jane's texts (spec step 78): the person's number and consent, what gets texted, and
// delivery through the jobs queue. Every text is fixed wording filled in with the
// person's own titles and links; no Claude text is ever sent. A number gets nothing until
// it's verified with a code, and nothing at all once texts are off or the person replied
// STOP (except the one note confirming it, and answers to HELP).

type Options = { client?: PrismaClient; now?: Date };

export type TextKind =
  | "code"
  | "welcome"
  | "alert"
  | "plan"
  | "needs_you"
  | "reply"
  // The note confirming STOP, and the answer to HELP: sent even with texts off.
  | "opt_out"
  | "help";

// The setting each kind of text needs on.
const PREF_FOR: Partial<Record<TextKind, "alerts" | "weeklyPlan" | "needsYou">> = {
  alert: "alerts",
  plan: "weeklyPlan",
  needs_you: "needsYou",
};
// Sent whatever the hour: what the person just asked for, or an answer to their text.
const ANY_HOUR: readonly TextKind[] = ["code", "welcome", "reply", "opt_out", "help"];
// Sent even with texts off or after STOP.
const WHEN_OFF: readonly TextKind[] = ["opt_out", "help"];

export class TextError extends Error {}

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export function fitText(body: string): string {
  return body.length <= TEXT_MAX_LENGTH ? body : `${body.slice(0, TEXT_MAX_LENGTH - 1)}…`;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

type Setting = {
  id: string;
  verifiedAt: Date | null;
  enabled: boolean;
  optedOutAt: Date | null;
  alerts: boolean;
  weeklyPlan: boolean;
  needsYou: boolean;
};

// Whether this kind of text may go to the person now (before quiet hours).
export function mayText(setting: Setting | null, kind: TextKind): boolean {
  if (!setting?.verifiedAt) return false;
  if (WHEN_OFF.includes(kind)) return true;
  if (!setting.enabled || setting.optedOutAt) return false;
  const pref = PREF_FOR[kind];
  return pref ? setting[pref] : true;
}

const SETTING_SELECT = {
  id: true,
  verifiedAt: true,
  enabled: true,
  optedOutAt: true,
  alerts: true,
  weeklyPlan: true,
  needsYou: true,
} as const;

async function settingFor(userId: string, client: PrismaClient) {
  return scopedFor(userId, client).textSettings.findFirst({ select: SETTING_SELECT });
}

async function timezoneOf(userId: string, client: PrismaClient) {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { timezone: true, deletedAt: true },
  });
  return user && !user.deletedAt ? { timezone: user.timezone } : null;
}

export type QueueOptions = Options & {
  // A weekly plan text's items, week and expiry.
  plan?: { items: LinkItem[]; weekStart: Date; expiresAt: Date };
  // For tests: what sends a text due now.
  send?: typeof sendText;
};

// Stores the text and queues its delivery (job text_send), not before morning unless it's
// an answer. Due now, it's sent straight away; a failure is retried by the queue. Returns
// the message id, or null when the person doesn't get this kind of text.
export async function queueText(
  userId: string,
  kind: TextKind,
  body: string,
  { client = defaultClient, now = new Date(), plan, send = sendText }: QueueOptions = {},
): Promise<string | null> {
  if (messagingMode() === "off") return null;
  const [setting, user] = await Promise.all([
    settingFor(userId, client),
    timezoneOf(userId, client),
  ]);
  if (!user || !mayText(setting, kind)) return null;
  const sendAfter = ANY_HOUR.includes(kind) ? now : sendTime(now, user.timezone);
  const message = await scopedFor(userId, client).textMessages.create({
    data: {
      userId,
      direction: "outbound",
      kind,
      body: fitText(body),
      status: "queued",
      sendAfter,
      ...(plan
        ? {
            items: plan.items as unknown as Prisma.InputJsonArray,
            weekStart: plan.weekStart,
            expiresAt: plan.expiresAt,
          }
        : {}),
    },
    select: { id: true },
  });
  const jobId = await enqueueJob(
    "text_send",
    { userId, messageId: message.id },
    { client, now, runAt: sendAfter },
  );
  if (sendAfter.getTime() <= now.getTime()) {
    // Sent now, with this client; a failure stays queued for a retry.
    const handlers = { text_send: () => deliverText(userId, message.id, { client, now, send }) };
    await runJob(jobId, { client, now, handlers });
  }
  return message.id;
}

// The text_send job: sends one queued text, if the person still wants it. Turning texts
// off (or STOP) stops anything still queued. In quiet hours it waits until morning again,
// since the queue may run at night.
export async function deliverText(
  userId: string,
  messageId: string,
  {
    client = defaultClient,
    now = new Date(),
    send = sendText,
  }: Options & { send?: typeof sendText } = {},
): Promise<"sent" | "skipped" | "waiting"> {
  const db = scopedFor(userId, client);
  const message = await db.textMessages.findFirst({
    where: { id: messageId, direction: "outbound" },
    select: { id: true, kind: true, body: true, status: true },
  });
  if (!message || message.status !== "queued") return "skipped";
  const kind = message.kind as TextKind;
  const [setting, user] = await Promise.all([
    db.textSettings.findFirst({ select: { ...SETTING_SELECT, phoneEncrypted: true } }),
    timezoneOf(userId, client),
  ]);
  if (!user || !setting || !mayText(setting, kind)) {
    await db.textMessages.updateMany({ where: { id: message.id }, data: { status: "skipped" } });
    return "skipped";
  }
  if (!ANY_HOUR.includes(kind) && inQuietHours(now, user.timezone)) {
    const sendAfter = sendTime(now, user.timezone);
    await db.textMessages.updateMany({ where: { id: message.id }, data: { sendAfter } });
    await enqueueJob("text_send", { userId, messageId }, { client, now, runAt: sendAfter });
    return "waiting";
  }
  try {
    const sent = await send(decrypt(setting.phoneEncrypted), message.body);
    await db.textMessages.updateMany({
      where: { id: message.id },
      data: { status: sent.status, providerId: sent.providerId, sentAt: now, lastError: null },
    });
  } catch (error) {
    await db.textMessages.updateMany({
      where: { id: message.id },
      data: { lastError: scrub(String(error)).slice(0, TEXT_ERROR_LENGTH) },
    });
    throw error;
  }
  await track(userId, "text_sent", { kind });
  return "sent";
}

// --- The number and consent (/settings) ---

export type TextSettingsView = {
  mode: MessagingMode;
  phone: string | null;
  verified: boolean;
  codePending: boolean;
  enabled: boolean;
  optedOut: boolean;
  alerts: boolean;
  weeklyPlan: boolean;
  needsYou: boolean;
};

export async function textSettingsFor(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<TextSettingsView> {
  const row = await scopedFor(userId, client).textSettings.findFirst({
    select: { ...SETTING_SELECT, phoneEncrypted: true, codeHash: true, codeExpiresAt: true },
  });
  let phone: string | null = null;
  if (row) {
    try {
      phone = maskPhone(decrypt(row.phoneEncrypted));
    } catch {
      phone = "(•••) •••-••••";
    }
  }
  return {
    mode: messagingMode(),
    phone,
    verified: Boolean(row?.verifiedAt),
    codePending: Boolean(row?.codeHash && row.codeExpiresAt && row.codeExpiresAt > now),
    enabled: row?.enabled ?? true,
    optedOut: Boolean(row?.optedOutAt),
    alerts: row?.alerts ?? true,
    weeklyPlan: row?.weeklyPlan ?? true,
    needsYou: row?.needsYou ?? true,
  };
}

// Saves the number with the person's consent and texts it a code. The code is sent
// straight away (it's what they asked for) and never stored, only its keyed hash.
export async function startVerification(
  userId: string,
  input: { phone: string; consent: boolean },
  {
    client = defaultClient,
    now = new Date(),
    send = sendText,
  }: Options & { send?: typeof sendText } = {},
): Promise<{ phone: string }> {
  if (messagingMode() === "off") throw new TextError("Texts aren't available yet.");
  if (!input.consent) throw new TextError("Tick the box to agree to texts from Jane.");
  const phone = normalizeUsPhone(input.phone);
  if (!phone) throw new TextError("Enter a US mobile number, like (415) 555-0123.");
  if (!(await hit("textCodes", userId, { client, now })).ok) {
    throw new TextError("That's a lot of codes. Try again in an hour.");
  }
  const code = newCode();
  const data = {
    phoneEncrypted: encrypt(phone),
    phoneHmac: phoneHmac(phone),
    consentAt: now,
    consentVersion: TEXT_CONSENT_VERSION,
    verifiedAt: null,
    codeHash: hashCode(userId, code),
    codeExpiresAt: new Date(now.getTime() + TEXT_CODE_MINUTES * MINUTE),
    codeTries: 0,
    // Consent given again here: on, as asked.
    enabled: true,
    optedOutAt: null,
  };
  const db = scopedFor(userId, client);
  const existing = await db.textSettings.findFirst({ select: { id: true } });
  if (existing) await db.textSettings.updateMany({ where: { id: existing.id }, data });
  else await db.textSettings.create({ data: { userId, ...data } });

  const body = `Your Jane code is ${code}. It works for ${TEXT_CODE_MINUTES} minutes. If you didn't ask for it, ignore this text.`;
  // Kept without the code.
  const stored = body.replace(code, "••••••");
  try {
    const sent = await send(phone, body);
    await db.textMessages.create({
      data: {
        userId,
        direction: "outbound",
        kind: "code",
        body: stored,
        status: sent.status,
        providerId: sent.providerId,
        sentAt: now,
      },
    });
  } catch (error) {
    await db.textMessages.create({
      data: {
        userId,
        direction: "outbound",
        kind: "code",
        body: stored,
        status: "failed",
        lastError: scrub(String(error)).slice(0, TEXT_ERROR_LENGTH),
      },
    });
    console.error("Text code failed", { userId, error: scrub(String(error)) });
    throw new TextError("We couldn't text that number. Check it and try again.");
  }
  await track(userId, "text_code_sent", {});
  return { phone: maskPhone(phone) };
}

// The code from the text. Five tries, ten minutes; then a new code is needed.
export async function confirmVerification(
  userId: string,
  code: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  const row = await db.textSettings.findFirst({
    select: { id: true, codeHash: true, codeExpiresAt: true, codeTries: true, phoneHmac: true },
  });
  if (!row?.codeHash || !row.codeExpiresAt) throw new TextError("Send yourself a code first.");
  if (row.codeExpiresAt <= now) throw new TextError("That code expired. Send a new one.");
  // Count the try first, so tries at once can't get past the limit.
  const counted = await db.textSettings.updateMany({
    where: { id: row.id, codeTries: { lt: TEXT_CODE_MAX_TRIES } },
    data: { codeTries: { increment: 1 } },
  });
  if (counted.count === 0) throw new TextError("Too many wrong tries. Send a new code.");
  if (!codeMatches(userId, code, row.codeHash)) {
    const left = TEXT_CODE_MAX_TRIES - row.codeTries - 1;
    throw new TextError(
      left > 0
        ? `That code isn't right. ${left} ${plural(left, "try", "tries")} left.`
        : "That code isn't right. Send a new code.",
    );
  }
  // A number belongs to one account, so an inbound text finds one person. A system lookup
  // by the number's keyed hash.
  const taken = await client.textSetting.findFirst({
    where: { phoneHmac: row.phoneHmac, verifiedAt: { not: null }, userId: { not: userId } },
    select: { id: true },
  });
  if (taken) throw new TextError("That number is already used on another Jane account.");
  await db.textSettings.updateMany({
    where: { id: row.id },
    data: { verifiedAt: now, codeHash: null, codeExpiresAt: null, codeTries: 0 },
  });
  await logAudit({ type: "user", id: userId }, "text_number_verified", {
    type: "user",
    id: userId,
  });
  await track(userId, "text_verified", {});
  await queueText(
    userId,
    "welcome",
    "Jane here: texts are on. You'll get urgent alerts, your weekly plan and things that need you. Reply HELP for help, STOP to stop.",
    { client, now },
  );
}

export type TextPrefs = {
  enabled: boolean;
  alerts: boolean;
  weeklyPlan: boolean;
  needsYou: boolean;
};

export async function saveTextPrefs(
  userId: string,
  prefs: TextPrefs,
  { client = defaultClient }: Pick<Options, "client"> = {},
): Promise<void> {
  const db = scopedFor(userId, client);
  const row = await db.textSettings.findFirst({
    select: { id: true, verifiedAt: true, enabled: true, optedOutAt: true },
  });
  if (!row?.verifiedAt) throw new TextError("Add and verify your number first.");
  if (prefs.enabled && row.optedOutAt) {
    throw new TextError(
      "You replied STOP, so texts are off. Text START to Jane to turn them back on.",
    );
  }
  await db.textSettings.updateMany({ where: { id: row.id }, data: prefs });
  if (row.enabled && !prefs.enabled) {
    await logAudit(
      { type: "user", id: userId },
      "text_opt_out",
      { type: "user", id: userId },
      { via: "settings" },
    );
    await track(userId, "text_opt_out", { via: "settings" });
  } else if (!row.enabled && prefs.enabled) {
    await logAudit(
      { type: "user", id: userId },
      "text_opt_in",
      { type: "user", id: userId },
      { via: "settings" },
    );
    await track(userId, "text_opt_in", { via: "settings" });
  }
}

// Forgets the number. Anything queued is skipped (deliverText finds no number).
export async function removeTextNumber(
  userId: string,
  { client = defaultClient }: Pick<Options, "client"> = {},
): Promise<void> {
  const { count } = await scopedFor(userId, client).textSettings.deleteMany({});
  if (count === 0) return;
  await logAudit({ type: "user", id: userId }, "text_number_removed", {
    type: "user",
    id: userId,
  });
  await track(userId, "text_number_removed", {});
}

// --- What gets texted ---

// An urgent alert. True when it was queued (it then counts toward the daily cap, like an
// email). Quiet hours hold it until morning.
export async function textAlert(
  userId: string,
  alert: { type: AlertType; title: string },
  options: Options = {},
): Promise<boolean> {
  const label = ALERT_LABELS[alert.type].label;
  const body = `Jane: ${label}: ${alert.title}. Details: ${appBase()}/alerts`;
  return (await queueText(userId, "alert", body, options)) !== null;
}

// When an action needs the person: one line and a link to /actions.
export async function textNeedsYou(
  userId: string,
  title: string,
  options: Options = {},
): Promise<boolean> {
  const body = `Jane needs you for "${title}". See what to do: ${appBase()}/actions`;
  return (await queueText(userId, "needs_you", body, options)) !== null;
}

const shortTitle = (title: string) =>
  title.length <= TEXT_PLAN_TITLE_LENGTH ? title : `${title.slice(0, TEXT_PLAN_TITLE_LENGTH - 1)}…`;

export function planTextBody(items: { title: string }[]): string {
  const lines = items.map((item, i) => `${i + 1}) ${shortTitle(item.title)}`);
  const answer =
    items.length === 1
      ? "Reply YES to go ahead, or NO."
      : `Reply YES for all, the numbers you want (e.g. ${items.length >= 3 ? "1 3" : "2"}), or NO.`;
  return ["Jane's plan this week:", ...lines, answer].join("\n");
}

// This week's plan text for one person: only the items a one-tap link may approve
// (noRiskItems), at most TEXT_PLAN_MAX_ITEMS, numbered. Once a week, kept like a plan link.
export async function sendPlanText(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<"sent" | "none" | "already" | "off"> {
  const [setting, user] = await Promise.all([
    settingFor(userId, client),
    timezoneOf(userId, client),
  ]);
  if (!user || !mayText(setting, "plan")) return "off";
  const week = weekStart(now, user.timezone);
  const db = scopedFor(userId, client);
  if (await db.textMessages.findFirst({ where: { weekStart: week }, select: { id: true } })) {
    return "already";
  }
  const items = (await noRiskItems(userId, { client })).slice(0, TEXT_PLAN_MAX_ITEMS);
  if (items.length === 0) return "none";
  try {
    const id = await queueText(userId, "plan", planTextBody(items), {
      client,
      now,
      plan: { items, weekStart: week, expiresAt: new Date(now.getTime() + TEXT_PLAN_DAYS * DAY) },
    });
    if (!id) return "off";
  } catch (error) {
    // Another run got there first.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return "already";
    }
    throw error;
  }
  await track(userId, "text_plan_sent", { items: items.length });
  return "sent";
}

// Daily, with the weekly email: each person with plan texts on gets one in their week.
export async function runPlanTexts({ client = defaultClient, now = new Date() }: Options = {}) {
  const run = { sent: 0, none: 0, already: 0, off: 0, failed: 0 };
  if (messagingMode() === "off") return run;
  // A system read of who has verified texts on; each person is then read through scopedFor.
  const people = await client.textSetting.findMany({
    where: {
      verifiedAt: { not: null },
      enabled: true,
      optedOutAt: null,
      weeklyPlan: true,
      user: { deletedAt: null },
    },
    select: { userId: true },
    orderBy: { userId: "asc" },
  });
  for (const { userId } of people) {
    try {
      run[await sendPlanText(userId, { client, now })] += 1;
    } catch (error) {
      console.error("Plan text failed", { userId, error: scrub(String(error)) });
      run.failed += 1;
    }
  }
  return run;
}
