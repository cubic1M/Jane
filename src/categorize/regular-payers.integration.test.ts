import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { scopedFor } from "@/lib/db-scoped";
import { markCashIncome } from "./cash-income";
import { reapplyRules } from "./reapply";

// Through the pass every import, sync and nightly run calls, against a real, migrated Postgres.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("regular pay with no pay word", { timeout: 30_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  async function person(rows: {
    name: string;
    cents: number;
    primary?: string;
    detailed?: string;
    source?: "llm" | "user" | "rule";
    description?: string;
  }) {
    const user = await client.user.create({
      data: { email: `regular-payer-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Checking", type: "depository" },
    });
    for (let i = 0; i < 6; i++) {
      await client.transaction.create({
        data: {
          userId: user.id,
          accountId: account.id,
          source: "csv",
          dedupeKey: `p-${i}`,
          date: new Date(Date.UTC(2026, 6, 3 + i * 14)),
          amountCents: rows.cents,
          description: rows.description ?? rows.name.toUpperCase(),
          merchantName: rows.name,
          pfcPrimary: rows.primary ?? null,
          pfcDetailed: rows.detailed ?? null,
          categorySource: rows.source ?? null,
        },
      });
    }
    return user.id;
  }
  const details = async (userId: string) => [
    ...new Set(
      (await client.transaction.findMany({ where: { userId } })).map((r) => r.pfcDetailed),
    ),
  ];

  it("makes uncategorized pay income, and stays put when run again", async () => {
    const id = await person({ name: "Northwind Labs", cents: -261_025 });
    const db = scopedFor(id, client);
    expect(await markCashIncome(db)).toBe(6);
    expect(await details(id)).toEqual(["INCOME_OTHER"]);
    expect(await markCashIncome(db)).toBe(0);
  });

  it("makes income of what Claude took for a purchase", async () => {
    const id = await person({
      name: "Northwind Labs",
      cents: -261_025,
      primary: "GENERAL_SERVICES",
      detailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
      source: "llm",
    });
    await markCashIncome(scopedFor(id, client));
    expect(await details(id)).toEqual(["INCOME_OTHER"]);
  });

  it("leaves a person's own category, and a refund the rules placed", async () => {
    const own = await person({
      name: "Northwind Labs",
      cents: -261_025,
      primary: "TRANSFER_IN",
      detailed: "TRANSFER_IN_ACCOUNT_TRANSFER",
      source: "user",
    });
    await markCashIncome(scopedFor(own, client));
    expect(await details(own)).toEqual(["TRANSFER_IN_ACCOUNT_TRANSFER"]);
    const placed = await person({
      name: "Target",
      cents: -30_000,
      primary: "GENERAL_MERCHANDISE",
      detailed: "GENERAL_MERCHANDISE_SUPERSTORES",
      source: "rule",
    });
    await markCashIncome(scopedFor(placed, client));
    expect(await details(placed)).toEqual(["GENERAL_MERCHANDISE_SUPERSTORES"]);
  });

  // Debugger 11-02: a tenant's $1,450 a month by Zelle was a transfer, so money health read
  // "Spending ran about 23% above what came in" for someone ahead by about $1,000 a month.
  describe("regular money by Zelle from someone", () => {
    const zelle = {
      name: "From Tran T Nguyen",
      primary: "TRANSFER_IN",
      detailed: "TRANSFER_IN_ACCOUNT_TRANSFER",
      source: "rule" as const,
      description: "Zelle payment from TRAN T NGUYEN 18832204",
    };

    it("is income, and stays put when run again", async () => {
      const id = await person({ ...zelle, cents: -145_000 });
      const db = scopedFor(id, client);
      expect(await markCashIncome(db)).toBe(6);
      expect(await details(id)).toEqual(["INCOME_OTHER"]);
      expect(await markCashIncome(db)).toBe(0);
      // The nightly run: the rules call a Zelle line a transfer, and nothing may move back and
      // forth ("Re-sorted 6 transactions" and a new detection run, every night).
      expect(await reapplyRules(id, { client })).toBe(0);
      expect(await markCashIncome(db)).toBe(0);
      expect(await details(id)).toEqual(["INCOME_OTHER"]);
    });

    it("stays a transfer when it's small: a share of a bill", async () => {
      const id = await person({ ...zelle, cents: -4_000 });
      await markCashIncome(scopedFor(id, client));
      expect(await details(id)).toEqual(["TRANSFER_IN_ACCOUNT_TRANSFER"]);
    });

    it("stays what the person said it is", async () => {
      const id = await person({ ...zelle, cents: -145_000, source: "user" });
      await markCashIncome(scopedFor(id, client));
      expect(await details(id)).toEqual(["TRANSFER_IN_ACCOUNT_TRANSFER"]);
    });

    it("leaves a regular transfer with no Zelle in the line", async () => {
      const id = await person({
        ...zelle,
        name: "Home Fund",
        description: "TRANSFER FROM HOME FUND",
        cents: -145_000,
      });
      await markCashIncome(scopedFor(id, client));
      expect(await details(id)).toEqual(["TRANSFER_IN_ACCOUNT_TRANSFER"]);
    });
  });

  it("keeps a payer with a steady schedule as other income beside the clients", async () => {
    const id = await person({ name: "Northwind Labs", cents: -261_025 });
    const account = await client.account.findFirstOrThrow({ where: { userId: id } });
    const irregular = [
      ["BRIGHT PATH CLINIC", "2026-07-07", -610_000],
      ["BRIGHT PATH CLINIC", "2026-09-25", -740_000],
      ["HALCYON COFFEE", "2026-05-29", -420_000],
      ["HALCYON COFFEE", "2026-08-27", -295_000],
    ] as const;
    for (const [i, [name, day, cents]] of irregular.entries()) {
      await client.transaction.create({
        data: {
          userId: id,
          accountId: account.id,
          source: "csv",
          dedupeKey: `mix-${i}`,
          date: new Date(`${day}T00:00:00Z`),
          amountCents: cents,
          description: name,
          merchantName: name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()),
        },
      });
    }
    await markCashIncome(scopedFor(id, client));
    const rows = await client.transaction.findMany({ where: { userId: id } });
    expect(
      rows.filter((r) => r.merchantName === "Northwind Labs").map((r) => r.pfcDetailed),
    ).toEqual(Array(6).fill("INCOME_OTHER"));
    expect(rows.filter((r) => r.pfcDetailed === "INCOME_CONTRACTOR")).toHaveLength(4);
  });

  it("makes income of clients who pay at uneven times, through the same pass", async () => {
    const user = await client.user.create({
      data: { email: `client-deposits-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, source: "csv", name: "Business", type: "depository" },
    });
    const paid = [
      ["BRIGHT PATH CLINIC", "2026-07-03", -610_000],
      ["BRIGHT PATH CLINIC", "2026-09-25", -740_000],
      ["HALCYON COFFEE", "2026-05-29", -420_000],
      ["HALCYON COFFEE", "2026-08-27", -295_000],
      ["ESTATE OF M HOLLOWAY", "2026-07-10", -8_500_000],
    ] as const;
    for (const [i, [name, day, cents]] of paid.entries()) {
      await client.transaction.create({
        data: {
          userId: user.id,
          accountId: account.id,
          source: "csv",
          dedupeKey: `c-${i}`,
          date: new Date(`${day}T00:00:00Z`),
          amountCents: cents,
          description: name,
          merchantName: name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()),
        },
      });
    }
    const db = scopedFor(user.id, client);
    expect(await markCashIncome(db)).toBe(4);
    const rows = await client.transaction.findMany({ where: { userId: user.id } });
    // Contractor income: what the side-gig fact and the tax estimate read (debugger 11-02: "You have
    // a side gig: no" with $20,650 of invoices).
    expect(rows.filter((r) => r.pfcDetailed === "INCOME_CONTRACTOR")).toHaveLength(4);
    expect(rows.filter((r) => r.pfcPrimary === "INCOME")).toHaveLength(4);
    expect(rows.find((r) => r.description.startsWith("ESTATE"))?.pfcDetailed).toBeNull();
    // Nightly: nothing moves back and forth.
    expect(await reapplyRules(user.id, { client })).toBe(0);
    expect(await markCashIncome(db)).toBe(0);
  });

  it("leaves money moved in from another of their accounts", async () => {
    const userId = await person({ name: "Home Fund", cents: -50_000 });
    const other = await client.account.create({
      data: { userId, source: "csv", name: "Other", type: "depository" },
    });
    const money = await client.transaction.findMany({ where: { userId } });
    await client.transaction.createMany({
      data: money.map((row, i) => ({
        userId,
        accountId: other.id,
        source: "csv",
        dedupeKey: `out-${i}`,
        date: row.date,
        amountCents: 50_000,
        description: "TO HOME FUND",
        merchantName: "To Home Fund",
        pfcPrimary: "TRANSFER_OUT",
        pfcDetailed: "TRANSFER_OUT_SAVINGS",
        categorySource: "rule",
      })),
    });
    await markCashIncome(scopedFor(userId, client));
    const moved = await client.transaction.findMany({ where: { userId, amountCents: -50_000 } });
    expect(new Set(moved.map((r) => r.pfcDetailed))).toEqual(new Set([null]));
  });

  it("leaves money going out", async () => {
    const out = await person({ name: "Planet Fitness", cents: 261_025 });
    await markCashIncome(scopedFor(out, client));
    expect(await details(out)).toEqual([null]);
  });
});
