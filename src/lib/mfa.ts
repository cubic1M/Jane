import type { PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { decrypt, encrypt } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { hit } from "@/lib/rate-limit";
import { generateSecret, otpauthUri, verifyTotp } from "@/lib/totp";

// Two-factor for admins. The first time, an admin gets a secret to add to an authenticator
// app; every session after that needs a current code before /admin opens.

type Options = { client?: PrismaClient; now?: Date };

export type Enrollment = { enrolled: true } | { enrolled: false; secret: string; uri: string };

// For an admin without two-factor yet, a secret to add (kept until the first code works).
export async function enrollment(
  userId: string,
  email: string,
  { client = defaultClient }: Options = {},
): Promise<Enrollment> {
  const user = await client.user.findUniqueOrThrow({
    where: { id: userId },
    select: { mfaSecretEncrypted: true, mfaEnabledAt: true },
  });
  if (user.mfaEnabledAt) return { enrolled: true };
  let secret = user.mfaSecretEncrypted ? decrypt(user.mfaSecretEncrypted) : null;
  if (!secret) {
    secret = generateSecret();
    await client.user.update({
      where: { id: userId },
      data: { mfaSecretEncrypted: encrypt(secret) },
    });
  }
  return { enrolled: false, secret, uri: otpauthUri(email, secret) };
}

export type VerifyResult = "ok" | "wrong_code" | "too_many_attempts" | "not_enrolled";

// Checks a code and, if right, marks this session as verified (and finishes enrolment).
export async function verifyAdminCode(
  userId: string,
  sessionToken: string,
  code: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<VerifyResult> {
  if (!(await hit("mfa", userId, { client, now })).ok) return "too_many_attempts";
  const user = await client.user.findUniqueOrThrow({
    where: { id: userId },
    select: { role: true, mfaSecretEncrypted: true, mfaEnabledAt: true },
  });
  if (user.role !== "admin" || !user.mfaSecretEncrypted) return "not_enrolled";

  const actor = { type: "admin" as const, id: userId };
  if (!verifyTotp(decrypt(user.mfaSecretEncrypted), code, now)) {
    await logAudit(actor, "admin_mfa_failed", { type: "user", id: userId });
    return "wrong_code";
  }
  if (!user.mfaEnabledAt) {
    await client.user.update({ where: { id: userId }, data: { mfaEnabledAt: now } });
    await logAudit(actor, "admin_mfa_enrolled", { type: "user", id: userId });
  }
  await client.session.updateMany({
    where: { sessionToken, userId },
    data: { mfaVerifiedAt: now },
  });
  await logAudit(actor, "admin_mfa_verified", { type: "user", id: userId });
  return "ok";
}
