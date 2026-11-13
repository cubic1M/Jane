import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { hasHealthFsa, loadHealthYear } from "@/lib/insurance/health-year";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadTaxSavings } from "@/lib/tax-savings";

// Debugger 11-13: the demo bank's Taxes said "Sign up for an FSA by Nov 30" while its Insurance
// said "$1,670.64 is left in your FSA". Through the loaders the pages use: the person whose health
// year has an FSA gets no "use a health FSA" idea.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-13T15:00:00Z");

describe.runIf(url)("a health FSA said once", { timeout: 180_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no plaid");
      },
    },
  ) as PlaidApi;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("DEMO_BANK", "1");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `fsa-already-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    const { itemId } = await linkDemoBank(userId, { client, now: NOW });
    await syncItem(itemId, { client, api: plaid, now: NOW });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("isn't suggested to the person whose health year has one", async () => {
    const year = await loadHealthYear(userId, { client, now: NOW });
    expect(year?.fsa).not.toBeNull();
    expect(await hasHealthFsa(userId, { client })).toBe(true);
    const { savings } = await loadTaxSavings(userId, { client, now: NOW });
    expect(savings.map((s) => s.key)).not.toContain("health_fsa");
  });
});
