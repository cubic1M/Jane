import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/categorize/llm", () => ({ classifyMerchants: vi.fn(async () => new Map()) }));

import { AccountNotFoundError, importCsvFiles, previewCsvFiles } from "./import-csv";
import { CsvFormatError } from "@/data-sources/csv/csv-source";
import type { ScopedDb } from "@/lib/db-scoped";

function fixture(name: string) {
  const url = new URL(`../../data-sources/csv/__fixtures__/${name}`, import.meta.url);
  return { name, text: readFileSync(url, "utf8") };
}

const CSV_ACCOUNT = {
  id: "acct_1",
  source: "csv",
  name: "Chase checking",
  type: "depository",
  subtype: "checking",
  mask: null,
  currentBalanceCents: 250000,
};

const findUnique = vi.fn();
const createMany = vi.fn();
const findManyAccounts = vi.fn(async () => [{ id: "acct_1", type: "depository" }]);
const db = {
  userId: "user_1",
  accounts: { findUnique, findMany: findManyAccounts },
  transactions: { createMany, findMany: vi.fn(async () => []), updateMany: vi.fn() },
  merchantCategories: { findMany: vi.fn(async () => []), createMany: vi.fn() },
} as unknown as ScopedDb;

describe("previewCsvFiles", () => {
  it("summarizes each file without storing anything", () => {
    const [checking, unknown] = previewCsvFiles([
      fixture("chase-checking.csv"),
      fixture("unknown-bank.csv"),
    ]);

    expect(checking).toMatchObject({ ok: true, format: "Chase checking or savings", rowCount: 9 });
    expect(checking.ok && checking.sample[0]).toEqual({
      date: "2026-10-14",
      description: "NETFLIX.COM NETFLIX.COM CA 10/14",
      amountCents: 1549,
    });
    expect(checking.ok && checking.skipped).toHaveLength(1);
    expect(unknown).toMatchObject({ ok: false, file: "unknown-bank.csv" });
  });
});

describe("importCsvFiles", () => {
  beforeEach(() => {
    findUnique.mockReset().mockResolvedValue(CSV_ACCOUNT);
    createMany.mockReset().mockImplementation(async ({ data }) => ({ count: data.length }));
  });

  it("stores categorized transactions with dedupe keys and skips duplicates", async () => {
    const counts = await importCsvFiles(db, "acct_1", [fixture("chase-checking.csv")]);

    expect(counts).toEqual({
      parsed: 9,
      inserted: 9,
      duplicates: 0,
      skipped: 1,
      // For upload_succeeded: each file's format and transaction count.
      files: [{ format: "chase_checking", rows: 9 }],
    });
    const { data, skipDuplicates } = createMany.mock.calls[0][0];
    expect(skipDuplicates).toBe(true);
    expect(data[0]).toEqual({
      userId: "user_1",
      accountId: "acct_1",
      source: "csv",
      dedupeKey: expect.stringMatching(/^[0-9a-f]{32}$/),
      date: new Date("2026-10-14T00:00:00Z"),
      amountCents: 1549,
      description: "NETFLIX.COM NETFLIX.COM CA 10/14",
      merchantName: "Netflix",
      pfcPrimary: "ENTERTAINMENT",
      pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
      categorySource: "rule",
      pending: false,
    });
  });

  it("reports rows the database already had as duplicates", async () => {
    createMany.mockResolvedValue({ count: 0 });

    expect(await importCsvFiles(db, "acct_1", [fixture("chase-checking.csv")])).toEqual({
      parsed: 9,
      inserted: 0,
      duplicates: 9,
      skipped: 1,
      files: [{ format: "chase_checking", rows: 9 }],
    });
  });

  it("sends the same keys when the same file is imported twice", async () => {
    await importCsvFiles(db, "acct_1", [fixture("chase-checking.csv")]);
    await importCsvFiles(db, "acct_1", [fixture("chase-checking.csv")]);

    const keys = (call: number) =>
      createMany.mock.calls[call][0].data.map((d: { dedupeKey: string }) => d.dedupeKey);
    expect(keys(1)).toEqual(keys(0));
  });

  it("drops rows repeated across files in the same upload", async () => {
    const counts = await importCsvFiles(db, "acct_1", [
      fixture("chase-checking.csv"),
      fixture("chase-checking.csv"),
    ]);

    expect(counts.parsed).toBe(9);
  });

  it("refuses accounts that aren't the user's CSV accounts", async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(
      importCsvFiles(db, "nope", [fixture("chase-checking.csv")]),
    ).rejects.toBeInstanceOf(AccountNotFoundError);

    findUnique.mockResolvedValueOnce({ ...CSV_ACCOUNT, source: "plaid" });
    await expect(
      importCsvFiles(db, "acct_1", [fixture("chase-checking.csv")]),
    ).rejects.toBeInstanceOf(AccountNotFoundError);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("stores nothing when a file has an unknown format", async () => {
    await expect(
      importCsvFiles(db, "acct_1", [fixture("chase-checking.csv"), fixture("unknown-bank.csv")]),
    ).rejects.toBeInstanceOf(CsvFormatError);
    expect(createMany).not.toHaveBeenCalled();
  });
});
