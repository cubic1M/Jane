import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import {
  checkCode,
  createInviteCode,
  joinWaitlist,
  mayCreateAccount,
  redeemInvite,
  revokeInviteCode,
} from "./invites";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("invite codes against a real database", () => {
  let client: PrismaClient;
  const codes: string[] = [];
  const email = (name: string) => `${name}-${crypto.randomUUID()}@example.com`;

  async function code(
    maxUses: number,
    expiresAt: Date | null = null,
    lockedTo: string | null = null,
  ) {
    const created = await createInviteCode(
      { maxUses, note: "test", expiresAt, email: lockedTo },
      { client },
    );
    codes.push(created.code);
    return created.code;
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  const waitlisted: string[] = [];
  afterAll(async () => {
    await client.inviteCode.deleteMany({ where: { code: { in: codes } } });
    await client.waitlistEntry.deleteMany({ where: { email: { in: waitlisted } } });
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

  it("audits and counts a redemption by the code's id, never the email", async () => {
    vi.mocked(logAudit).mockClear();
    vi.mocked(track).mockClear();
    const c = await code(1);
    const id = (await client.inviteCode.findUniqueOrThrow({ where: { code: c } })).id;
    expect(await redeemInvite(c, email("audit"), { client })).toBe("ok");
    expect(logAudit).toHaveBeenCalledWith(expect.anything(), "invite_redeemed", {
      type: "invite_code",
      id,
    });
    expect(track).toHaveBeenCalledWith(null, "invite_redeemed", { invite_id: id });
  });

  it("works only for the email it was made for, when it names one", async () => {
    const friend = email("Friend");
    const c = await code(1, null, friend.toUpperCase());
    expect(await redeemInvite(c, email("someone-else"), { client })).toBe("wrong_email");
    // A Google sign-up checks the code before it knows the email; the callback checks again.
    expect(await checkCode(c, { client })).toBe("ok");
    expect(await redeemInvite(c, friend, { client })).toBe("ok");
    expect(await mayCreateAccount(friend, { client })).toBe(true);
  });

  it("stops working once revoked, and the people already in stay in", async () => {
    const c = await code(5);
    const before = email("before");
    expect(await redeemInvite(c, before, { client })).toBe("ok");
    expect(await revokeInviteCode(c, { client })).not.toBeNull();
    // Revoking twice is a no-op.
    expect(await revokeInviteCode(c, { client })).toBeNull();
    expect(await redeemInvite(c, email("after"), { client })).toBe("revoked");
    expect(await mayCreateAccount(before, { client })).toBe(true);
  });

  it("keeps a waitlist email once, in lowercase, and sends nothing", async () => {
    const w = email("Wait");
    waitlisted.push(w.toLowerCase());
    expect(await joinWaitlist(` ${w.toUpperCase()} `, { client })).toBe(true);
    expect(await joinWaitlist(w, { client })).toBe(false);
    const rows = await client.waitlistEntry.findMany({ where: { email: w.toLowerCase() } });
    expect(rows).toHaveLength(1);
    // The waitlist isn't an invite.
    expect(await mayCreateAccount(w, { client })).toBe(false);
  });
});
