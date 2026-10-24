import { createHash, randomBytes } from "node:crypto";
import { CHAT_LINK_HOURS } from "@/config/chat-notify";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { appBase } from "@/lib/digest/links";
import { ACTION_HANDLERS, ChatActionError, takeChatAction } from "./actions";
import {
  MESSAGE_SELECT,
  toChatMessage,
  type ActionId,
  type ChatMessage,
  type MessageAction,
} from "./types";

// One-tap answers from Jane's emails (spec step 85), like the plan's one-tap links (spec
// step 60): a link per button on a message opens /chat/reply, a small page with the message
// and one button, so mail scanners that open links can't answer anything. Only the token's
// hash is stored; it works once, until it expires, for that person's own message and that
// button, and the answer goes through takeChatAction, the chat's own checks.

const HOUR_MS = 60 * 60 * 1000;

type Options = { client?: PrismaClient; now?: Date };

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

// A link for one button on one of the person's messages.
export async function createReplyLink(
  userId: string,
  messageId: string,
  actionId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await scopedFor(userId, client).chatReplyLinks.create({
    data: {
      userId,
      messageId,
      actionId,
      tokenHash: hashOf(token),
      expiresAt: new Date(now.getTime() + CHAT_LINK_HOURS * HOUR_MS),
    },
  });
  return `${appBase()}/chat/reply?${new URLSearchParams({ token })}`;
}

// A system lookup by the token's hash: the token is the credential.
async function findLink(token: string, client: PrismaClient) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  return client.chatReplyLink.findUnique({ where: { tokenHash: hashOf(token) } });
}

// The message, through the person's own scope, and the button if it still works on it:
// offered, and the message in the state that button works on (as takeChatAction checks).
async function messageFor(
  link: { userId: string; messageId: string; actionId: string },
  client: PrismaClient,
): Promise<{ message: ChatMessage; action: MessageAction | null } | null> {
  const row = await scopedFor(link.userId, client).janeMessages.findFirst({
    where: { id: link.messageId },
    select: MESSAGE_SELECT,
  });
  if (!row) return null;
  const message = toChatMessage(row);
  const handler = Object.hasOwn(ACTION_HANDLERS, link.actionId)
    ? ACTION_HANDLERS[link.actionId as ActionId]
    : undefined;
  const action = message.actions.find((a) => a.id === link.actionId && a.kind !== "link");
  return { message, action: action && handler?.on === message.status ? action : null };
}

export type ReplyLinkView =
  | { state: "invalid" }
  | { state: "expired" }
  | { state: "wrong_user" }
  // What this link did, so the page shows the outcome when it reloads after the tap.
  | { state: "used"; messageId: string; answeredWith: string | null; note: string | null }
  | { state: "answered"; messageId: string; answeredWith: string | null }
  | { state: "ready"; messageId: string; body: string; label: string };

// What the confirm page shows. Opening it changes nothing; only its button does. When
// someone is signed in, the link must be theirs.
export async function viewReplyLink(
  token: string,
  {
    client = defaultClient,
    now = new Date(),
    signedInAs = null,
  }: Options & { signedInAs?: string | null } = {},
): Promise<ReplyLinkView> {
  const link = await findLink(token, client);
  if (!link) return { state: "invalid" };
  if (signedInAs && signedInAs !== link.userId) return { state: "wrong_user" };
  if (link.usedAt) {
    const found = await messageFor(link, client);
    return {
      state: "used",
      messageId: link.messageId,
      answeredWith: found?.message.answeredWith ?? null,
      note: found?.message.refs.note ?? null,
    };
  }
  if (link.expiresAt <= now) return { state: "expired" };
  const found = await messageFor(link, client);
  if (!found) return { state: "invalid" };
  if (!found.action) {
    return {
      state: "answered",
      messageId: link.messageId,
      answeredWith: found.message.answeredWith,
    };
  }
  return {
    state: "ready",
    messageId: link.messageId,
    body: found.message.body,
    label: found.action.label,
  };
}

export class ReplyLinkError extends Error {}

// The confirm button. The link is claimed first, so two taps can't both use it; then the
// button is taken exactly as in the chat. A ChatActionError (answered meanwhile, too late
// to undo) passes through to the caller, and the link stays used.
export async function redeemReplyLink(
  token: string,
  {
    client = defaultClient,
    now = new Date(),
    signedInAs = null,
  }: Options & { signedInAs?: string | null } = {},
) {
  const link = await findLink(token, client);
  if (!link) throw new ReplyLinkError("This link doesn't work.");
  if (signedInAs && signedInAs !== link.userId) {
    throw new ReplyLinkError("This link is for a different account.");
  }
  if (link.expiresAt <= now) throw new ReplyLinkError("This link has expired.");
  const claimed = await client.chatReplyLink.updateMany({
    where: { id: link.id, usedAt: null },
    data: { usedAt: now },
  });
  if (claimed.count === 0) throw new ReplyLinkError("This link was already used.");

  let result: Awaited<ReturnType<typeof takeChatAction>>;
  try {
    result = await takeChatAction(link.userId, link.messageId, link.actionId, { client, now });
  } catch (error) {
    // Something broke on our side: the link works again, so the person can retry.
    if (!(error instanceof ChatActionError)) {
      await client.chatReplyLink.updateMany({ where: { id: link.id }, data: { usedAt: null } });
    }
    throw error;
  }
  await track(link.userId, "chat_notification_answered", {
    channel: "email",
    action: link.actionId,
    kind: result.message.kind,
  });
  return { ...result, userId: link.userId };
}
