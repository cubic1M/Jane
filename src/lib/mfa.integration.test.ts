import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { logAudit } from "@/lib/audit";
import { decrypt } from "./crypto";
import { hashBackupCode } from "./backup-codes";
import { enrollment, newBackupCodes, turnOffTwoFactor, verifySessionCode } from "./mfa";
import { totp } from "./totp";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("two-factor against a real database", () => {
  let client: PrismaClient;
  const ids: string[] = [];

  async function admin(role: "admin" | "user" = "admin") {
    const user = await client.user.create({
      data: { email: `mfa-${crypto.randomUUID()}@example.com`, role },
    });
    ids.push(user.id);
    const token = `mfa-session-${crypto.randomUUID()}`;
    await client.session.create({
      data: { userId: user.id, sessionToken: token, expires: new Date(Date.now() + 86_400_000) },
    });
    return { userId: user.id, token };
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: ids } } });
    await client.rateLimit.deleteMany({ where: { key: { in: ids.map((id) => `mfa:${id}`) } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  beforeEach(() => vi.mocked(logAudit).mockReset());

  it("enrols with an encrypted secret, then verifies this session only", async () => {
    const { userId, token } = await admin();
    const setup = await enrollment(userId, "team@example.com", { client });
    if (setup.enrolled) throw new Error("expected a new enrolment");
    const stored = await client.user.findUniqueOrThrow({ where: { id: userId } });
    expect(stored.mfaSecretEncrypted).not.toContain(setup.secret);
    expect(decrypt(stored.mfaSecretEncrypted ?? "")).toBe(setup.secret);
    // Asking again before the first code gives the same secret.
    expect(await enrollment(userId, "team@example.com", { client })).toMatchObject({
      secret: setup.secret,
    });

    const now = new Date();
    expect((await verifySessionCode(userId, token, "000000", { client, now })).result).toBe(
      "wrong_code",
    );
    const first = await verifySessionCode(userId, token, totp(setup.secret, now), { client, now });
    expect(first.result).toBe("ok");
    expect(first.backupCodes).toHaveLength(10);

    expect((await client.user.findUniqueOrThrow({ where: { id: userId } })).mfaEnabledAt).toEqual(
      now,
    );
    expect(
      (await client.session.findUniqueOrThrow({ where: { sessionToken: token } })).mfaVerifiedAt,
    ).toEqual(now);
    expect(await enrollment(userId, "team@example.com", { client })).toEqual({ enrolled: true });
    expect(vi.mocked(logAudit).mock.calls.map((c) => c[1])).toEqual([
      "admin_mfa_failed",
      "admin_mfa_enrolled",
      "mfa_backup_codes_created",
      "admin_mfa_verified",
    ]);
  });

  it("stops guessing after five tries", async () => {
    const { userId, token } = await admin();
    await enrollment(userId, "team@example.com", { client });
    const now = new Date();

    const results = [];
    for (let i = 0; i < 6; i += 1)
      results.push((await verifySessionCode(userId, token, "000000", { client, now })).result);

    expect(results.at(-1)).toBe("too_many_attempts");
  });

  it("refuses a code before two-factor is set up", async () => {
    const { userId, token } = await admin("user");
    expect((await verifySessionCode(userId, token, "123456", { client })).result).toBe(
      "not_enrolled",
    );
  });

  // Turns two-factor on for someone and returns their secret and backup codes.
  async function enabled(role: "admin" | "user") {
    const { userId, token } = await admin(role);
    const setup = await enrollment(userId, "me@example.com", { client });
    if (setup.enrolled) throw new Error("expected a new enrolment");
    const { backupCodes } = await verifySessionCode(userId, token, totp(setup.secret, new Date()), {
      client,
    });
    return { userId, secret: setup.secret, backupCodes: backupCodes ?? [] };
  }

  it("lets anyone turn it on, with backup codes that work once each and are stored hashed", async () => {
    const { userId, backupCodes } = await enabled("user");
    const stored = await client.mfaBackupCode.findMany({ where: { userId } });
    expect(stored).toHaveLength(10);
    expect(stored.map((c) => c.codeHash)).toEqual(
      expect.arrayContaining([hashBackupCode(backupCodes[0])]),
    );
    expect(JSON.stringify(stored)).not.toContain(backupCodes[0]);

    // A new session: the backup code works once, typed any way.
    const token = `mfa-session-${crypto.randomUUID()}`;
    await client.session.create({
      data: { userId, sessionToken: token, expires: new Date(Date.now() + 86_400_000) },
    });
    const typed = backupCodes[0].toUpperCase().replace("-", " ");
    expect((await verifySessionCode(userId, token, typed, { client })).result).toBe("ok");
    expect((await verifySessionCode(userId, token, backupCodes[0], { client })).result).toBe(
      "wrong_code",
    );
    expect(
      (await client.session.findUniqueOrThrow({ where: { sessionToken: token } })).mfaVerifiedAt,
    ).not.toBeNull();
  });

  it("makes new backup codes only with a current code, and the old ones stop working", async () => {
    const { userId, secret, backupCodes } = await enabled("user");
    expect((await newBackupCodes(userId, "000000", { client })).result).toBe("wrong_code");
    const fresh = await newBackupCodes(userId, totp(secret, new Date()), { client });
    expect(fresh.codes).toHaveLength(10);
    expect(await client.mfaBackupCode.count({ where: { userId, usedAt: null } })).toBe(10);
    expect(
      await client.mfaBackupCode.count({
        where: { userId, codeHash: hashBackupCode(backupCodes[1]) },
      }),
    ).toBe(0);
  });

  it("needs a current code to turn off, and never for admins", async () => {
    const person = await enabled("user");
    expect(await turnOffTwoFactor(person.userId, "000000", { client })).toBe("wrong_code");
    expect(await turnOffTwoFactor(person.userId, person.backupCodes[2], { client })).toBe("ok");
    const after = await client.user.findUniqueOrThrow({ where: { id: person.userId } });
    expect(after).toMatchObject({ mfaEnabledAt: null, mfaSecretEncrypted: null });
    expect(await client.mfaBackupCode.count({ where: { userId: person.userId } })).toBe(0);

    const team = await enabled("admin");
    expect(await turnOffTwoFactor(team.userId, totp(team.secret, new Date()), { client })).toBe(
      "admin",
    );
  });
});
