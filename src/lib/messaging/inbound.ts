import { AGENT_HOLD_HOURS } from "@/config/agent";
import { TEXT_INBOUND_MAX_LENGTH } from "@/config/messaging";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { appBase } from "@/lib/digest/links";
import { approveItems, takeBackApprovals, type LinkItem } from "@/lib/plan-links";
import { parseReply, type TextIntent } from "./parse";
import { normalizeUsPhone, phoneHmac } from "./phone";
import { statusFromProvider } from "./provider";
import { queueText, type TextKind } from "./texts";

// Texts people send Jane (spec step 78), from Sendblue's webhook (or, outside production,
// the simulated phone on /settings/texts). Only a verified number's texts are read, and
// only the exact replies in parse.ts do anything: YES or numbers approve items of the
// latest open plan text, UNDO takes that back while it's allowed, STOP and START turn
// texts off and on, HELP explains. Each gets a short answer; nothing else is acted on.

type Options = { client?: PrismaClient; now?: Date };

export type InboundResult =
  "status" | "ignored" | "unknown_number" | "duplicate" | "texts_off" | TextIntent["kind"];

const str = (value: unknown) => (typeof value === "string" ? value : "");
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const HOLD_HOURS = AGENT_HOLD_HOURS.text ?? 1;

export const OTHER_REPLY = () =>
  `Reply YES, the numbers, or NO. Questions? Open the app: ${appBase()}/plan`;
export const HELP_REPLY = () =>
  `Jane texts you about your money: urgent alerts, your weekly plan and things that need you. Reply YES, the numbers you want or NO to a plan, UNDO to take a yes back, STOP to stop. Settings: ${appBase()}/settings#texts`;
export const STOP_REPLY =
  "You won't get any more texts from Jane. Reply START to turn them back on.";
export const START_REPLY = "Texts from Jane are back on. Reply HELP for help, STOP to stop.";

// A status update for a text Jane sent (Sendblue's "outbound" webhook). Never moves a
// text back from delivered or failed.
async function updateStatus(payload: Record<string, unknown>, client: PrismaClient) {
  const handle = str(payload.message_handle);
  const status = statusFromProvider(payload.status);
  if (!handle || !status) return;
  // A system lookup by the provider's id; the update then goes through scopedFor.
  const message = await client.textMessage.findUnique({
    where: { providerId: handle },
    select: { id: true, userId: true, direction: true },
  });
  if (!message || message.direction !== "outbound") return;
  await scopedFor(message.userId, client).textMessages.updateMany({
    where: {
      id: message.id,
      status: { in: status === "sent" ? ["queued"] : ["queued", "sent"] },
    },
    data: { status },
  });
}

export async function handleInboundText(
  payload: Record<string, unknown>,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<InboundResult> {
  if (payload.is_outbound === true) {
    await updateStatus(payload, client);
    return "status";
  }
  // Group chats aren't for Jane.
  if (str(payload.group_id)) return "ignored";
  const phone = normalizeUsPhone(str(payload.number) || str(payload.from_number));
  if (!phone) return "ignored";
  // A system lookup by the number's keyed hash: only a verified number counts.
  const owner = await client.textSetting.findFirst({
    where: { phoneHmac: phoneHmac(phone), verifiedAt: { not: null } },
    select: { userId: true, enabled: true, optedOutAt: true },
  });
  if (!owner) return "unknown_number";
  const userId = owner.userId;
  const db = scopedFor(userId, client);
  const content = str(payload.content).slice(0, TEXT_INBOUND_MAX_LENGTH);
  const intent = parseReply(content);

  // Delivery is at least once: the provider's id makes a repeat a no-op.
  try {
    await db.textMessages.create({
      data: {
        userId,
        direction: "inbound",
        kind: intent.kind,
        body: content,
        status: "received",
        providerId: str(payload.message_handle) || null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return "duplicate";
    }
    throw error;
  }
  await track(userId, "text_received", { intent: intent.kind });

  const reply = (kind: TextKind, body: string) => queueText(userId, kind, body, { client, now });

  if (intent.kind === "stop") {
    await db.textSettings.updateMany({
      where: { optedOutAt: null },
      data: { enabled: false, optedOutAt: now },
    });
    await logAudit(
      { type: "user", id: userId },
      "text_opt_out",
      { type: "user", id: userId },
      { via: "text" },
    );
    await track(userId, "text_opt_out", { via: "text" });
    await reply("opt_out", STOP_REPLY);
    return "stop";
  }
  if (intent.kind === "help") {
    await reply("help", HELP_REPLY());
    return "help";
  }
  if (intent.kind === "start") {
    const turnedOn = await db.textSettings.updateMany({
      where: { OR: [{ enabled: false }, { optedOutAt: { not: null } }] },
      data: { enabled: true, optedOutAt: null },
    });
    if (turnedOn.count > 0) {
      await logAudit(
        { type: "user", id: userId },
        "text_opt_in",
        { type: "user", id: userId },
        { via: "text" },
      );
      await track(userId, "text_opt_in", { via: "text" });
    }
    await reply("reply", START_REPLY);
    return "start";
  }
  // With texts off, Jane reads nothing else and says nothing.
  if (!owner.enabled || owner.optedOutAt) return "texts_off";

  if (intent.kind === "yes" || intent.kind === "numbers") {
    await reply("reply", await approveByText(userId, intent, { client, now }));
  } else if (intent.kind === "no") {
    await reply("reply", await declineByText(userId, { client, now }));
  } else if (intent.kind === "undo") {
    await reply("reply", await undoByText(userId, { client, now }));
  } else {
    await reply("reply", OTHER_REPLY());
  }
  return intent.kind;
}

// The newest plan text that can still be answered: sent, not expired, not answered.
async function openPlanText(userId: string, client: PrismaClient, now: Date) {
  return scopedFor(userId, client).textMessages.findFirst({
    where: {
      direction: "outbound",
      kind: "plan",
      status: { in: ["sent", "delivered"] },
      usedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, items: true },
  });
}

const NOTHING_WAITING = () =>
  `There's no plan waiting for an answer right now. Open the app: ${appBase()}/plan`;

// YES (all) or numbers: each item approved as its own decision, source "text", checked
// against its card. Works once per plan text; the agent waits AGENT_HOLD_HOURS.text so
// UNDO really works.
export async function approveByText(
  userId: string,
  intent: Extract<TextIntent, { kind: "yes" | "numbers" }>,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<string> {
  const plan = await openPlanText(userId, client, now);
  if (!plan) return NOTHING_WAITING();
  const items = (plan.items ?? []) as LinkItem[];
  if (intent.kind === "numbers" && intent.numbers.some((n) => n > items.length)) {
    return items.length === 1
      ? "Reply YES to go ahead, or NO."
      : `Reply with numbers from 1 to ${items.length}, YES for all, or NO.`;
  }
  const chosen = intent.kind === "yes" ? items : intent.numbers.map((n) => items[n - 1]);
  const db = scopedFor(userId, client);
  // Claim it first, so two replies can't both use it.
  const claimed = await db.textMessages.updateMany({
    where: { id: plan.id, usedAt: null },
    data: { usedAt: now },
  });
  if (claimed.count === 0) return NOTHING_WAITING();
  const { decisionIds, skipped } = await approveItems(userId, chosen, "text", { client });
  await db.textMessages.updateMany({ where: { id: plan.id }, data: { decisionIds } });
  await logAudit(
    { type: "user", id: userId },
    "text_approval",
    { type: "user", id: userId },
    { approved: decisionIds.length, skipped, chosen: chosen.length, offered: items.length },
  );
  await track(userId, "text_approval", {
    approved: decisionIds.length,
    skipped,
    all: intent.kind === "yes",
  });
  const n = decisionIds.length;
  if (n === 0) {
    return `Those changed or were already answered, so Jane did nothing. Open the app: ${appBase()}/plan`;
  }
  const changed = skipped > 0 ? ` ${skipped} had changed; see the app.` : "";
  return `Done: Jane will start on ${n} ${plural(n, "thing", "things")} in ${HOLD_HOURS === 1 ? "an hour" : `${HOLD_HOURS} hours`}. Reply UNDO to take ${plural(n, "it", "them")} back.${changed}`;
}

// NO: nothing is approved and the plan text is closed. The items stay on the plan.
export async function declineByText(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<string> {
  const plan = await openPlanText(userId, client, now);
  if (!plan) return NOTHING_WAITING();
  await scopedFor(userId, client).textMessages.updateMany({
    where: { id: plan.id, usedAt: null },
    data: { usedAt: now },
  });
  await track(userId, "text_declined", {});
  return `OK, Jane won't do these. They stay on your plan: ${appBase()}/plan`;
}

// UNDO: takes back the last text approval, while the hold lasts and the work hasn't
// started.
export async function undoByText(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<string> {
  const db = scopedFor(userId, client);
  const last = await db.textMessages.findFirst({
    where: { direction: "outbound", kind: "plan", usedAt: { not: null } },
    orderBy: { usedAt: "desc" },
    select: { decisionIds: true },
  });
  const live = last?.decisionIds.length
    ? await db.decisions.count({ where: { id: { in: last.decisionIds }, undoneAt: null } })
    : 0;
  if (!last || live === 0) return "There's nothing to take back.";
  const undone = await takeBackApprovals(userId, last.decisionIds, "text", { client, now });
  await track(userId, "text_undo", { undone });
  if (undone === 0) return "It can't be taken back anymore: Jane has started.";
  return `Taken back: ${undone} ${plural(undone, "thing", "things")}. ${plural(undone, "It's", "They're")} back on your plan.`;
}
