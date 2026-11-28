import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { answerFromRows, type FieldInfo, type ModelInfo } from "./row-eval";

// The in-memory answer to a read (src/lib/row-eval.ts) must be the database's, exactly: the same
// rows, in the same order, in the same shape, and above all the same on a missing value, where SQL
// is neither equal nor unequal. Every filter below is asked of the real database and of the
// evaluator over the same rows, on a table with missing values in every nullable column.

const url = process.env.TEST_DATABASE_URL;

type Args = Record<string, unknown>;

describe.runIf(url)("reads answered from rows in memory", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  let model: ModelInfo;
  let rows: Record<string, unknown>[];
  const D = (s: string) => new Date(`${s}T00:00:00Z`);

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `row-eval-${crypto.randomUUID()}@example.com` } })
    ).id;
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    const merchants = ["Netflix", "netflix premium", null, "Spotify", "50% off store", "A_B"];
    const pfcs = [
      "ENTERTAINMENT_TV",
      "INCOME_SALARY",
      null,
      "FOOD_AND_DRINK_COFFEE",
      "ENTERTAINMENT_MUSIC",
    ];
    const cats = ["user", "plaid", null] as const;
    await client.transaction.createMany({
      data: Array.from({ length: 90 }, (_, i) => ({
        userId,
        accountId: account.id,
        source: "csv" as const,
        date: D(`2026-0${1 + (i % 9)}-${String(1 + (i % 27)).padStart(2, "0")}`),
        amountCents: ((i * 7919) % 5000) - 2000,
        description: `Line ${i} ${merchants[i % merchants.length] ?? "plain"}${i === 5 ? " café" : ""}`,
        merchantName: merchants[i % merchants.length],
        pfcPrimary: i % 4 === 0 ? null : "ENTERTAINMENT",
        pfcDetailed: pfcs[i % pfcs.length],
        categorySource: cats[i % cats.length],
        pending: i % 11 === 0,
        dedupeKey: i % 3 === 0 ? null : `k${i}`,
      })),
    });
    const fields = (
      client as unknown as {
        _runtimeDataModel: { models: Record<string, { fields: FieldInfo[] }> };
      }
    )._runtimeDataModel.models.Transaction.fields;
    model = new Map(fields.map((f) => [f.name, f]));
    rows = (await client.transaction.findMany({ where: { userId } })) as never;
    expect(rows.length).toBe(90);
  }, 120_000);

  afterAll(async () => {
    if (userId) await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  const norm = (v: unknown) => JSON.stringify(v);

  async function same(operation: "findMany" | "findFirst" | "count" | "aggregate", args: Args) {
    const scoped = { ...args, where: { ...(args.where as object), userId } };
    const expected = await (
      client.transaction as unknown as Record<string, (a: Args) => Promise<unknown>>
    )[operation](scoped);
    const answered = answerFromRows(model, operation, scoped, rows);
    expect(answered, `answered: ${norm(args)}`).not.toBeNull();
    expect(norm(answered!.value), norm(args)).toBe(norm(expected));
  }

  const WHERES: Args[] = [
    {},
    { pending: false },
    { pending: true },
    { merchantName: null },
    { merchantName: "Netflix" },
    { merchantName: { not: "Netflix" } },
    { merchantName: { not: null } },
    { merchantName: { equals: null } },
    { merchantName: { in: ["Netflix", "Spotify"] } },
    { merchantName: { notIn: ["Netflix", "Spotify"] } },
    { merchantName: { in: [] } },
    { merchantName: { notIn: [] } },
    { merchantName: { contains: "flix" } },
    { merchantName: { contains: "FLIX" } },
    { merchantName: { contains: "FLIX", mode: "insensitive" } },
    { merchantName: { startsWith: "net", mode: "insensitive" } },
    { merchantName: { endsWith: "ify" } },
    { merchantName: { contains: "%" } },
    { merchantName: { contains: "A_B" } },
    { merchantName: { contains: "0%" } },
    { merchantName: { startsWith: "50_" } },
    { merchantName: { contains: "x.*" } },
    { merchantName: { contains: "a%b", mode: "insensitive" } },
    { merchantName: { not: { contains: "flix" } } },
    { description: { contains: "plain" } },
    { pfcDetailed: { startsWith: "ENTERTAINMENT_" } },
    { pfcDetailed: { not: "INCOME_SALARY" } },
    { pfcDetailed: { notIn: ["INCOME_SALARY", "ENTERTAINMENT_TV"] } },
    { categorySource: "user" },
    { categorySource: { not: "user" } },
    { categorySource: { in: ["user", "plaid"] } },
    { categorySource: null },
    { amountCents: { gt: 0 } },
    { amountCents: { gte: 0, lt: 1000 } },
    { amountCents: { lte: -500 } },
    { amountCents: { not: 0 } },
    { amountCents: { in: [0, 100, -1000] } },
    { date: { gte: D("2026-03-01") } },
    { date: { gt: D("2026-03-01"), lte: D("2026-06-15") } },
    { date: D("2026-02-02") },
    { date: { not: D("2026-02-02") } },
    { date: { in: [D("2026-02-02"), D("2026-03-03")] } },
    { dedupeKey: null },
    { dedupeKey: { not: null } },
    { dedupeKey: { not: "k4" } },
    { dedupeKey: { startsWith: "k1" } },
    { createdAt: { lte: new Date() } },
    { AND: [{ pending: false }, { amountCents: { gt: 0 } }] },
    { AND: { pending: false } },
    { OR: [{ merchantName: "Netflix" }, { pfcDetailed: "INCOME_SALARY" }] },
    { OR: [] },
    { AND: [] },
    { NOT: { merchantName: "Netflix" } },
    { NOT: [{ merchantName: "Netflix" }, { pending: true }] },
    { NOT: { merchantName: { not: "Netflix" } } },
    { NOT: [] },
    { OR: [{ merchantName: { not: "Netflix" } }, { pending: true }] },
    { merchantName: { not: "Netflix" }, OR: [{ pfcDetailed: null }, { amountCents: { lt: 0 } }] },
    {
      AND: [
        { OR: [{ pending: true }, { merchantName: null }] },
        { NOT: { amountCents: { gt: 100 } } },
      ],
    },
    { id: { in: ["nope"] } },
    { pfcPrimary: "ENTERTAINMENT", pfcDetailed: { in: ["INCOME_SALARY", "ENTERTAINMENT_TV"] } },
  ];

  it("filters like the database", async () => {
    for (const where of WHERES) {
      await same("findMany", { where, orderBy: [{ date: "asc" }, { id: "asc" }] });
      await same("count", { where });
      await same("findFirst", { where, orderBy: [{ date: "desc" }, { id: "asc" }] });
    }
  });

  it("selects, orders and pages like the database", async () => {
    const where = { amountCents: { not: 0 } };
    for (const args of [
      { where, select: { id: true, amountCents: true }, orderBy: { id: "asc" } },
      { where, select: { amountCents: true, id: true, date: true }, orderBy: { id: "desc" } },
      { where, orderBy: [{ amountCents: "asc" }, { id: "asc" }] },
      { where, orderBy: [{ amountCents: "desc" }, { id: "asc" }] },
      { where, orderBy: { date: "desc" }, take: 5 },
      { where, orderBy: [{ date: "desc" }, { id: "asc" }], take: 7, skip: 3 },
      { where, select: { createdAt: true, pending: true }, orderBy: { id: "asc" }, skip: 80 },
      { where, orderBy: { dedupeKey: "asc" }, select: { id: true, dedupeKey: true }, take: 90 },
    ]) {
      // Ties in the order are the database's to break; only complete orders are compared.
      const complete = JSON.stringify(args.orderBy).includes('"id"');
      if (!complete && args.orderBy && !("amountCents" in (args.orderBy as object))) {
        const asked = answerFromRows(
          model,
          "findMany",
          { ...args, where: { ...where, userId } },
          rows,
        );
        // A text order the database collates is not answered here.
        if (JSON.stringify(args.orderBy).includes("merchantName")) expect(asked).toBeNull();
        continue;
      }
      await same("findMany", args);
    }
  });

  it("adds up like the database", async () => {
    await same("aggregate", { where: { pending: false }, _sum: { amountCents: true } });
    await same("aggregate", {
      where: { id: "none" },
      _sum: { amountCents: true },
      _max: { date: true },
    });
    await same("aggregate", { _min: { date: true }, _max: { date: true, amountCents: true } });
    await same("aggregate", {
      where: { merchantName: null },
      _count: { _all: true, merchantName: true },
    });
    await same("aggregate", { where: { pending: true }, _count: true });
  });

  it("leaves to the database what it cannot match exactly", () => {
    const ask = (op: string, args: Args) =>
      answerFromRows(model, op, { ...args, where: { ...(args.where as object), userId } }, rows);
    expect(ask("findMany", { include: { account: true } })).toBeNull();
    expect(ask("findMany", { select: { account: { select: { name: true } } } })).toBeNull();
    expect(ask("findMany", { distinct: ["date"] })).toBeNull();
    expect(ask("findMany", { cursor: { id: "x" } })).toBeNull();
    expect(ask("groupBy", { by: ["accountId"] })).toBeNull();
    expect(ask("findMany", { where: { account: { name: "x" }, userId } })).toBeNull();
    expect(ask("findMany", { where: { description: { gt: "a" }, userId } })).toBeNull();
    expect(ask("findMany", { where: { description: { contains: "a\\b" }, userId } })).toBeNull();
    expect(ask("findMany", { orderBy: { merchantName: "asc" } })).toBeNull();
    expect(
      ask("findMany", { where: { description: { contains: "e", mode: "insensitive" } } }),
    ).toBeNull();
    // Insensitive applies to equality and membership too, which compare as written here.
    expect(
      ask("findMany", { where: { merchantName: { equals: "NETFLIX", mode: "insensitive" } } }),
    ).toBeNull();
    expect(
      ask("findMany", { where: { merchantName: { in: ["NETFLIX"], mode: "insensitive" } } }),
    ).toBeNull();
    expect(
      ask("findMany", { where: { merchantName: { not: { equals: "x" }, mode: "insensitive" } } }),
    ).toBeNull();
    // An empty filter in a group, and an order by an enum (declaration order, not labels).
    expect(ask("findMany", { where: { OR: [{}, { pending: true }] } })).toBeNull();
    expect(ask("findMany", { where: { NOT: {} } })).toBeNull();
    expect(ask("findMany", { orderBy: { categorySource: "asc" } })).toBeNull();
    expect(ask("findMany", { take: -1 })).toBeNull();
    expect(ask("findMany", { where: { nope: 1, userId } })).toBeNull();
  });

  it("hands back its own copies", () => {
    const a = answerFromRows(model, "findMany", { where: { userId }, take: 1 }, rows)!
      .value as Record<string, unknown>[];
    (a[0].date as Date).setUTCFullYear(1999);
    expect((rows[0].date as Date).getUTCFullYear()).not.toBe(1999);
  });
});
