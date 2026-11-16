import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/jobs", () => ({ enqueueJob: vi.fn(async () => "job_1") }));

import { listUploads, removeUpload } from "./remove";
import { saveUpload } from "./upload";
import { scopedFor } from "@/lib/db-scoped";

// Two overlapping Chase checking statements, then the newer one taken back (debug 3, 11-16): the
// account kept the removed file's closing balance ($6,907.24 where the older file ends at
// $4,629.66), and the older file's own balances for the two weeks both covered were deleted. The
// same file uploaded twice was listed twice, and removing the copy that added nothing deleted
// every balance the first one kept.
const url = process.env.TEST_DATABASE_URL;

type Row = [date: string, description: string, cents: number];
// Chase's export: newest first, each row with the balance after it.
function chase(rows: Row[], opening: number): string {
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

const OLDER: Row[] = [
  ["09/01/2026", "AVALON APTS RENT", -120000],
  ["09/04/2026", "ACME CORP PAYROLL", 145000],
  ["10/01/2026", "AVALON APTS RENT", -120000],
  ["10/02/2026", "ACME CORP PAYROLL", 145000],
  ["10/09/2026", "SPOTIFY USA", -1199],
  ["10/14/2026", "NETFLIX.COM", -1549],
];
// The newer statement starts Oct 1, so it repeats four of the older one's rows.
const NEWER: Row[] = [
  ...OLDER.slice(2),
  ["10/16/2026", "ACME CORP PAYROLL", 145000],
  ["11/01/2026", "AVALON APTS RENT", -120000],
  ["11/13/2026", "ACME CORP PAYROLL", 145000],
];
// The older file opens at $2,000.00 and ends at $2,000 - 1,200 + 1,450 - 1,200 + 1,450 - 11.99 - 15.49.
// The newer file opens where the older one stood after Sep 4.
const NEWER_OPEN = 200000 - 120000 + 145000;
const OLDER_CLOSE = 200000 - 120000 + 145000 - 120000 + 145000 - 1199 - 1549;

function form(fields: Record<string, string>, name: string, text: string) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  data.append("files", new File([text], name, { type: "text/csv" }));
  return data;
}

describe.runIf(url)("taking back one of two overlapping statements", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (await client.user.create({ data: { email: "remove-overlap-d3@example.com" } })).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  const balanceOf = async (accountId: string) =>
    (await client.account.findUniqueOrThrow({ where: { id: accountId } })).currentBalanceCents;
  const fileDays = async (accountId: string) =>
    (
      await client.balanceSnapshot.findMany({
        where: { accountId, source: "file" },
        orderBy: { date: "asc" },
        select: { date: true },
      })
    ).map((s) => s.date.toISOString().slice(0, 10));

  it("puts back the older statement's balance, and keeps its own balances", async () => {
    const db = scopedFor(userId, client);
    const older = await saveUpload(
      db,
      form(
        { accountId: "new", "new.name": "Chase checking", "new.kind": "checking" },
        "aug-oct.csv",
        chase(OLDER, 200000),
      ),
    );
    if (!older.ok) throw new Error(older.error);
    expect(await balanceOf(older.accountId)).toBe(OLDER_CLOSE);
    const olderDays = await fileDays(older.accountId);

    // The same file again adds nothing, and isn't listed as a second upload.
    const again = await saveUpload(
      db,
      form({ accountId: older.accountId }, "aug-oct.csv", chase(OLDER, 200000)),
    );
    if (!again.ok) throw new Error(again.error);
    expect(again.counts.inserted).toBe(0);
    expect((await listUploads(db)).uploads.map((u) => u.id)).toEqual([older.runId]);
    // Taking that copy back anyway leaves the first one's balances where they were.
    await removeUpload(db, again.runId);
    expect(await fileDays(older.accountId)).toEqual(olderDays);

    const newer = await saveUpload(
      db,
      form({ accountId: older.accountId }, "oct-nov.csv", chase(NEWER, NEWER_OPEN)),
    );
    if (!newer.ok) throw new Error(newer.error);
    expect(newer.counts.inserted).toBe(3);
    expect(await balanceOf(older.accountId)).not.toBe(OLDER_CLOSE);

    await removeUpload(db, newer.runId);
    expect(await balanceOf(older.accountId)).toBe(OLDER_CLOSE);
    expect(await fileDays(older.accountId)).toEqual(olderDays);
  });
});
