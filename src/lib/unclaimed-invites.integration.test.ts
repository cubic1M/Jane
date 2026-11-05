import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { createInviteCode, redeemInvite } from "./invites";
import { runRetention } from "./retention";

// A read of what's shared between people: a use is spent when the form is sent, before the address
// is proved, so 10 made-up addresses killed someone's share link for good, and any address could
// be left on the list.
const url = process.env.TEST_DATABASE_URL;
const DAY = 24 * 60 * 60 * 1000;

describe.runIf(url)("an invite use nobody claims", () => {
  let client: PrismaClient;
  const codes: string[] = [];
  const emails: string[] = [];

  const invite = async (maxUses: number) => {
    const { code } = await createInviteCode({ maxUses, note: null, expiresAt: null }, { client });
    codes.push(code);
    return code;
  };
  const address = () => {
    const email = `unclaimed-${crypto.randomUUID()}@example.com`;
    emails.push(email);
    return email;
  };
  const age = (email: string, days: number) =>
    client.betaAccess.update({
      where: { email },
      data: { createdAt: new Date(Date.now() - days * DAY) },
    });
  const uses = async (code: string) =>
    (await client.inviteCode.findUniqueOrThrow({ where: { code } })).uses;
  const onList = async (email: string) =>
    (await client.betaAccess.count({ where: { email } })) === 1;

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { email: { in: emails } } });
    await client.betaAccess.deleteMany({ where: { email: { in: emails } } });
    await client.inviteCode.deleteMany({ where: { code: { in: codes } } });
    await client.$disconnect();
  });

  it("goes back to the code, and the address leaves the list", async () => {
    const code = await invite(1);
    const nobody = address();
    expect(await redeemInvite(code, nobody, { client })).toBe("ok");
    expect(await redeemInvite(code, address(), { client })).toBe("used_up");
    await age(nobody, 8);
    await runRetention({ client, skipTrials: true });
    expect(await onList(nobody)).toBe(false);
    expect(await uses(code)).toBe(0);
    // The friend it was meant for can now get in.
    expect(await redeemInvite(code, address(), { client })).toBe("ok");
  });

  it("stays while the address may still be signing in", async () => {
    const code = await invite(2);
    const soon = address();
    await redeemInvite(code, soon, { client });
    await age(soon, 1);
    await runRetention({ client, skipTrials: true });
    expect(await onList(soon)).toBe(true);
    expect(await uses(code)).toBe(1);
  });

  it("starts its days again when they ask for another link", async () => {
    const code = await invite(2);
    const waiting = address();
    await redeemInvite(code, waiting, { client });
    await age(waiting, 8);
    expect(await redeemInvite(code, waiting, { client })).toBe("ok");
    await runRetention({ client, skipTrials: true });
    expect(await onList(waiting)).toBe(true);
  });

  it("a code taken back doesn't keep an unclaimed place going", async () => {
    const code = await invite(2);
    const waiting = address();
    await redeemInvite(code, waiting, { client });
    await age(waiting, 8);
    await client.inviteCode.update({ where: { code }, data: { revokedAt: new Date() } });
    await redeemInvite(code, waiting, { client });
    await runRetention({ client, skipTrials: true });
    expect(await onList(waiting)).toBe(false);
  });

  it("stays spent once someone signed in with it", async () => {
    const code = await invite(2);
    const joined = address();
    await redeemInvite(code, joined, { client });
    await client.user.create({ data: { email: joined } });
    await age(joined, 30);
    await runRetention({ client, skipTrials: true });
    expect(await onList(joined)).toBe(true);
    expect(await uses(code)).toBe(1);
  });
});
