import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { logAudit } from "@/lib/audit";
import { decrypt } from "./crypto";
import { enrollment, verifyAdminCode } from "./mfa";
import { totp } from "./totp";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("admin two-factor against a real database", () => {
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
    expect(await verifyAdminCode(userId, token, "000000", { client, now })).toBe("wrong_code");
    expect(await verifyAdminCode(userId, token, totp(setup.secret, now), { client, now })).toBe(
      "ok",
    );

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
      "admin_mfa_verified",
    ]);
  });

  it("stops guessing after five tries", async () => {
    const { userId, token } = await admin();
    await enrollment(userId, "team@example.com", { client });
    const now = new Date();

    const results = [];
    for (let i = 0; i < 6; i += 1)
      results.push(await verifyAdminCode(userId, token, "000000", { client, now }));

    expect(results.at(-1)).toBe("too_many_attempts");
  });

  it("refuses non-admins", async () => {
    const { userId, token } = await admin("user");
    expect(await verifyAdminCode(userId, token, "123456", { client })).toBe("not_enrolled");
  });
});
