import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { encrypt } from "./crypto";
import { verifySessionCode } from "./mfa";
import { generateSecret, totp } from "./totp";

// Turning two-factor on when part of it fails, against a real Postgres.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("two-factor that can't sign the other sessions out", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `mfa-on-${crypto.randomUUID()}@example.com` } })
    ).id;
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.rateLimit.deleteMany({ where: { key: { contains: userId } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("isn't left on, and the next code does all of it", async () => {
    const secret = generateSecret();
    await client.user.update({
      where: { id: userId },
      data: { mfaSecretEncrypted: encrypt(secret) },
    });
    const expires = new Date(Date.now() + 3_600_000);
    const [mine, other] = [`mine-${userId}`, `other-${userId}`];
    await client.session.createMany({
      data: [mine, other].map((sessionToken) => ({ sessionToken, userId, expires })),
    });
    let fail = true;
    const flaky = client.$extends({
      query: {
        session: {
          deleteMany({ args, query }) {
            if (fail) throw new Error("database down");
            return query(args);
          },
        },
      },
    }) as unknown as PrismaClient;
    const now = new Date();
    await expect(
      verifySessionCode(userId, mine, totp(secret, now), { client: flaky, now }),
    ).rejects.toThrow("database down");
    const after = await client.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.mfaEnabledAt).toBeNull();

    fail = false;
    const next = new Date(now.getTime() + 30_000);
    const outcome = await verifySessionCode(userId, mine, totp(secret, next), {
      client: flaky,
      now: next,
    });
    expect(outcome).toMatchObject({ result: "ok", backupCodes: expect.any(Array) });
    expect(await client.session.count({ where: { sessionToken: other } })).toBe(0);
    expect(await client.mfaBackupCode.count({ where: { userId } })).toBe(10);
  });
});
