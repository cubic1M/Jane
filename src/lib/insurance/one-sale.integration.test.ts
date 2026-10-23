import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import type { PersonId } from "@/config/people";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { detectFor } from "@/lib/suggestions";

// Real-user QA (2026-10-23): someone who signed up and linked the demo bank (a salaried person
// with one $640 Shopify payout from selling something) was asked to check their business cover.
// One sale isn't a business; the freelancer and the shop owner still get it.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");
const NO_PLAID = new Proxy(
  {},
  {
    get: () => () => {
      throw new Error("no Plaid");
    },
  },
) as never;

describe.runIf(url)("one sale isn't a business", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });
  const topics = async (person?: PersonId) => {
    const user = await client.user.create({
      data: { email: `one-sale-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW, person });
    await syncItem(itemId, { client, api: NO_PLAID, now: NOW });
    return (await detectFor(user.id, { client, now: NOW })).suggestions.map((s) => s.topic);
  };

  it("asks the freelancer and the shop owner, not the person who sold something once", async () => {
    expect(await topics()).not.toContain("business_insurance");
    expect(await topics("freelancer")).toContain("business_insurance");
    expect(await topics("owner")).toContain("business_insurance");
  });
});
