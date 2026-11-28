import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import { withRequestMemo } from "@/lib/read-memo";

// A page asks a small table twenty ways, the year's transactions forty: with the reads shared for the
// request, one read of the person's rows answers them (src/lib/row-snapshots.ts), the same answers
// the database gives, and a write forgets them.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("a table read once for all that ask of it", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  let otherId: string;
  let statements = 0;
  const D = (s: string) => new Date(`${s}T00:00:00Z`);

  beforeAll(async () => {
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url }),
      log: [{ emit: "event", level: "query" }],
    });
    (client as unknown as { $on: (e: "query", f: (q: { query: string }) => void) => void }).$on(
      "query",
      (e) => {
        if (/^\s*SELECT/i.test(e.query) && !e.query.includes("set_config(")) statements += 1;
      },
    );
    userId = (
      await client.user.create({ data: { email: `snap-${crypto.randomUUID()}@example.com` } })
    ).id;
    otherId = (
      await client.user.create({ data: { email: `snap-${crypto.randomUUID()}@example.com` } })
    ).id;
    const mine = await client.account.create({
      data: {
        userId,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 5000,
      },
    });
    await client.account.create({
      data: { userId, source: "csv", name: "Card", type: "credit", currentBalanceCents: null },
    });
    const theirs = await client.account.create({
      data: { userId: otherId, source: "csv", name: "Not mine", type: "depository" },
    });
    await client.transaction.createMany({
      data: [
        ...Array.from({ length: 30 }, (_, i) => ({
          userId,
          accountId: mine.id,
          source: "csv" as const,
          date: D(`2026-0${1 + (i % 9)}-1${i % 9}`),
          amountCents: i * 100 - 500,
          description: `Line ${i}`,
          merchantName: i % 3 === 0 ? null : "Shop",
        })),
        {
          userId: otherId,
          accountId: theirs.id,
          source: "csv" as const,
          date: D("2026-03-03"),
          amountCents: 99,
          description: "Theirs",
        },
      ],
    });
  }, 120_000);

  afterAll(async () => {
    if (userId) await client.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await client.$disconnect();
  });

  const questions = (db: ReturnType<typeof scopedFor>) => [
    () => db.accounts.findMany({ select: { id: true, name: true }, orderBy: { id: "asc" } }),
    () => db.accounts.count({ where: { type: "credit" } }),
    () => db.accounts.findFirst({ where: { currentBalanceCents: null }, select: { name: true } }),
    () => db.accounts.findMany({ where: { NOT: { subtype: "checking" } }, select: { name: true } }),
    () => db.transactions.count({ where: { date: { gte: D("2026-01-01") }, merchantName: null } }),
    () =>
      db.transactions.aggregate({
        where: { date: { gte: D("2026-02-01") }, amountCents: { gt: 0 } },
        _sum: { amountCents: true },
      }),
    () =>
      db.transactions.findMany({
        where: { date: { gte: D("2026-01-01") }, merchantName: { not: "Shop" } },
        select: { id: true, amountCents: true },
        orderBy: [{ date: "desc" }, { id: "asc" }],
      }),
  ];

  const run = async (shared: boolean) => {
    const db = scopedFor(userId, client);
    statements = 0;
    const load = async () => Promise.all(questions(db).map((q) => q()));
    const answers = await (shared ? withRequestMemo(load) : load());
    return { answers, statements };
  };

  it("answers what the database does, from fewer reads, and never from another person's rows", async () => {
    const alone = await run(false);
    const shared = await run(true);
    expect(JSON.stringify(shared.answers)).toBe(JSON.stringify(alone.answers));
    expect(alone.statements).toBe(7);
    // The accounts once, and the year's transactions once.
    expect(shared.statements).toBe(2);
    expect(JSON.stringify(shared.answers)).not.toContain("Not mine");
  });

  it("goes to the database for what it cannot match exactly", async () => {
    const db = scopedFor(userId, client);
    const asked = async () => {
      // A relation, and a question with no start day: neither is answered from rows in memory.
      await db.accounts.findMany({
        select: { name: true, item: { select: { institutionName: true } } },
      });
      await db.transactions.count({});
    };
    statements = 0;
    await asked();
    const alone = statements;
    statements = 0;
    await withRequestMemo(asked);
    expect(statements).toBe(alone);
  });

  it("answers the newest rows from the window, and only those", async () => {
    const db = scopedFor(userId, client);
    const asked = () =>
      Promise.all([
        db.transactions.findFirst({
          orderBy: { date: "desc" },
          select: { date: true, amountCents: true },
        }),
        db.transactions.aggregate({ _max: { date: true } }),
        // Not about the newest day: the largest amount of all time, and a largest-amount order.
        db.transactions.aggregate({ _max: { amountCents: true } }),
        db.transactions.findFirst({
          orderBy: [{ amountCents: "desc" }, { date: "desc" }],
          select: { id: true },
        }),
      ]);
    statements = 0;
    const alone = await asked();
    const aloneStatements = statements;
    statements = 0;
    const shared = await withRequestMemo(asked);
    expect(JSON.stringify(shared)).toBe(JSON.stringify(alone));
    // The two about the newest day share the window's one read; the other two ask the database.
    expect(statements).toBe(aloneStatements - 1);
  });

  it("forgets what it held when something is written", async () => {
    const db = scopedFor(userId, client);
    await withRequestMemo(async () => {
      const before = await db.accounts.findFirst({
        where: { name: "Card" },
        select: { currentBalanceCents: true },
      });
      expect(before?.currentBalanceCents).toBeNull();
      const card = await db.accounts.findFirst({ where: { name: "Card" }, select: { id: true } });
      await db.accounts.update({ where: { id: card!.id }, data: { currentBalanceCents: 1234 } });
      const after = await db.accounts.findFirst({
        where: { name: "Card" },
        select: { currentBalanceCents: true },
      });
      expect(after?.currentBalanceCents).toBe(1234);
    });
  });

  it("shares nothing outside a request or a render", async () => {
    const db = scopedFor(userId, client);
    statements = 0;
    await db.accounts.findMany({ select: { name: true } });
    await db.accounts.count({});
    expect(statements).toBe(2);
  });

  it("never copies a secret column into the rows it holds", async () => {
    const db = scopedFor(userId, client);
    await withRequestMemo(async () => {
      const me = await db.me.findUnique({ where: { id: userId }, select: { timezone: true } });
      expect(me).toEqual({ timezone: null });
      // A read of the secret itself is the database's, not a copy.
      statements = 0;
      await db.me.findUnique({ where: { id: userId }, select: { mfaSecretEncrypted: true } });
      expect(statements).toBe(1);
    });
  });
});
