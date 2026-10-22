import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { runChatTool } from "./claude-tools";

// Spec step 192 against a real Postgres with the demo bank: the tools added so anything on a
// page can be asked in the chat answer from the page's own loaders.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("a tool for everything, against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;
  const run = async (name: string) =>
    JSON.parse((await runChatTool(userId, name, {}, { client, now: LINKED })).content);

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `tools192-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("forecasts the balance with the paychecks and bills that drive it", async () => {
    const { accounts } = await run("balance_forecast");
    expect(accounts[0]).toMatchObject({ account: expect.any(String), goesNegative: false });
    expect(accounts[0].lowestPoint).toMatch(/^\$[\d,]+\.\d\d$/);
    // The payroll on its schedule is among what the forecast counts (step 182).
    expect(JSON.stringify(accounts[0])).toMatch(/Acme/i);
  });

  it("lists unread alerts, and says when nobody is sharing", async () => {
    const { unread } = await run("alerts");
    expect(Array.isArray(unread)).toBe(true);
    expect(unread.length).toBeGreaterThan(0);
    expect(await run("household")).toEqual({ note: "They aren't sharing with a partner." });
  });
});
