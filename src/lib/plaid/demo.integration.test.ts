import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { netWorth } from "@/insights/net-worth";
import { decrypt } from "@/lib/crypto";
import { loadInvestments } from "@/lib/investments/holdings";
import { hasDemoBank, linkDemoBank } from "./demo";
import { removePlaidItem } from "./remove";
import { syncItem } from "./sync";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("the demo bank, end to end", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  // Any call to real Plaid fails the test.
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
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `demo-${crypto.randomUUID()}@example.com` } })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("links once, syncs like a real bank and finds every kind of saving", async () => {
    const { itemId, created } = await linkDemoBank(userId, { client, now: LINKED });
    expect(created).toBe(true);
    expect(await linkDemoBank(userId, { client, now: LINKED })).toEqual({ itemId, created: false });
    expect(await hasDemoBank(userId, { client })).toBe(true);
    const item = await client.plaidItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(decrypt(item.accessTokenEncrypted)).toMatch(/^demo:[a-f0-9]{16}:2026-10-18$/);

    const result = await syncItem(itemId, { client, api: plaid, now: LINKED });
    expect(result).toMatchObject({
      accounts: 8,
      firstSync: true,
      liabilities: "updated",
      investments: "updated",
    });
    expect(result.added).toBeGreaterThan(400);
    expect(await client.liability.count({ where: { userId } })).toBe(4);
    // Loans are kept for their balances, their payments come from checking.
    const loanTransactions = await client.transaction.count({
      where: { userId, account: { type: "loan" } },
    });
    expect(loanTransactions).toBe(0);

    const types = new Set(
      (await client.finding.findMany({ where: { userId }, select: { type: true } })).map(
        (f) => f.type,
      ),
    );
    for (const type of [
      "price_increase",
      "bill_negotiation",
      "bank_fees",
      "card_interest",
      "idle_cash",
      "insurance_reshop",
      "duplicate_charge",
      "trial_conversion",
      "subscription_review",
    ]) {
      expect(types.has(type as never), type).toBe(true);
    }
  });

  it("keeps what the investment accounts hold, adding up to net worth (spec step 128)", async () => {
    const investments = await loadInvestments(userId, { client, now: LINKED });
    const accounts = await client.account.findMany({
      where: { userId },
      select: { id: true, name: true, type: true, currentBalanceCents: true },
    });
    const worth = netWorth(accounts.map((a) => ({ ...a, balanceCents: a.currentBalanceCents })));
    expect(investments.totalCents).toBe(worth.investmentsCents);
    expect(investments.totalCents).toBe(9_673_055);
    expect(investments.holdingCount).toBe(9);
    for (const account of investments.accounts) {
      expect(account.holdingsMatch, account.name).toBe(true);
      for (const h of account.holdings) expect(h.source).toMatch(/^Demo Bank \(fake data\), /);
    }
    expect(investments.accounts.map((a) => a.label)).toEqual(["401(k)", "Brokerage"]);
    // Two years of contributions, buys, dividends and fees, to the last payday.
    const transactions = await client.investmentTransaction.findMany({
      where: { userId },
      select: { date: true },
      orderBy: { date: "asc" },
    });
    expect(transactions.length).toBeGreaterThan(150);
    expect(transactions.at(-1)!.date.toISOString().slice(0, 10)).toBe("2026-10-15");
  });

  it("adds only the new days on a later sync", async () => {
    const item = await client.plaidItem.findFirstOrThrow({ where: { userId } });
    const before = await client.transaction.count({ where: { userId } });
    const investmentsBefore = await client.investmentTransaction.count({ where: { userId } });
    const later = await syncItem(item.id, {
      client,
      api: plaid,
      now: new Date("2026-10-25T15:00:00Z"),
    });
    expect(later.firstSync).toBe(false);
    expect(await client.transaction.count({ where: { userId } })).toBe(before + later.added);
    expect(later.added).toBeGreaterThan(0);
    // The holdings are replaced and investment transactions read again, never doubled.
    expect(await client.holding.count({ where: { userId } })).toBe(9);
    expect(await client.investmentTransaction.count({ where: { userId } })).toBe(investmentsBefore);
    // Same day again: nothing new.
    expect(
      (await syncItem(item.id, { client, api: plaid, now: new Date("2026-10-25T18:00:00Z") }))
        .added,
    ).toBe(0);
  });

  it("removes everything without calling Plaid", async () => {
    const item = await client.plaidItem.findFirstOrThrow({ where: { userId } });
    await removePlaidItem(userId, item.id, "user_disconnected", { client, api: plaid });
    expect(await hasDemoBank(userId, { client })).toBe(false);
    expect(await client.account.count({ where: { userId } })).toBe(0);
    expect(await client.transaction.count({ where: { userId } })).toBe(0);
    expect(await client.holding.count({ where: { userId } })).toBe(0);
    expect(await client.investmentTransaction.count({ where: { userId } })).toBe(0);
  });
});
