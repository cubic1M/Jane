import { PrismaPg } from "@prisma/adapter-pg";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/categorize/llm", () => ({ classifyMerchants: vi.fn(async () => new Map()) }));

import { scopedFor } from "@/lib/db-scoped";
import { importCsvFiles } from "./import-csv";

// Uploading a file twice, or two files that overlap, is one upload: the same rows, the same total.
// Rows are made up, with the repeats real statements have (two coffees on one day stay two).
const url = process.env.TEST_DATABASE_URL;

const NAMES = ["COFFEE SHOP", "NETFLIX.COM", "SHELL OIL", "GROCER", "RENT"];
const statementRows = fc.array(
  fc.record({
    day: fc.integer({ min: 1, max: 28 }),
    name: fc.constantFrom(...NAMES),
    cents: fc.constantFrom(-450, -1549, -8000, -120000, 250000, 1200),
  }),
  { minLength: 1, maxLength: 25 },
);
type Row = { day: number; name: string; cents: number };

const dated = (r: Row) => `10/${String(r.day).padStart(2, "0")}/2026`;
const money = (c: number) => (c / 100).toFixed(2);
// Wells Fargo's shape: no balance column, so nothing but the rows decides.
const file = (name: string, rows: readonly Row[]) => ({
  name,
  text: rows.map((r) => `"${dated(r)}","${money(r.cents)}","*","","${r.name}"`).join("\n"),
});

describe.skipIf(!url)("importing twice", () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const userIds: string[] = [];
  let run = 0;

  async function account() {
    run += 1;
    const user = await prisma.user.create({
      data: { email: `double-${run}-${process.pid}-${Date.now()}@example.test` },
    });
    userIds.push(user.id);
    const db = scopedFor(user.id, prisma);
    const created = await db.accounts.create({
      data: {
        userId: user.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
      },
    });
    return { db, accountId: created.id };
  }
  const stored = async ({ db, accountId }: Awaited<ReturnType<typeof account>>) => {
    const rows = await db.transactions.findMany({
      where: { accountId },
      select: { date: true, amountCents: true, description: true, dedupeKey: true },
    });
    return rows
      .map((r) => `${r.date.toISOString()}|${r.amountCents}|${r.description}|${r.dedupeKey}`)
      .sort();
  };

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("adds nothing the second time", async () => {
    await fc.assert(
      fc.asyncProperty(statementRows, async (rows) => {
        const a = await account();
        const upload = file("wf.csv", rows);
        const first = await importCsvFiles(a.db, a.accountId, [upload]);
        const after = await stored(a);
        const second = await importCsvFiles(a.db, a.accountId, [upload]);
        expect(first.inserted).toBe(rows.length);
        expect(second.inserted).toBe(0);
        expect(second.corrected).toBe(0);
        expect(second.duplicates).toBe(rows.length);
        expect(await stored(a)).toEqual(after);
      }),
      { numRuns: 12 },
    );
  });

  it("is the same whether the file came whole or as two that overlap by whole days", async () => {
    await fc.assert(
      fc.asyncProperty(
        statementRows,
        fc.integer({ min: 5, max: 20 }),
        fc.integer({ min: 0, max: 5 }),
        async (rows, cut, overlap) => {
          const whole = await account();
          await importCsvFiles(whole.db, whole.accountId, [file("wf.csv", rows)]);

          const parts = await account();
          const early = rows.filter((r) => r.day <= cut);
          const late = rows.filter((r) => r.day > cut - overlap);
          if (early.length > 0) {
            await importCsvFiles(parts.db, parts.accountId, [file("a.csv", early)]);
          }
          if (late.length > 0) {
            await importCsvFiles(parts.db, parts.accountId, [file("b.csv", late)]);
          }
          expect(await stored(parts)).toEqual(await stored(whole));
        },
      ),
      { numRuns: 8 },
    );
  });

  it("keeps real repeats within one file, and the total with them", async () => {
    await fc.assert(
      fc.asyncProperty(statementRows, async (rows) => {
        const a = await account();
        const twice = [...rows, ...rows.slice(0, 1)];
        await importCsvFiles(a.db, a.accountId, [file("wf.csv", twice)]);
        const all = await a.db.transactions.findMany({ where: { accountId: a.accountId } });
        expect(all.length).toBe(twice.length);
        expect(all.reduce((sum, t) => sum + t.amountCents, 0)).toBe(
          -twice.reduce((sum, r) => sum + r.cents, 0),
        );
      }),
      { numRuns: 6 },
    );
  });
});
