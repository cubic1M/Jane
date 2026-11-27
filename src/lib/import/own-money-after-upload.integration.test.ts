import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/categorize/llm", () => ({ classifyMerchants: vi.fn(async () => new Map()) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/jobs", () => ({
  enqueueJob: vi.fn(async () => "job_1"),
  runJob: vi.fn(async () => "done"),
}));
vi.mock("@/lib/jane-agent/run", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jane-agent/run")>()),
  runJaneAgentSafely: vi.fn(),
}));

import { finishImport } from "./background";

// Walk of 11-27 (a figure): checking uploaded first, savings second, a regular move between the
// person's own accounts counted as income until the nightly run, which a trial person never gets.
// The upload's own after-save work (finishImport) now puts it right, in either order.
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-27T18:00:00Z");
const DAYS = ["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"];

describe.runIf(url)("a move between own accounts right after the second upload", () => {
  let client: PrismaClient;
  const users: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
  });

  async function person(trial: boolean) {
    const id = `${trial ? "trial_" : "own-"}${crypto.randomUUID()}`;
    await client.user.create({ data: { id, email: `${id}@example.com` } });
    users.push(id);
    const account = (name: string) =>
      client.account.create({ data: { userId: id, source: "csv", name, type: "depository" } });
    const [checking, savings] = [await account("Checking"), await account("Savings")];
    let n = 0;
    const row = (accountId: string, day: Date, cents: number, description: string, over = {}) =>
      client.transaction.create({
        data: {
          userId: id,
          accountId,
          source: "csv",
          dedupeKey: `k-${n++}`,
          date: day,
          amountCents: cents,
          description,
          merchantName: "Dana Lee",
          categorySource: "rule",
          ...over,
        },
      });
    // As an import saves them: the rules call the money in a transfer.
    const checkingRows = () =>
      Promise.all(
        DAYS.map((d) =>
          row(checking.id, new Date(d), -25_000, "ZELLE FROM DANA LEE", {
            pfcPrimary: "TRANSFER_IN",
            pfcDetailed: "TRANSFER_IN_ACCOUNT_TRANSFER",
          }),
        ),
      );
    const savingsRows = () =>
      Promise.all(
        DAYS.map((d) =>
          row(
            savings.id,
            new Date(new Date(d).getTime() - 86_400_000),
            25_000,
            "ZELLE TO DANA LEE",
            { pfcPrimary: "TRANSFER_OUT", pfcDetailed: "TRANSFER_OUT_ACCOUNT_TRANSFER" },
          ),
        ),
      );
    const finish = () => finishImport(id, "no-run", { client, now: NOW });
    const income = async () =>
      (
        await client.transaction.aggregate({
          where: { userId: id, pfcPrimary: "INCOME" },
          _sum: { amountCents: true },
        })
      )._sum.amountCents ?? 0;
    return { id, checkingRows, savingsRows, finish, income };
  }

  for (const trial of [false, true]) {
    it(`gives the same income in both upload orders (${trial ? "trial person" : "normal person"})`, async () => {
      const checkingFirst = await person(trial);
      await checkingFirst.checkingRows();
      await checkingFirst.finish();
      // Alone, the regular money in reads as income.
      expect(await checkingFirst.income()).toBe(-100_000);
      await checkingFirst.savingsRows();
      await checkingFirst.finish();

      const savingsFirst = await person(trial);
      await savingsFirst.savingsRows();
      await savingsFirst.finish();
      await savingsFirst.checkingRows();
      await savingsFirst.finish();

      expect(await savingsFirst.income()).toBe(0);
      expect(await checkingFirst.income()).toBe(0);
    });
  }

  it("leaves a category the person set by hand", async () => {
    const me = await person(false);
    const rows = await me.checkingRows();
    await me.finish();
    await client.transaction.update({
      where: { id: rows[0].id },
      data: { pfcPrimary: "INCOME", pfcDetailed: "INCOME_OTHER", categorySource: "user" },
    });
    await me.savingsRows();
    await me.finish();
    expect(await me.income()).toBe(-25_000);
  });
});
