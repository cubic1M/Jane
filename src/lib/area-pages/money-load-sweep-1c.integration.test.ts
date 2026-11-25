import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { encrypt } from "@/lib/crypto";
import { copiesToLeaveOut } from "@/planning/books";
import { loadMoneyArea } from "./money-load";

// CodeRabbit sweep 1c, area-01: what the Spending & bills loader reads for its tree.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-16T23:00:00Z");

describe.runIf(url)("the Spending & bills loader", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const made: string[] = [];
  let n = 0;

  beforeAll(() => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const user = async () => {
    n += 1;
    const row = await client.user.create({
      data: { email: `money-load-sweep-1c-${n}@example.test`, timezone: "America/Los_Angeles" },
    });
    made.push(row.id);
    return row.id;
  };
  const item = async (userId: string, key: string, lastSyncedAt: Date = NOW) =>
    (
      await client.plaidItem.create({
        data: {
          userId,
          plaidItemId: `sweep-1c-${key}-${userId}`,
          accessTokenEncrypted: encrypt(`access-${key}`),
          institutionName: `Bank ${key}`,
          lastSyncedAt,
        },
      })
    ).id;
  const tx = (userId: string, accountId: string, date: string, k: number) => ({
    userId,
    accountId,
    source: "csv" as const,
    dedupeKey: `sweep-1c-${accountId}-${k}`,
    date: new Date(`${date}T00:00:00Z`),
    amountCents: 2_500,
    description: "CORNER CAFE",
    pending: false,
  });

  // Findings 3 and 6.
  it("draws no lowest balance for an account whose statement ended long ago, beside a fresh one", async () => {
    const userId = await user();
    const old = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Old statement checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 500_000,
      },
    });
    await client.balanceSnapshot.create({
      data: {
        userId,
        accountId: old.id,
        date: new Date("2026-08-01T00:00:00Z"),
        balanceCents: 500_000,
        source: "file",
      },
    });
    const fresh = await client.account.create({
      data: {
        userId,
        source: "plaid",
        itemId: await item(userId, "fresh"),
        plaidAccountId: `sweep-1c-fresh-${userId}`,
        name: "Fresh checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 300_000,
      },
    });
    await client.transaction.create({ data: tx(userId, fresh.id, "2026-11-15", 1) });
    const area = (await loadMoneyArea(userId, { client, now: NOW }))!;
    expect(area.lows.map((l) => l.accountId)).toEqual([fresh.id]);
  });

  it("says the statements are old when an account's last line is before the six-month window", async () => {
    const userId = await user();
    const account = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Long ago checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 100_000,
      },
    });
    await client.transaction.create({ data: tx(userId, account.id, "2026-03-10", 1) });
    const area = (await loadMoneyArea(userId, { client, now: NOW }))!;
    expect(area.statementsEnd).toBe("2026-03-10");
  });

  // CodeRabbit on #2260: statements that reach November (income only) are not "ending in October".
  it("counts a month with only income in it as covered", async () => {
    const userId = await user();
    const account = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Income only checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 100_000,
      },
    });
    await client.transaction.create({ data: tx(userId, account.id, "2026-10-12", 1) });
    await client.transaction.create({
      data: {
        ...tx(userId, account.id, "2026-11-10", 2),
        amountCents: -300_000,
        description: "PAYROLL",
      },
    });
    const area = (await loadMoneyArea(userId, { client, now: NOW }))!;
    expect(area.spending?.month).toBe("2026-10");
    expect(area.spending?.current).toBe(true);
  });

  // Finding 4.
  it("keeps each suggestion's own button and reason when two share a topic", async () => {
    const userId = await user();
    const suggestion = (key: string, score: number, label: string) =>
      client.suggestion.create({
        data: {
          userId,
          key,
          status: "waiting",
          score,
          capability: "subscriptions",
          topic: "same_topic",
          title: key,
          short: key,
          worthCents: 1_000,
          worthKind: "yearly",
          confidencePercent: 80,
          confidenceReason: "test",
          urgency: "low",
          why: `why ${key}`,
          actionLabel: label,
          actionHref: `/money/${key}`,
        },
      });
    const first = await suggestion("first", 60, "Open first");
    const second = await suggestion("second", 40, "Open second");
    const area = (await loadMoneyArea(userId, { client, now: NOW }))!;
    expect(area.suggestions.map((s) => s.id)).toEqual([first.id, second.id]);
    expect(area.actions[first.id]).toEqual({
      label: "Open first",
      href: "/money/first",
      why: "why first",
    });
    expect(area.actions[second.id]).toEqual({
      label: "Open second",
      href: "/money/second",
      why: "why second",
    });
  });

  // Finding 5.
  it("asks for no home when one is linked to a copy of the mortgage that is left out", async () => {
    const userId = await user();
    const loan = async (key: string) =>
      client.account.create({
        data: {
          userId,
          source: "plaid",
          itemId: await item(userId, key),
          plaidAccountId: `sweep-1c-loan-${key}-${userId}`,
          name: "Home loan",
          mask: "4455",
          type: "loan",
          subtype: "mortgage",
          currentBalanceCents: 30_000_000,
        },
      });
    const [a, b] = [await loan("one"), await loan("two")];
    const left = [...copiesToLeaveOut([a, b])];
    expect(left).toHaveLength(1);
    await client.ownedAsset.create({
      data: {
        userId,
        kind: "home",
        name: "House",
        valueCents: 50_000_000,
        valuedOn: new Date("2026-11-01T00:00:00Z"),
        loanAccountId: left[0],
      },
    });
    const area = (await loadMoneyArea(userId, { client, now: NOW }))!;
    expect(area.have.assetPrompt).toBeNull();
    expect(area.assetPromptHref).toBeNull();
  });

  it("still asks for a home when no home is linked to either copy", async () => {
    const userId = await user();
    for (const key of ["one", "two"])
      await client.account.create({
        data: {
          userId,
          source: "plaid",
          itemId: await item(userId, key),
          plaidAccountId: `sweep-1c-loan2-${key}-${userId}`,
          name: "Home loan",
          mask: "4455",
          type: "loan",
          subtype: "mortgage",
          currentBalanceCents: 30_000_000,
        },
      });
    const area = (await loadMoneyArea(userId, { client, now: NOW }))!;
    expect(area.have.assetPrompt).toBe("home");
  });

  // Finding 2: a copy removed between two reads of the accounts.
  it("counts a copied account once when the copy is removed between two reads", async () => {
    const userId = await user();
    for (const key of ["one", "two"])
      await client.account.create({
        data: {
          userId,
          source: "plaid",
          itemId: await item(userId, key),
          plaidAccountId: `sweep-1c-twice-${key}-${userId}`,
          name: "Checking",
          mask: "9911",
          type: "depository",
          subtype: "checking",
          currentBalanceCents: 100_000,
        },
      });
    // The account list read for the figures sees both rows; any other read of the accounts that
    // selects no balance (a second read just for the copies) sees one, as after a removal.
    const racy = client.$extends({
      query: {
        account: {
          async findMany({ args, query }) {
            const rows = await query(args);
            const forBalances = !!(args.select && "currentBalanceCents" in args.select);
            return forBalances ? rows : rows.slice(0, 1);
          },
        },
      },
    }) as unknown as PrismaClient;
    const area = (await loadMoneyArea(userId, { client: racy, now: NOW }))!;
    expect(area.have.assetsCents).toBe(100_000);
  });
});
