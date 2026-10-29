import { LINK_PREVIEW_AGENTS, SHARE_INVITE_MAX_USES, SHARE_INVITE_NOTE } from "@/config/share";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { generateCode, inviteStatus, normalizeCode } from "@/lib/invites";
import { cardFromRow, cardValue, type ShareCard } from "@/lib/share-card";
import { isTrialUser } from "@/lib/trial-ids";
import { TRIAL_ID_PREFIX } from "@/config/trial";

// A beta user's share link (the result card, src/lib/share-card.ts): their own invite code, so
// a friend can join the closed beta, and the funnel it feeds in analytics_events: invite_sent,
// invite_opened, invite_joined. Never for trial people, who can't share or invite.

type Options = { client?: PrismaClient };

// "ABCD-EFGH-JKMN" -> "/join/ABCD-EFGH-JKMN".
export const joinPath = (code: string) => `/join/${code}`;

export type ShareLink = { code: string; path: string; card: ShareCard };

// The person's share link, with the card it shows set to `card`. One code per person, made the
// first time they share. Null for trial people (sample data never shares or invites) and when
// the team revoked the person's code.
export async function shareLinkFor(
  userId: string,
  card: ShareCard,
  { client = defaultClient }: Options = {},
): Promise<ShareLink | null> {
  if (isTrialUser(userId)) return null;
  const data = { cardKind: card.kind, cardValue: cardValue(card) };
  const existing = await client.inviteCode.findUnique({
    where: { sharedById: userId },
    select: { id: true, code: true, revokedAt: true },
  });
  if (existing?.revokedAt) return null;
  if (existing) {
    await client.inviteCode.update({ where: { id: existing.id }, data });
    return { code: existing.code, path: joinPath(existing.code), card };
  }
  const created = await client.inviteCode.upsert({
    where: { sharedById: userId },
    create: {
      code: generateCode(),
      maxUses: SHARE_INVITE_MAX_USES,
      note: SHARE_INVITE_NOTE,
      createdById: userId,
      sharedById: userId,
      ...data,
    },
    update: data,
    select: { id: true, code: true },
  });
  await logAudit({ type: "user", id: userId }, "invite_code_created", {
    type: "invite_code",
    id: created.id,
  });
  return { code: created.code, path: joinPath(created.code), card };
}

export type ShareMethod = "share_sheet" | "copy";

// The person sent their link: the share sheet finished, or they copied it.
export async function recordInviteSent(
  userId: string,
  method: ShareMethod,
  { client = defaultClient }: Options = {},
): Promise<boolean> {
  if (isTrialUser(userId)) return false;
  const invite = await client.inviteCode.findUnique({
    where: { sharedById: userId },
    select: { id: true, cardKind: true },
  });
  if (!invite) return false;
  await track(userId, "invite_sent", {
    invite_id: invite.id,
    method,
    card: invite.cardKind,
  });
  return true;
}

export type InviteLanding = {
  inviteId: string;
  code: string;
  card: ShareCard | null;
  // Whether the code still lets someone in (not used up, expired or revoked).
  open: boolean;
};

// For the public invite page and its image: a share code's card and whether it still works. A
// lookup across everyone, by design: the link is the permission. Only share codes, so the
// team's own codes never get a public page.
export async function inviteLanding(
  input: string,
  { client = defaultClient, now = new Date() }: Options & { now?: Date } = {},
): Promise<InviteLanding | null> {
  const code = normalizeCode(input);
  if (!code) return null;
  const invite = await client.inviteCode.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      sharedById: true,
      cardKind: true,
      cardValue: true,
      uses: true,
      maxUses: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  if (!invite?.sharedById) return null;
  return {
    inviteId: invite.id,
    code: invite.code,
    card: invite.revokedAt ? null : cardFromRow(invite.cardKind, invite.cardValue),
    open: inviteStatus(invite, now) === "active",
  };
}

export const isLinkPreview = (userAgent: string | null) =>
  !userAgent || LINK_PREVIEW_AGENTS.test(userAgent);

// A friend opened the invite page. Link previewers drawing the card don't count.
export async function recordInviteOpened(
  inviteId: string,
  userAgent: string | null,
): Promise<boolean> {
  if (isLinkPreview(userAgent)) return false;
  await track(null, "invite_opened", { invite_id: inviteId });
  return true;
}

// A new account was made with a share code (from auth-events.ts once the account exists).
export async function recordInviteJoined(
  userId: string,
  email: string,
  { client = defaultClient }: Options = {},
): Promise<boolean> {
  if (isTrialUser(userId)) return false;
  const access = await client.betaAccess.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { inviteCode: { select: { id: true, sharedById: true } } },
  });
  const invite = access?.inviteCode;
  if (!invite?.sharedById || isTrialUser(invite.sharedById)) return false;
  await track(userId, "invite_joined", { invite_id: invite.id, sharer_id: invite.sharedById });
  return true;
}

export type InviteFunnel = { sent: number; opened: number; joined: number };

// All time, for /admin/metrics. Trial people never write these events (track() skips them),
// and the query leaves their ids out too.
export async function inviteFunnel({
  client = defaultClient,
}: Options = {}): Promise<InviteFunnel> {
  const rows = await client.analyticsEvent.groupBy({
    by: ["name"],
    where: {
      name: { in: ["invite_sent", "invite_opened", "invite_joined"] },
      OR: [{ userId: null }, { userId: { not: { startsWith: TRIAL_ID_PREFIX } } }],
    },
    _count: { _all: true },
  });
  const count = (name: string) => rows.find((r) => r.name === name)?._count._all ?? 0;
  return {
    sent: count("invite_sent"),
    opened: count("invite_opened"),
    joined: count("invite_joined"),
  };
}
