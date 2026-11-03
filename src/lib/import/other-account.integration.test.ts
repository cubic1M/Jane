import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
import { alreadyInAnotherAccount } from "./other-account";

// Debugger 11-03: /import says an overlapping file is safe, and into the same account it is, but
// right after a first upload the choice stays "A new account": a second export of the same bank
// made a second "PNC checking", and net worth read $34,806 for someone with $18,494.
const url = process.env.TEST_DATABASE_URL;

const row = (day: number, what: string, cents: number) =>
  `2026-08-${String(day).padStart(2, "0")},${what},${(-cents / 100).toFixed(2)}`;
const chase = (rows: string[]) => ({
  name: "statement.csv",
  text: [
    "Transaction Date,Post Date,Description,Category,Type,Amount,Memo",
    ...rows.map((r) => {
      const [date, what, amount] = r.split(",");
      const [y, m, d] = date.split("-");
      return `${m}/${d}/${y},${m}/${d}/${y},${what},Shopping,Sale,${amount},`;
    }),
  ].join("\n"),
});

describe.runIf(url)("rows already in another account", () => {
  let client: PrismaClient;
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `other-account-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    const account = await client.account.create({
      data: { userId, source: "csv", name: "PNC checking", type: "depository" },
    });
    accountId = account.id;
    for (let day = 1; day <= 10; day++) {
      await client.transaction.create({
        data: {
          userId,
          accountId,
          date: new Date(`2026-08-${String(day).padStart(2, "0")}T00:00:00Z`),
          amountCents: 1_000 + day,
          description: `SHOP ${day}`,
          source: "csv",
          dedupeKey: crypto.randomUUID(),
        },
      });
    }
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  const inFile = (days: number[], extra: string[] = []) =>
    chase([...days.map((d) => row(d, `SHOP ${d}`, 1_000 + d)), ...extra]);
  const check = (file: { name: string; text: string }) =>
    alreadyInAnotherAccount(scopedFor(userId, client), [file]);

  it("names the account and how many, for the same file again", async () => {
    expect(await check(inFile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toEqual({
      accountId,
      name: "PNC checking",
      rows: 10,
      ofRows: 10,
    });
  });

  it("names it for a later export that overlaps part of the way", async () => {
    const later = Array.from({ length: 14 }, (_, i) => row(11 + i, `NEW ${i}`, 2_000 + i));
    expect(await check(inFile([6, 7, 8, 9, 10], later))).toMatchObject({ rows: 5, ofRows: 19 });
  });

  it("says nothing for another account that shares a couple of charges", async () => {
    const other = Array.from({ length: 14 }, (_, i) => row(11 + i, `NEW ${i}`, 2_000 + i));
    expect(await check(inFile([1, 2], other))).toBeNull();
  });

  it("says nothing when nothing is there yet, or the file can't be read", async () => {
    const other = Array.from({ length: 6 }, (_, i) => row(11 + i, `NEW ${i}`, 2_000 + i));
    expect(await check(chase(other))).toBeNull();
    expect(await check({ name: "x.csv", text: "nope" })).toBeNull();
  });
});
