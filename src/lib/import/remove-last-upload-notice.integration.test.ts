import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
vi.mock("@/lib/jobs", () => ({ enqueueJob: vi.fn(async () => "job_1") }));

import { runBooksCheck } from "@/lib/books";
import { scopedFor } from "@/lib/db-scoped";
import { rebuildUploadedBalances } from "./balances";
import { removeUpload } from "./remove";
import { saveUpload } from "./upload";

// Pre-deploy walk of 11-27 (#2314's flow): after the only upload of an account was taken back,
// Home and Net worth kept saying "Chase euro's balance changed by $1,585.04 ... but the bank sent
// no transactions for it", for an account with no transactions and no balance. The worked-back
// balance rows stayed, because the rebuild after a removal skipped an account with no balance.
const url = process.env.TEST_DATABASE_URL;

function chase(rows: [string, string, number][], opening: number): string {
  let balance = opening;
  const lines = rows.map(([date, description, cents]) => {
    balance += cents;
    return `${cents < 0 ? "DEBIT" : "CREDIT"},${date},"${description}",${(cents / 100).toFixed(2)},ACH_DEBIT,${(balance / 100).toFixed(2)},,`;
  });
  return [
    "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #",
    ...lines.reverse(),
  ].join("\n");
}

function form(fields: Record<string, string>, name: string, text: string) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  data.append("files", new File([text], name, { type: "text/csv" }));
  return data;
}

describe.runIf(url)("taking back the only upload of an account", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (await client.user.create({ data: { email: "remove-last-notice@example.com" } })).id;
  });
  afterAll(async () => {
    if (userId) await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("leaves no worked-back balance rows, and no balance notice, behind", async () => {
    const db = scopedFor(userId, client);
    const only = await saveUpload(
      db,
      form(
        { accountId: "new", "new.name": "Chase euro", "new.kind": "checking" },
        "euro.csv",
        chase(
          [
            ["09/01/2026", "AVALON APTS RENT", -120000],
            ["10/02/2026", "ACME CORP PAYROLL", 145000],
          ],
          300000,
        ),
      ),
    );
    if (!only.ok) throw new Error(only.error);
    const rowsOf = (source: string) =>
      client.balanceSnapshot.count({ where: { accountId: only.accountId, source } });
    await rebuildUploadedBalances(db);
    expect(await rowsOf("derived")).toBeGreaterThan(0);

    await removeUpload(db, only.runId);
    // The background job that follows a removal works the balances out again.
    await rebuildUploadedBalances(db);
    expect(await rowsOf("derived")).toBe(0);
    expect(await rowsOf("file")).toBe(0);

    const books = await runBooksCheck(userId, { client, now: new Date("2026-11-26T20:00:00Z") });
    expect(books.open.filter((o) => o.accountId === only.accountId)).toEqual([]);
  });
});
