import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ADVICE_TOPICS } from "@/config/suggestions";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { correctFact } from "@/lib/profile";
import { detectFor } from "@/lib/suggestions";

// Taxes QA (2026-10-22): one inherited_ira topic covered both the 10-year deadline (a fact) and
// "Spread your inherited IRA withdrawals" (a recommendation), so a real account got the
// recommendation. The spread is now inherited_ira_spread, demo advice only; the deadline stays
// for everyone.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("an inherited IRA, demo and real", { timeout: 300_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("no plaid");
      },
    },
  ) as PlaidApi;
  async function danAndLena(real: boolean, diedIn?: number) {
    const user = await client.user.create({
      data: { email: `qa-inherited-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: NOW, person: "preretire" });
    await syncItem(itemId, { client, api: plaid, now: NOW });
    if (diedIn !== undefined)
      await correctFact(user.id, "inherited_ira_death_year", String(diedIn), { client, now: NOW });
    // A CSV account next to the demo bank turns demo advice off (src/lib/advice-mode.ts).
    if (real)
      await client.account.create({
        data: {
          userId: user.id,
          source: "csv",
          name: "Credit union checking",
          type: "depository",
          currentBalanceCents: 100_000,
        },
      });
    return user.id;
  }
  const topics = async (userId: string) =>
    (await detectFor(userId, { client, now: NOW })).suggestions.map((s) => s.topic);

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("lists the spread as advice and the deadline as a fact", () => {
    expect(ADVICE_TOPICS).toContain("inherited_ira_spread");
    expect(ADVICE_TOPICS).not.toContain("inherited_ira");
  });

  it("gives the spread to demo people only", async () => {
    expect(await topics(await danAndLena(false))).toContain("inherited_ira_spread");
    expect(await topics(await danAndLena(true))).not.toContain("inherited_ira_spread");
  });

  it("gives the deadline in its last year to a real account too", async () => {
    const real = await topics(await danAndLena(true, 2016));
    expect(real).toContain("inherited_ira");
    expect(real).not.toContain("inherited_ira_spread");
  });
});
