import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

const { code, ip } = vi.hoisted(() => ({
  code: `${"ABCD"}-${crypto
    .randomUUID()
    .replace(/[^A-HJ-NP-Z2-9]/gi, "")
    .toUpperCase()
    .slice(0, 4)
    .padEnd(4, "K")}-WXYZ`,
  ip: `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "fc_invite" ? { value: code } : undefined),
  }),
  headers: async () => new Headers({ "x-forwarded-for": ip }),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
// The sign-in check uses the app's own client; here it's the test database's.
vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({
      adapter: new Adapter({
        connectionString: process.env.TEST_DATABASE_URL ?? "postgres://none",
      }),
    }),
  };
});
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { allowSignIn } from "./auth-gate";
import { normalizeCode } from "./invites";

// Auth.js's own email route reaches the sign-in check with whatever invite cookie the request
// carries, and spent a use of the code for each address asked, proven or not. One script from one
// place emptied a 10-use code in seconds (run on a local build: 10 posts, 10 of 10 spent). It's held
// to the form's limit: 8 tries of one code from one place a day. Against a real Postgres.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("an invite code asked for through Auth.js's email route", () => {
  let client: PrismaClient;
  beforeAll(async () => {
    vi.stubEnv("BETA_INVITE_ONLY", "true");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    await client.inviteCode.create({ data: { code: normalizeCode(code)!, maxUses: 10 } });
  });
  afterAll(async () => {
    await client.betaAccess.deleteMany({ where: { inviteCode: { code: normalizeCode(code)! } } });
    await client.inviteCode.deleteMany({ where: { code: normalizeCode(code)! } });
    await client.rateLimit.deleteMany({ where: { key: { contains: normalizeCode(code)! } } });
    await client.$disconnect();
  });

  it("spends no more than the form would let one place spend", async () => {
    for (let i = 0; i < 10; i += 1) {
      await allowSignIn({
        user: { email: `made-up-${i}-${crypto.randomUUID()}@example.com` },
        email: { verificationRequest: true },
      });
    }
    const invite = await client.inviteCode.findUniqueOrThrow({
      where: { code: normalizeCode(code)! },
    });
    expect(invite.uses).toBe(8);
  });
});
