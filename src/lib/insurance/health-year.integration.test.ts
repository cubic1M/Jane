import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { healthYearAnswer } from "@/lib/jane-agent/insurance/health-year";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadHealthYear, openDisputeCards } from "./health-year";

// Health cover all year against a real, migrated Postgres (spec step 200): the demo year
// shows deductible progress and an FSA deadline, and a bill above the plan's share opens a
// dispute card, once. A person with no health plan on file gets nothing made up.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("health cover all year, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;
  const o = () => ({ client, now: NOW });

  async function demoPerson() {
    const user = await client.user.create({
      data: { email: `ins-hy-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW });
    await syncItem(itemId, { client, api: plaid, now: NOW });
    return user.id;
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("shows deductible progress and an FSA deadline in the demo year", async () => {
    const userId = await demoPerson();
    const year = await loadHealthYear(userId, o());
    expect(year?.sample).toBe(true);
    expect(year?.progress.deductibleMetCents).toBeGreaterThan(0);
    expect(year?.fsa?.deadline).toBe("2026-12-31");
    expect(year?.fsa?.warn).toBe(true);
    const reply = await healthYearAnswer(userId, o());
    expect(reply.body).toMatch(/of your \$500\.00 deductible/);
    expect(reply.body).toMatch(/FSA/);
  });

  it("opens one dispute card for the big bill above the plan's share, once", async () => {
    const userId = await demoPerson();
    const year = await loadHealthYear(userId, o());
    expect(year?.disputes.map((d) => d.bill.provider)).toEqual(["BAYVIEW IMAGING CENTER"]);
    // The sync's insurance run already opened it; asking again opens nothing more.
    expect(await openDisputeCards(userId, o())).toBe(0);
    const cards = await client.finding.findMany({
      where: { userId, key: { startsWith: "health-bill:" } },
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].type).toBe("bill_negotiation");
    expect((cards[0].evidence as { dispute?: boolean }).dispute).toBe(true);
  });

  it("makes nothing up for someone with no health plan", async () => {
    const user = await client.user.create({
      data: { email: `ins-hy-none-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    expect(await loadHealthYear(user.id, o())).toBeNull();
    expect((await healthYearAnswer(user.id, o())).body).toMatch(/don't have your health plan/);
  });
});
