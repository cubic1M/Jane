import { randomInt } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit, SYSTEM_ACTOR } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";

// Invite codes keep the beta closed. Redeeming a code with an email puts that email on the
// beta list; Auth.js's signIn callback (src/lib/auth-gate.ts) only lets listed emails,
// existing users and ADMIN_EMAILS create accounts. BETA_INVITE_ONLY (on unless "false")
// is the switch; Try Jane's sample-data trials never need a code. A code can be locked to
// one email, and revoked; people without one can leave an email on the waitlist.

// No 0/O or 1/I/L, so codes read cleanly aloud and on paper.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// BETA_INVITE_ONLY, on by default: only "false" (or "0") opens sign-up to everyone.
export function invitesRequired(): boolean {
  const flag = process.env.BETA_INVITE_ONLY?.trim().toLowerCase();
  return flag !== "false" && flag !== "0";
}

export function generateCode(): string {
  const chars = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]);
  return [0, 4, 8].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

// "abcd efgh-jkmn" -> "ABCD-EFGH-JKMN", or null if it can't be a code.
export function normalizeCode(input: string): string | null {
  const chars = input.toUpperCase().replace(/[\s-]/g, "");
  if (chars.length !== 12 || [...chars].some((c) => !ALPHABET.includes(c))) return null;
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

export function isAdminEmail(email: string): boolean {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

export type CodeCheck = "ok" | "invalid" | "used_up" | "expired" | "revoked" | "wrong_email";

const lower = (email: string) => email.trim().toLowerCase();

type Options = { client?: PrismaClient; now?: Date };

// `email`: who is using it, when known (a Google sign-up only learns it afterwards, and the
// signIn callback checks it then).
export async function checkCode(
  input: string,
  { client = defaultClient, now = new Date(), email }: Options & { email?: string } = {},
): Promise<CodeCheck> {
  const code = normalizeCode(input);
  const invite = code
    ? await client.inviteCode.findUnique({
        where: { code },
        select: { maxUses: true, uses: true, expiresAt: true, revokedAt: true, email: true },
      })
    : null;
  if (!invite) return "invalid";
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt && invite.expiresAt <= now) return "expired";
  if (invite.email && email !== undefined && invite.email !== lower(email)) return "wrong_email";
  return invite.uses < invite.maxUses ? "ok" : "used_up";
}

// Uses one of the code's uses for this email, unless the email is already on the list.
export async function redeemInvite(
  input: string,
  email: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<CodeCheck> {
  const address = lower(email);
  if (await client.betaAccess.findUnique({ where: { email: address }, select: { id: true } })) {
    return "ok";
  }
  const check = await checkCode(input, { client, now, email: address });
  if (check !== "ok") return check;
  const code = normalizeCode(input) as string;
  let inviteId: string | undefined;
  const result = await client.$transaction(async (tx) => {
    const invite = await tx.inviteCode.findUniqueOrThrow({ where: { code }, select: { id: true } });
    inviteId = invite.id;
    // Only takes a use if one is left, even with two people redeeming at once.
    const taken = await tx.$executeRaw`
      UPDATE invite_codes SET uses = uses + 1 WHERE id = ${invite.id} AND uses < max_uses`;
    if (taken === 0) return "used_up" as const;
    await tx.betaAccess.create({ data: { email: address, inviteCodeId: invite.id } });
    return "ok" as const;
  });
  if (result === "ok") {
    // No account yet, so no user id: the code's id, never the email.
    await logAudit(SYSTEM_ACTOR, "invite_redeemed", { type: "invite_code", id: inviteId! });
    await track(null, "invite_redeemed", { invite_id: inviteId! });
  }
  return result;
}

// Whether this email may create an account now.
export async function mayCreateAccount(email: string, { client = defaultClient }: Options = {}) {
  if (!invitesRequired() || isAdminEmail(email)) return true;
  const address = lower(email);
  const [user, access] = await Promise.all([
    client.user.findUnique({ where: { email: address }, select: { id: true } }),
    client.betaAccess.findUnique({ where: { email: address }, select: { id: true } }),
  ]);
  return Boolean(user || access);
}

export async function createInviteCode(
  {
    maxUses,
    note,
    expiresAt,
    email = null,
    createdById = null,
  }: {
    maxUses: number;
    note: string | null;
    expiresAt: Date | null;
    email?: string | null;
    createdById?: string | null;
  },
  { client = defaultClient }: Options = {},
) {
  return client.inviteCode.create({
    data: {
      code: generateCode(),
      maxUses,
      note,
      expiresAt,
      email: email ? lower(email) : null,
      createdById,
    },
    select: { id: true, code: true },
  });
}

// Stops a code working; the accounts already made with it stay. Null: no such code, or
// already revoked.
export async function revokeInviteCode(
  code: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ id: string } | null> {
  const invite = await client.inviteCode.findUnique({
    where: { code },
    select: { id: true, revokedAt: true },
  });
  if (!invite || invite.revokedAt) return null;
  await client.inviteCode.update({ where: { id: invite.id }, data: { revokedAt: now } });
  return { id: invite.id };
}

// The waitlist: the email is stored and nothing is sent. True when it's new on the list.
export async function joinWaitlist(
  email: string,
  { client = defaultClient }: Options = {},
): Promise<boolean> {
  const address = lower(email);
  const before = await client.waitlistEntry.findUnique({
    where: { email: address },
    select: { id: true },
  });
  if (before) return false;
  await client.waitlistEntry.upsert({
    where: { email: address },
    create: { email: address },
    update: {},
  });
  return true;
}

export type InviteStatus = "active" | "revoked" | "expired" | "used_up";

export function inviteStatus(
  invite: { revokedAt: Date | null; expiresAt: Date | null; uses: number; maxUses: number },
  now = new Date(),
): InviteStatus {
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt && invite.expiresAt <= now) return "expired";
  return invite.uses < invite.maxUses ? "active" : "used_up";
}
