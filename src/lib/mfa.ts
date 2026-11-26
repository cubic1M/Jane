import type { PrismaClient } from "@/generated/prisma/client";
import { logAudit, type AuditEvent } from "@/lib/audit";
import {
  backupCodeHashes,
  generateBackupCodes,
  hashBackupCode,
  looksLikeBackupCode,
} from "@/lib/backup-codes";
import { decrypt, encrypt } from "@/lib/crypto";
import { db as defaultClient } from "@/lib/db";
import { firstUseInWindow, hit } from "@/lib/rate-limit";
import { personTransaction, scopedFor } from "@/lib/db-scoped";
import { systemDb, systemTransaction } from "@/lib/system-db";

const WHY = "A person's own row: jane_rls only reads users";
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
  const user = await scopedFor(userId, client).me.findUniqueOrThrow({
    where: { id: userId },
    select: { mfaSecretEncrypted: true, mfaEnabledAt: true },
  });
  if (user.mfaEnabledAt) return { enrolled: true };
  let secret = user.mfaSecretEncrypted ? decrypt(user.mfaSecretEncrypted) : null;
  if (!secret) {
    secret = generateSecret();
    // Only into an empty place: a second page asking at once, or one that read before two-factor was
    // finished, would otherwise replace the secret the person's app already holds.
    const { count } = await systemDb(WHY, client).user.updateMany({
      where: { id: userId, mfaSecretEncrypted: null, mfaEnabledAt: null },
      data: { mfaSecretEncrypted: encrypt(secret) },
    });
    if (count === 0) return enrollment(userId, email, { client });
  }
  return { enrolled: false, secret, uri: otpauthUri(email, secret) };
}

type VerifyResult = "ok" | "wrong_code" | "too_many_attempts" | "not_enrolled";

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
  return scopedFor(userId, client).me.findUniqueOrThrow({
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
  if (verifyTotp(decrypt(user.mfaSecretEncrypted), code, now)) {
    return firstUseInWindow("mfaCodeUsed", `${userId}:${code.replace(/\s/g, "")}`, { client, now });
  }
  if (!user.mfaEnabledAt || !looksLikeBackupCode(code)) return false;
  const { count } = await scopedFor(userId, client).mfaBackupCodes.updateMany({
    where: { userId, codeHash: { in: backupCodeHashes(code) }, usedAt: null },
    data: { usedAt: now },
  });
  if (count === 0) return false;
  await logAudit(actorFor(userId, user), "mfa_backup_code_used", { type: "user", id: userId });
  return true;
}

// A whole set is replaced inside one transaction, behind this lock: two replacements at once each
// cleared the old set before the other's was written, and both sets stayed usable.
const codesLock = (userId: string) => `mfa-codes:${userId}`;
const codeRows = (userId: string, codes: string[]) =>
  codes.map((code) => ({ userId, codeHash: hashBackupCode(code) }));

// Replaces any backup codes with new ones and returns them (to show once).
async function replaceBackupCodes(
  userId: string,
  user: Pick<MfaUser, "role">,
  client: PrismaClient,
): Promise<string[]> {
  const codes = generateBackupCodes();
  await personTransaction(
    userId,
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${codesLock(userId)}))`;
      await tx.mfaBackupCode.deleteMany({ where: { userId } });
      await tx.mfaBackupCode.createMany({ data: codeRows(userId, codes) });
    },
    client,
  );
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
  // Of two first codes at once, one turns it on: the other only verifies its session.
  if (!user.mfaEnabledAt) {
    const codes = generateBackupCodes();
    // One change: on, everyone else out and the backup codes written, or none of it, so a code
    // given after a failure does it all again. Whoever else is signed in is out because someone who
    // got into the account is what two-factor is for, and any session could have read the secret
    // before this first code.
    const turnedOn = await systemTransaction(
      "Starting two-factor signs out the person's other sessions",
      async (tx) => {
        const { count } = await tx.user.updateMany({
          where: { id: userId, mfaEnabledAt: null, mfaSecretEncrypted: user.mfaSecretEncrypted },
          data: { mfaEnabledAt: now },
        });
        if (count === 0) return false;
        await tx.session.deleteMany({ where: { userId, sessionToken: { not: sessionToken } } });
        await tx.pushSubscription.deleteMany({ where: { userId } });
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${codesLock(userId)}))`;
        await tx.mfaBackupCode.deleteMany({ where: { userId } });
        await tx.mfaBackupCode.createMany({ data: codeRows(userId, codes) });
        return true;
      },
      client,
    );
    if (turnedOn) {
      await logAudit(actor, eventFor(user, "enrolled"), target);
      await logAudit(actor, "mfa_backup_codes_created", target);
      backupCodes = codes;
    }
  }
  await scopedFor(userId, client).sessions.updateMany({
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
  const cleared = await systemTransaction(
    WHY,
    async (tx) => {
      // Only the two-factor the code was checked against, not one set up since.
      const { count } = await tx.user.updateMany({
        where: { id: userId, mfaSecretEncrypted: user.mfaSecretEncrypted },
        data: { mfaSecretEncrypted: null, mfaEnabledAt: null },
      });
      if (count > 0) await tx.mfaBackupCode.deleteMany({ where: { userId } });
      return count > 0;
    },
    client,
  );
  if (!cleared) return "wrong_code";
  // A code for the old secret proves nothing about a new one, if two-factor comes back.
  await systemDb(
    "Stopping two-factor un-verifies the person's sessions",
    client,
  ).session.updateMany({
    where: { userId },
    data: { mfaVerifiedAt: null },
  });
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
    scopedFor(userId, client).me.findUniqueOrThrow({
      where: { id: userId },
      select: { mfaEnabledAt: true },
    }),
    scopedFor(userId, client).mfaBackupCodes.count({ where: { userId, usedAt: null } }),
  ]);
  return { enabledAt: user.mfaEnabledAt, backupCodesLeft };
}
