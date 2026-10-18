import { createHash, randomBytes } from "node:crypto";
import { AGENT_HOLD_HOURS } from "@/config/agent";
import { NEVER_BY_RULE } from "@/config/rules";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { DecisionError, recordDecision } from "@/lib/decisions";
import { appBase } from "@/lib/digest/links";
import { planFor } from "@/lib/plan";
import { undoApproval } from "@/lib/standing-rules";

// One-tap approval links (spec step 60) for the weekly email and notifications. A link
// opens a small page with one button, so email scanners that open links can't approve
// anything. It covers only no-risk items (never calls, cancellations, money or insurance),
// works once, for a week, for that person and those items, and can then take them back
// for a short while.

export const PLAN_LINK_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const LINK_UNDO_HOURS = AGENT_HOLD_HOURS.link ?? 1;

type Options = { client?: PrismaClient; now?: Date };

type LinkItem = { findingId: string; cardHash: string; title: string };

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

// A link for this week's ticked, no-risk items, or null when there are none.
export async function createPlanLink(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ url: string; count: number } | null> {
  const items: LinkItem[] = (await planFor(userId, { client }))
    .filter((i) => i.preselected && !NEVER_BY_RULE.includes(i.card.actionType))
    .map((i) => ({ findingId: i.card.findingId, cardHash: i.cardHash, title: i.card.title }));
  if (items.length === 0) return null;
  const token = randomBytes(32).toString("base64url");
  await scopedFor(userId, client).planLinks.create({
    data: {
      userId,
      tokenHash: hashOf(token),
      items,
      expiresAt: new Date(now.getTime() + PLAN_LINK_DAYS * DAY_MS),
    },
  });
  return { url: `${appBase()}/plan/go?${new URLSearchParams({ token })}`, count: items.length };
}

export type LinkView =
  | { state: "invalid" }
  | { state: "expired" }
  | { state: "ready"; items: { title: string }[] }
  | { state: "used"; approved: number; usedAt: Date; canTakeBack: boolean };

// A system lookup by the token's hash: the token is the credential.
async function findLink(token: string, client: PrismaClient) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  return client.planLink.findUnique({ where: { tokenHash: hashOf(token) } });
}

export async function viewPlanLink(
  token: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<LinkView> {
  const link = await findLink(token, client);
  if (!link) return { state: "invalid" };
  if (link.usedAt) {
    // Still on: approved by the link and not taken back since.
    const approved = await client.decision.count({
      where: { id: { in: link.decisionIds }, userId: link.userId, undoneAt: null },
    });
    return {
      state: "used",
      approved,
      usedAt: link.usedAt,
      canTakeBack:
        approved > 0 && now.getTime() - link.usedAt.getTime() < LINK_UNDO_HOURS * 3_600_000,
    };
  }
  if (link.expiresAt <= now) return { state: "expired" };
  return { state: "ready", items: (link.items as LinkItem[]).map((i) => ({ title: i.title })) };
}

export class LinkError extends Error {}

// The one tap. Each item is approved as its own decision (source "link"), checked against
// the card as it was; an item that changed or was answered meanwhile is skipped.
export async function redeemLink(
  token: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ approved: number; skipped: number; userId: string }> {
  const link = await findLink(token, client);
  if (!link || link.expiresAt <= now) throw new LinkError("This link has expired.");
  // Claim it first, so two taps can't both use it.
  const claimed = await client.planLink.updateMany({
    where: { id: link.id, usedAt: null },
    data: { usedAt: now },
  });
  if (claimed.count === 0) throw new LinkError("This link was already used.");

  const decisionIds: string[] = [];
  let skipped = 0;
  for (const item of link.items as LinkItem[]) {
    try {
      const { decisionId } = await recordDecision(
        link.userId,
        { findingId: item.findingId, cardHash: item.cardHash, choice: "yes", source: "link" },
        { client },
      );
      decisionIds.push(decisionId);
    } catch (error) {
      if (!(error instanceof DecisionError)) throw error;
      skipped += 1;
    }
  }
  await client.planLink.update({ where: { id: link.id }, data: { decisionIds } });
  await logAudit(
    { type: "user", id: link.userId },
    "plan_link_used",
    { type: "user", id: link.userId },
    {
      approved: decisionIds.length,
      skipped,
    },
  );
  await track(link.userId, "plan_link_used", { approved: decisionIds.length, skipped });
  return { approved: decisionIds.length, skipped, userId: link.userId };
}

// "Take it back": undoes what the link approved, while the work hasn't started.
export async function takeBackLink(
  token: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const link = await findLink(token, client);
  if (!link?.usedAt) throw new LinkError("There's nothing to take back.");
  let undone = 0;
  for (const decisionId of link.decisionIds) {
    try {
      await undoApproval(link.userId, decisionId, "link", LINK_UNDO_HOURS, { client, now });
      undone += 1;
    } catch (error) {
      if (!(error instanceof DecisionError)) throw error;
    }
  }
  if (undone === 0) throw new LinkError("It can't be taken back anymore: Jane has started.");
  return undone;
}
