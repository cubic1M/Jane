import type { PrismaClient } from "@/generated/prisma/client";
import { logAudit, type AuditEvent } from "@/lib/audit";
import { generateBackupCodes, hashBackupCode, looksLikeBackupCode } from "@/lib/backup-codes";
import { decrypt, encrypt } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { hit } from "@/lib/rate-limit";
import { generateSecret, otpauthUri, verifyTotp } from "@/lib/totp";

// Two-factor sign-in with an authenticator app. Admins must have it before /admin opens;
// anyone else can turn it on from /settings. Once it's on, every new session needs a
// code (or a backup code) before the app opens.

type Options = { client?: PrismaClient; now?: Date };

export type Enrollment = { enrolled: true } | { enrolled: false; secret: string; uri: string };

// For someone without two-factor yet, a secret to add (kept until the first code works).
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

// The first code turns two-factor on and makes backup codes, shown once.
export type VerifyOutcome = { result: VerifyResult; backupCodes?: string[] };

type MfaUser = {
  role: "user" | "admin";
  mfaSecretEncrypted: string | null;
  mfaEnabledAt: Date | null;
};

const actorFor = (userId: string, user: Pick<MfaUser, "role">) => ({
  type: user.role === "admin" ? ("admin" as const) : ("user" as const),
  id: userId,
});

// Admins keep their original event names.
const eventFor = (user: Pick<MfaUser, "role">, step: "enrolled" | "verified" | "failed") =>
  (user.role === "admin"
    ? `admin_mfa_${step}`
    : step === "enrolled"
      ? "mfa_enabled"
      : `mfa_${step}`) as AuditEvent;

async function loadUser(userId: string, client: PrismaClient): Promise<MfaUser> {
  return client.user.findUniqueOrThrow({
    where: { id: userId },
    select: { role: true, mfaSecretEncrypted: true, mfaEnabledAt: true },
  });
}

// An authenticator code, or (once two-factor is on) an unused backup code, which is used up.
async function checkCode(
  userId: string,
  user: MfaUser,
  code: string,
  client: PrismaClient,
  now: Date,
): Promise<boolean> {
  if (!user.mfaSecretEncrypted) return false;
  if (verifyTotp(decrypt(user.mfaSecretEncrypted), code, now)) return true;
  if (!user.mfaEnabledAt || !looksLikeBackupCode(code)) return false;
  const { count } = await client.mfaBackupCode.updateMany({
    where: { userId, codeHash: hashBackupCode(code), usedAt: null },
    data: { usedAt: now },
  });
  if (count === 0) return false;
  await logAudit(actorFor(userId, user), "mfa_backup_code_used", { type: "user", id: userId });
  return true;
}

// Replaces any backup codes with new ones and returns them (to show once).
async function replaceBackupCodes(
  userId: string,
  user: Pick<MfaUser, "role">,
  client: PrismaClient,
): Promise<string[]> {
  const codes = generateBackupCodes();
  await client.$transaction([
    client.mfaBackupCode.deleteMany({ where: { userId } }),
    client.mfaBackupCode.createMany({
      data: codes.map((code) => ({ userId, codeHash: hashBackupCode(code) })),
    }),
  ]);
  await logAudit(actorFor(userId, user), "mfa_backup_codes_created", { type: "user", id: userId });
  return codes;
}

// Checks a code and, if right, marks this session as verified. The first right code
// finishes setting up two-factor and returns backup codes.
export async function verifySessionCode(
  userId: string,
  sessionToken: string,
  code: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<VerifyOutcome> {
  if (!(await hit("mfa", userId, { client, now })).ok) return { result: "too_many_attempts" };
  const user = await loadUser(userId, client);
  if (!user.mfaSecretEncrypted) return { result: "not_enrolled" };

  const actor = actorFor(userId, user);
  const target = { type: "user", id: userId };
  if (!(await checkCode(userId, user, code, client, now))) {
    await logAudit(actor, eventFor(user, "failed"), target);
    return { result: "wrong_code" };
  }
  let backupCodes: string[] | undefined;
  if (!user.mfaEnabledAt) {
    await client.user.update({ where: { id: userId }, data: { mfaEnabledAt: now } });
    await logAudit(actor, eventFor(user, "enrolled"), target);
    backupCodes = await replaceBackupCodes(userId, user, client);
  }
  await client.session.updateMany({
    where: { sessionToken, userId },
    data: { mfaVerifiedAt: now },
  });
  await logAudit(actor, eventFor(user, "verified"), target);
  return { result: "ok", backupCodes };
}

export type ChangeResult = "ok" | "wrong_code" | "too_many_attempts" | "not_enabled" | "admin";

// Turning two-factor off needs a current code. Admins can't: the team pages require it.
export async function turnOffTwoFactor(
  userId: string,
  code: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ChangeResult> {
  if (!(await hit("mfa", userId, { client, now })).ok) return "too_many_attempts";
  const user = await loadUser(userId, client);
  if (user.role === "admin") return "admin";
  if (!user.mfaEnabledAt) return "not_enabled";
  if (!(await checkCode(userId, user, code, client, now))) {
    await logAudit(actorFor(userId, user), "mfa_failed", { type: "user", id: userId });
    return "wrong_code";
  }
  await client.$transaction([
    client.mfaBackupCode.deleteMany({ where: { userId } }),
    client.user.update({
      where: { id: userId },
      data: { mfaSecretEncrypted: null, mfaEnabledAt: null },
    }),
  ]);
  await logAudit(actorFor(userId, user), "mfa_disabled", { type: "user", id: userId });
  return "ok";
}

// New backup codes (the old ones stop working), with a current code.
export async function newBackupCodes(
  userId: string,
  code: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<{ result: Exclude<ChangeResult, "admin">; codes?: string[] }> {
  if (!(await hit("mfa", userId, { client, now })).ok) return { result: "too_many_attempts" };
  const user = await loadUser(userId, client);
  if (!user.mfaEnabledAt) return { result: "not_enabled" };
  if (!(await checkCode(userId, user, code, client, now))) {
    await logAudit(actorFor(userId, user), eventFor(user, "failed"), {
      type: "user",
      id: userId,
    });
    return { result: "wrong_code" };
  }
  return { result: "ok", codes: await replaceBackupCodes(userId, user, client) };
}

export type TwoFactorStatus = { enabledAt: Date | null; backupCodesLeft: number };

export async function twoFactorStatus(
  userId: string,
  { client = defaultClient }: Options = {},
): Promise<TwoFactorStatus> {
  const [user, backupCodesLeft] = await Promise.all([
    client.user.findUniqueOrThrow({ where: { id: userId }, select: { mfaEnabledAt: true } }),
    client.mfaBackupCode.count({ where: { userId, usedAt: null } }),
  ]);
  return { enabledAt: user.mfaEnabledAt, backupCodesLeft };
}
