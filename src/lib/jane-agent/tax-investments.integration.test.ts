import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadInvestmentTaxes } from "@/lib/investment-taxes";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { runChatTool } from "./claude-tools";
import { loadSnapshot } from "./snapshot";
import { taxesSource } from "./sources/taxes";
import { sendToJane } from "./typing";

// Spec step 124 against a real, migrated Postgres, over the demo bank's holdings (step 128):
// gains match the holdings' cost basis; the PDIFX sale at a loss with its dividend
// reinvestments is a wash sale; the realised gains go into the estimate; harvesting and
// where to hold what are demo advice.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("investment taxes against a real database", () => {
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

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `tax-inv-${crypto.randomUUID()}@example.com` } })
    ).id;
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("unrealised gains match the holdings' cost basis, in the taxable account only", async () => {
    const view = await loadInvestmentTaxes(userId, 2026, { client, now: LINKED });
    const brokerage = await client.account.findFirstOrThrow({
      where: { userId, subtype: "brokerage" },
    });
    const holdings = await client.holding.findMany({
      where: {
        userId,
        accountId: brokerage.id,
        security: { isCashEquivalent: false, type: { not: "cash" } },
      },
    });
    expect(view.unrealisedCents.total).toBe(
      holdings.reduce((s, h) => s + h.valueCents - (h.costBasisCents ?? 0), 0),
    );
    expect(view.unrealised.every((u) => u.holding.accountId === brokerage.id)).toBe(true);
    const klcx = view.unrealised.find((u) => u.holding.ticker === "KLCX")!;
    // Bought 95 days ago: short-term.
    expect(klcx).toMatchObject({ shortTermCents: klcx.gainCents, longTermCents: 0 });
  });

  it("realised gains at average cost; the PDIFX loss is partly a wash sale", async () => {
    const view = await loadInvestmentTaxes(userId, 2026, { client, now: LINKED });
    const acme = view.realised.find((r) => r.ticker === "ACME")!;
    // 20 shares sold at $128.10 against $60.00 a share average cost: long-term.
    expect(acme).toMatchObject({
      proceedsCents: 256_200,
      costCents: 120_000,
      gainCents: 136_200,
      longTermCents: 136_200,
    });
    const pdifx = view.realised.find((r) => r.ticker === "PDIFX")!;
    expect(pdifx.washDisallowedCents).toBeGreaterThan(0);
    expect(pdifx.washReplacements.length).toBeGreaterThan(0);
    expect(view.washSales.map((w) => w.ticker)).toEqual(["PDIFX"]);
    // Into the estimate.
    const estimate = await loadTaxEstimate(userId, { client, now: LINKED });
    expect(estimate.input.income.longTermGainsCents).toBe(view.realisedCents.longTerm);
  });

  it("warns about the wash sale, and in October offers the harvest", async () => {
    const out = taxesSource.gather((await loadSnapshot(userId, { client, now: LINKED }))!, {
      now: LINKED,
      local: { date: "2026-10-18", hour: 8 },
      trigger: "open",
    });
    const wash = out.find((c) => c.dedupeKey.startsWith("wash:"))!;
    expect(wash.body).toMatch(
      /^Your sale of 60 PDIFX on Sep 24 was at a loss of \$[\d,.]+, but PDIFX was bought again within 30 days/,
    );
    expect(wash.refs.advice).toBeUndefined();
    const harvest = out.find((c) => c.dedupeKey.startsWith("harvest:2026:"))!;
    expect(harvest.body).toMatch(
      /^Pinnacle Dividend Income Fund is down \$[\d,.]+\. Selling it before Dec 31 would let the loss offset/,
    );
    expect(harvest.body).toContain("turn that off first");
    expect(harvest.refs).toMatchObject({ advice: true, taxTask: { dueOn: "2026-12-15" } });
    // Where to hold what is the investments lane's to say (step 135).
    expect(out.some((c) => c.dedupeKey.startsWith("location:"))).toBe(false);
  });

  it("answers capital gains questions, and gives Claude the details", async () => {
    const { reply } = await sendToJane(userId, "what are my realized gains this year", {
      client,
      now: LINKED,
    });
    expect(reply.body).toMatch(/^In 2026 so far you've realised \$[\d,.]+ of gains/);
    const tool = JSON.parse(
      (await runChatTool(userId, "tax_investments", {}, { client, now: LINKED })).content,
    );
    expect(tool.realised.map((r: { security: string }) => r.security).sort()).toEqual([
      "ACME",
      "PDIFX",
    ]);
    expect(tool.demoAdvice.harvest[0].security).toBe("PDIFX");
  });
});
