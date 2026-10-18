import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { checkCode, createInviteCode, mayCreateAccount, redeemInvite } from "./invites";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("invite codes against a real database", () => {
  let client: PrismaClient;
  const codes: string[] = [];
  const email = (name: string) => `${name}-${crypto.randomUUID()}@example.com`;

  async function code(maxUses: number, expiresAt: Date | null = null) {
    const created = await createInviteCode({ maxUses, note: "test", expiresAt }, { client });
    codes.push(created.code);
    return created.code;
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  afterAll(async () => {
    await client.inviteCode.deleteMany({ where: { code: { in: codes } } });
    await client.$disconnect();
  });

  it("lets an email in once redeemed, without spending a second use on it", async () => {
    const c = await code(2);
    const a = email("a");

    expect(await mayCreateAccount(a, { client })).toBe(false);
    expect(await redeemInvite(c.toLowerCase(), a, { client })).toBe("ok");
    expect(await redeemInvite(c, a.toUpperCase(), { client })).toBe("ok");
    expect(await mayCreateAccount(a, { client })).toBe(true);
    expect((await client.inviteCode.findUniqueOrThrow({ where: { code: c } })).uses).toBe(1);
  });

  it("never goes over its uses, even with people redeeming at once", async () => {
    const c = await code(3);

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        redeemInvite(c, email(`p${i}`), { client }).catch(() => "error"),
      ),
    );

    expect(results.filter((r) => r === "ok")).toHaveLength(3);
    expect((await client.inviteCode.findUniqueOrThrow({ where: { code: c } })).uses).toBe(3);
    expect(await checkCode(c, { client })).toBe("used_up");
  });

  it("rejects unknown and expired codes", async () => {
    const expired = await code(5, new Date(Date.now() - 1000));

    expect(await checkCode("ABCD-EFGH-JKMN", { client })).toBe("invalid");
    expect(await redeemInvite(expired, email("x"), { client })).toBe("expired");
  });
});
