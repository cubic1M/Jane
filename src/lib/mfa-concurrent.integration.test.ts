import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

// What happens in the middle of a code check, for the one test that changes two-factor under it.
const during = vi.hoisted(() => ({ check: null as null | (() => Promise<unknown>) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/rate-limit", async (original) => {
  const real = await original<typeof import("@/lib/rate-limit")>();
  return {
    ...real,
    firstUseInWindow: async (...args: Parameters<typeof real.firstUseInWindow>) => {
      const first = await real.firstUseInWindow(...args);
      await during.check?.();
      return first;
    },
  };
});

import { decrypt, encrypt } from "./crypto";
import { enrollment, newBackupCodes, turnOffTwoFactor } from "./mfa";
import { generateSecret, totp } from "./totp";

// Two requests about one person's two-factor at the same time, against a real Postgres.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("two-factor changed by two requests at once", () => {
  let client: PrismaClient;
  const ids: string[] = [];

  async function person(data: { mfaSecretEncrypted?: string; mfaEnabledAt?: Date } = {}) {
    const user = await client.user.create({
      data: { email: `mfa-two-${crypto.randomUUID()}@example.com`, ...data },
    });
    ids.push(user.id);
    return user.id;
  }
  const stored = (id: string) => client.user.findUniqueOrThrow({ where: { id } });

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: ids } } });
    await client.rateLimit.deleteMany({
      where: { OR: ids.map((id) => ({ key: { contains: id } })) },
    });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("hands every first look the one secret that is kept", async () => {
    const userId = await person();
    const looks = await Promise.all(
      Array.from({ length: 5 }, () => enrollment(userId, "p@example.com", { client })),
    );
    const kept = decrypt((await stored(userId)).mfaSecretEncrypted ?? "");
    expect(looks.map((l) => (l.enrolled ? "enrolled" : l.secret))).toEqual(Array(5).fill(kept));
  });

  it("doesn't turn off a two-factor set up after the code was checked", async () => {
    const secret = generateSecret();
    const userId = await person({
      mfaSecretEncrypted: encrypt(secret),
      mfaEnabledAt: new Date(),
    });
    const replacement = encrypt(generateSecret());
    during.check = () =>
      client.user.update({ where: { id: userId }, data: { mfaSecretEncrypted: replacement } });
    const now = new Date();
    try {
      expect(await turnOffTwoFactor(userId, totp(secret, now), { client, now })).toBe("wrong_code");
    } finally {
      during.check = null;
    }
    expect((await stored(userId)).mfaSecretEncrypted).toBe(replacement);
    expect((await stored(userId)).mfaEnabledAt).not.toBeNull();
  });

  it("leaves one set of backup codes when two new sets are asked for at once", async () => {
    for (let round = 0; round < 4; round += 1) {
      const secret = generateSecret();
      const userId = await person({
        mfaSecretEncrypted: encrypt(secret),
        mfaEnabledAt: new Date(),
      });
      const now = new Date();
      const next = new Date(now.getTime() + 30_000);
      const both = await Promise.all(
        [now, next].map((at) => newBackupCodes(userId, totp(secret, at), { client, now })),
      );
      expect(both.map((r) => r.result)).toEqual(["ok", "ok"]);
      expect(await client.mfaBackupCode.count({ where: { userId } })).toBe(10);
    }
  });
});
