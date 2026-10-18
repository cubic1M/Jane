import { randomInt } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";

// Invite codes keep the beta closed. Redeeming a code with an email puts that email on the
// beta list; Auth.js's signIn callback (src/lib/auth-gate.ts) only lets listed emails,
// existing users and ADMIN_EMAILS create accounts. OPEN_SIGNUPS=true opens sign-up.

// No 0/O or 1/I/L, so codes read cleanly aloud and on paper.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function invitesRequired(): boolean {
  return process.env.OPEN_SIGNUPS !== "true";
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

export type CodeCheck = "ok" | "invalid" | "used_up" | "expired";

type Options = { client?: PrismaClient; now?: Date };

export async function checkCode(
  input: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<CodeCheck> {
  const code = normalizeCode(input);
  const invite = code
    ? await client.inviteCode.findUnique({
        where: { code },
        select: { maxUses: true, uses: true, expiresAt: true },
      })
    : null;
  if (!invite) return "invalid";
  if (invite.expiresAt && invite.expiresAt <= now) return "expired";
  return invite.uses < invite.maxUses ? "ok" : "used_up";
}

// Uses one of the code's uses for this email, unless the email is already on the list.
export async function redeemInvite(
  input: string,
  email: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<CodeCheck> {
  const address = email.trim().toLowerCase();
  if (await client.betaAccess.findUnique({ where: { email: address }, select: { id: true } })) {
    return "ok";
  }
  const check = await checkCode(input, { client, now });
  if (check !== "ok") return check;
  const code = normalizeCode(input) as string;
  return client.$transaction(async (tx) => {
    const invite = await tx.inviteCode.findUniqueOrThrow({ where: { code }, select: { id: true } });
    // Only takes a use if one is left, even with two people redeeming at once.
    const taken = await tx.$executeRaw`
      UPDATE invite_codes SET uses = uses + 1 WHERE id = ${invite.id} AND uses < max_uses`;
    if (taken === 0) return "used_up" as const;
    await tx.betaAccess.create({ data: { email: address, inviteCodeId: invite.id } });
    return "ok" as const;
  });
}

// Whether this email may create an account now.
export async function mayCreateAccount(email: string, { client = defaultClient }: Options = {}) {
  if (!invitesRequired() || isAdminEmail(email)) return true;
  const address = email.trim().toLowerCase();
  const [user, access] = await Promise.all([
    client.user.findUnique({ where: { email: address }, select: { id: true } }),
    client.betaAccess.findUnique({ where: { email: address }, select: { id: true } }),
  ]);
  return Boolean(user || access);
}

export async function createInviteCode(
  { maxUses, note, expiresAt }: { maxUses: number; note: string | null; expiresAt: Date | null },
  { client = defaultClient }: Options = {},
) {
  return client.inviteCode.create({
    data: { code: generateCode(), maxUses, note, expiresAt },
    select: { code: true },
  });
}
