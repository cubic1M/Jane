import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { answerFromRows, type FieldInfo, type ModelInfo } from "./row-eval";

// Cases the first differential test (row-eval.integration.test.ts) does not hold: an enum's order,
// a date given with a time of day, ties under a limit, and an answer that is the same as the
// database's only by luck of the row order. Each is asked of the real database and of the
// evaluator over the same rows; the evaluator may decline (null), and may not differ.

const url = process.env.TEST_DATABASE_URL;
type Args = Record<string, unknown>;

describe.runIf(url)("row-eval against the database, the hard cases", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  let model: ModelInfo;
  let rows: Record<string, unknown>[];
  const D = (s: string) => new Date(`${s}T00:00:00Z`);

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({
        data: { email: `row-eval-adv-${crypto.randomUUID()}@example.com` },
      })
    ).id;
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    const cats = ["rule", "llm", "plaid", "user", "cash_income", null] as const;
    await client.transaction.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        userId,
        accountId: account.id,
        source: "csv" as const,
        // Five rows on each of twelve days: ties on the date.
        date: D(`2026-05-${String(1 + Math.floor(i / 5)).padStart(2, "0")}`),
        amountCents: (i % 4) * 100,
        description: `Line ${i}`,
        categorySource: cats[i % cats.length],
      })),
    });
    const fields = (
      client as unknown as {
        _runtimeDataModel: { models: Record<string, { fields: FieldInfo[] }> };
      }
    )._runtimeDataModel.models.Transaction.fields;
    model = new Map(fields.map((f) => [f.name, f]));
    rows = (await client.transaction.findMany({ where: { userId } })) as never;
  }, 120_000);

  afterAll(async () => {
    if (userId) await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  async function compare(operation: "findMany" | "findFirst" | "count" | "aggregate", args: Args) {
    const scoped = { ...args, where: { ...(args.where as object), userId } };
    const expected = await (
      client.transaction as unknown as Record<string, (a: Args) => Promise<unknown>>
    )[operation](scoped);
    const answered = answerFromRows(model, operation, scoped, rows);
    // Declining is always allowed: the database then answers.
    if (answered === null) return;
    expect(JSON.stringify(answered.value), JSON.stringify(args)).toBe(JSON.stringify(expected));
  }

  // Prisma has no range filter or min / max on an enum, so there is no enum order to differ on.

  // A date with a time of day against the DATE column: the database cuts the value to its day.
  it.each(["equals", "lt", "lte", "gt", "gte"])(
    "a date given with a time of day (%s) compares like the database's date column",
    async (op) => {
      const noon = new Date("2026-05-04T12:00:00Z");
      await compare("count", { where: { date: { [op]: noon } } });
    },
  );

  it("a bare date with a time of day, and in a list", async () => {
    const noon = new Date("2026-05-04T12:00:00Z");
    await compare("count", { where: { date: noon } });
    await compare("count", { where: { date: { in: [noon, D("2026-05-05")] } } });
  });

  it("a limit over ties returns the rows the database does (an unspecified choice is not copied)", async () => {
    await compare("findMany", { orderBy: { date: "desc" }, take: 3, select: { id: true } });
    await compare("findMany", { orderBy: { amountCents: "desc" }, take: 7, select: { id: true } });
    await compare("findFirst", { orderBy: { date: "desc" }, select: { id: true } });
    await compare("findFirst", { orderBy: { amountCents: "desc" }, select: { id: true } });
    await compare("findFirst", { where: { amountCents: 100 }, select: { id: true } });
    await compare("findMany", {
      orderBy: { date: "desc" },
      skip: 2,
      take: 4,
      select: { id: true },
    });
  });

  it("the same, with a complete order, is the database's", async () => {
    await compare("findMany", {
      orderBy: [{ date: "desc" }, { id: "asc" }],
      take: 7,
      select: { id: true },
    });
  });
});
