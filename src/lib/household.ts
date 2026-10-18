import { createHash, randomBytes } from "node:crypto";
import { HOUSEHOLD_INVITE_DAYS, HOUSEHOLD_MAX_MEMBERS } from "@/config/household";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";

// Inviting a partner, joining, leaving, and choosing which accounts to share. What a
// partner can then read is in sharedReadFor (src/lib/db-scoped.ts).

type Options = { client?: PrismaClient; now?: Date };

const DAY_MS = 24 * 60 * 60 * 1000;

export class HouseholdError extends Error {}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function householdOf(userId: string, { client = defaultClient }: Options = {}) {
  const membership = await client.householdMember.findUnique({
    where: { userId },
    select: {
      household: {
        select: {
          id: true,
          members: {
            select: { userId: true, joinedAt: true, user: { select: { email: true } } },
            orderBy: { joinedAt: "asc" },
          },
          invites: {
            where: { acceptedAt: null },
            select: { id: true, email: true, expiresAt: true },
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });
  return membership?.household ?? null;
}

// Invites a partner by email, starting a household if the person isn't in one. Returns the
// link's token: it's shown once (and emailed), and only its hash is stored.
export async function invitePartner(
  user: { id: string; email: string },
  email: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ token: string }> {
  const invited = normalizeEmail(email);
  if (!/^\S+@\S+\.\S+$/.test(invited)) throw new HouseholdError("Enter your partner's email.");
  if (invited === normalizeEmail(user.email)) throw new HouseholdError("That's your own email.");

  const token = randomBytes(32).toString("base64url");
  await client.$transaction(async (tx) => {
    let membership = await tx.householdMember.findUnique({
      where: { userId: user.id },
      select: { householdId: true },
    });
    if (!membership) {
      const household = await tx.household.create({ select: { id: true } });
      membership = await tx.householdMember.create({
        data: { householdId: household.id, userId: user.id },
        select: { householdId: true },
      });
    }
    const members = await tx.householdMember.count({
      where: { householdId: membership.householdId },
    });
    if (members >= HOUSEHOLD_MAX_MEMBERS) {
      throw new HouseholdError("Your household is full.");
    }
    // A new invite replaces any earlier one that wasn't accepted.
    await tx.householdInvite.deleteMany({
      where: { householdId: membership.householdId, acceptedAt: null },
    });
    await tx.householdInvite.create({
      data: {
        householdId: membership.householdId,
        userId: user.id,
        email: invited,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + HOUSEHOLD_INVITE_DAYS * DAY_MS),
      },
    });
  });
  await logAudit({ type: "user", id: user.id }, "household_invite_sent", null, {});
  await track(user.id, "household_invite_sent", {});
  return { token };
}

// Joins the household the token invites to. Only the invited email can accept, so a
// forwarded link is useless to anyone else.
export async function acceptInvite(
  user: { id: string; email: string },
  token: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<void> {
  const householdId = await client.$transaction(async (tx) => {
    const invite = await tx.householdInvite.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, householdId: true, email: true, expiresAt: true, acceptedAt: true },
    });
    if (!invite || invite.acceptedAt || invite.expiresAt <= now) {
      throw new HouseholdError("This invite link has expired or was already used.");
    }
    if (invite.email !== normalizeEmail(user.email)) {
      throw new HouseholdError(`This invite is for ${invite.email}. Sign in with that email.`);
    }
    if (await tx.householdMember.findUnique({ where: { userId: user.id } })) {
      throw new HouseholdError("You're already in a household. Leave it first.");
    }
    const members = await tx.householdMember.count({ where: { householdId: invite.householdId } });
    if (members >= HOUSEHOLD_MAX_MEMBERS) throw new HouseholdError("That household is full.");
    // Claims the invite, so it works once.
    const { count } = await tx.householdInvite.updateMany({
      where: { id: invite.id, acceptedAt: null },
      data: { acceptedAt: now },
    });
    if (count === 0) throw new HouseholdError("This invite link was already used.");
    await tx.householdMember.create({ data: { householdId: invite.householdId, userId: user.id } });
    return invite.householdId;
  });
  await logAudit(
    { type: "user", id: user.id },
    "household_joined",
    {
      type: "household",
      id: householdId,
    },
    {},
  );
  await track(user.id, "household_joined", {});
}

// Leaves the household. Access to the other person's shared accounts ends now, and theirs
// to yours. An empty household is deleted.
export async function leaveHousehold(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const left = await client.householdMember.findUnique({
    where: { userId },
    select: { householdId: true },
  });
  if (!left) return;
  await client.$transaction(async (tx) => {
    // The shared balance ends with the pair; each person's own transactions stay.
    await tx.sharedCharge.deleteMany({ where: { householdId: left.householdId } });
    await tx.settlement.deleteMany({ where: { householdId: left.householdId } });
    await tx.householdMember.delete({ where: { userId } });
    if ((await tx.householdMember.count({ where: { householdId: left.householdId } })) === 0) {
      await tx.household.delete({ where: { id: left.householdId } });
    } else {
      await tx.householdInvite.deleteMany({
        where: { householdId: left.householdId, acceptedAt: null },
      });
    }
  });
  await logAudit(
    { type: "user", id: userId },
    "household_left",
    {
      type: "household",
      id: left.householdId,
    },
    {},
  );
  await track(userId, "household_left", {});
}

// Shares, or stops sharing, one of the person's own accounts.
export async function setAccountSharing(
  userId: string,
  accountId: string,
  shared: boolean,
  { client = defaultClient }: Options = {},
): Promise<boolean> {
  const { count } = await scopedFor(userId, client).accounts.updateMany({
    where: { id: accountId },
    data: { sharedWithHousehold: shared },
  });
  if (count > 0) {
    await logAudit(
      { type: "user", id: userId },
      "account_sharing_changed",
      {
        type: "account",
        id: accountId,
      },
      { shared },
    );
  }
  return count > 0;
}
