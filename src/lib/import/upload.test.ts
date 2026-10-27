import { beforeEach, describe, expect, it, vi } from "vitest";

const { importCsvFiles, enqueueJob, keepFileBalances } = vi.hoisted(() => ({
  importCsvFiles: vi.fn(),
  enqueueJob: vi.fn(),
  keepFileBalances: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/jobs", () => ({ enqueueJob }));
vi.mock("@/lib/import/balances", () => ({ keepFileBalances }));
vi.mock("@/lib/import/import-csv", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/import/import-csv")>()),
  importCsvFiles,
}));

import { saveUpload } from "./upload";
import { CsvFormatError } from "@/data-sources/csv/csv-source";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import type { ScopedDb } from "@/lib/db-scoped";

const CHASE_CARD =
  "Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n" +
  "10/12/2026,10/13/2026,Spotify USA,Entertainment,Sale,-11.99,\n";

function form(fields: Record<string, string | File[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((file) => data.append(key, file));
    else data.set(key, value);
  }
  return data;
}

const csv = (name: string, text = CHASE_CARD) => new File([text], name, { type: "text/csv" });
const counts = { parsed: 1, inserted: 1, duplicates: 0, skipped: 0 };

const accountsCreate = vi.fn();
const accountsDelete = vi.fn();
const importRunsCreate = vi.fn();
const db = {
  userId: "user_1",
  accounts: { create: accountsCreate, delete: accountsDelete },
  importRuns: { create: importRunsCreate },
} as unknown as ScopedDb;
const BALANCES = [{ date: "2026-10-13", balanceCents: 248451 }];

beforeEach(() => {
  accountsCreate.mockReset().mockResolvedValue({ id: "acct_new" });
  accountsDelete.mockReset().mockResolvedValue({});
  importCsvFiles.mockReset().mockResolvedValue({
    ...counts,
    files: [{ format: "chase_credit_card", rows: 1 }],
    balances: BALANCES,
  });
  enqueueJob.mockReset().mockResolvedValue("job_1");
  keepFileBalances.mockReset().mockResolvedValue(1);
  importRunsCreate.mockReset().mockResolvedValue({ id: "run_1" });
  vi.mocked(track).mockReset();
  vi.mocked(logAudit).mockReset();
});

describe("saveUpload", () => {
  it("saves into the chosen account with the file's balances, records it and queues the rest", async () => {
    const stages: unknown[] = [];
    const result = await saveUpload(db, form({ accountId: "acct_1", files: [csv("card.csv")] }), {
      onStage: (stage) => stages.push(stage),
    });

    expect(result).toEqual({
      ok: true,
      accountId: "acct_1",
      counts,
      runId: "run_1",
      jobId: "job_1",
    });
    expect(keepFileBalances).toHaveBeenCalledWith(db, "acct_1", BALANCES);
    expect(importRunsCreate).toHaveBeenCalledWith({
      data: { userId: "user_1", rows: 1 },
      select: { id: true },
    });
    expect(stages[0]).toEqual({ stage: "reading" });
    expect(importCsvFiles).toHaveBeenCalledWith(
      db,
      "acct_1",
      [{ name: "card.csv", text: CHASE_CARD }],
      expect.objectContaining({ onStage: expect.any(Function) }),
    );
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: "user_1" },
      "import_completed",
      { type: "account", id: "acct_1" },
      { ...counts, files: 1 },
    );
    expect(track).toHaveBeenCalledWith("user_1", "import_completed", { ...counts, files: 1 });
    // The format and row count only: nothing from the file itself.
    expect(track).toHaveBeenCalledWith("user_1", "upload_succeeded", {
      format: "chase_credit_card",
      rows: 1,
    });
    // Everything else is a job for after the response.
    expect(enqueueJob).toHaveBeenCalledWith("import_finish", {
      userId: "user_1",
      importRunId: "run_1",
    });
  });

  it("returns a readable error and tracks the failure for an unknown format", async () => {
    importCsvFiles.mockRejectedValue(
      new CsvFormatError([{ file: "x.csv", error: "Unknown format." }]),
    );

    const result = await saveUpload(db, form({ accountId: "acct_1", files: [csv("x.csv")] }));

    expect(result).toEqual({ ok: false, error: "x.csv: Unknown format." });
    expect(track).toHaveBeenCalledWith("user_1", "import_failed", { reason: "unknown_format" });
    expect(track).toHaveBeenCalledWith("user_1", "upload_failed", { reason: "unknown_format" });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("asks for a file when none was chosen", async () => {
    expect(await saveUpload(db, form({ accountId: "acct_1" }))).toEqual({
      ok: false,
      error: "Choose at least one statement file.",
    });
    expect(track).toHaveBeenCalledWith("user_1", "upload_failed", { reason: "no_file" });
  });
});

describe("saveUpload into a new account", () => {
  const fields = { accountId: "new", "new.name": "Chase card", "new.kind": "credit_card" };

  it("makes the account from the file, with no balance needed, then imports into it", async () => {
    const result = await saveUpload(
      db,
      form({ ...fields, "new.balance": "", files: [csv("card.csv")] }),
    );
    expect(result).toMatchObject({ ok: true, accountId: "acct_new" });
    expect(accountsCreate).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        source: "csv",
        name: "Chase card",
        type: "credit",
        subtype: "credit card",
        currentBalanceCents: null,
      },
    });
    expect(importCsvFiles).toHaveBeenCalledWith(db, "acct_new", expect.any(Array), {
      onStage: undefined,
    });
  });

  it("keeps a balance when one is given", async () => {
    await saveUpload(db, form({ ...fields, "new.balance": "812.40", files: [csv("card.csv")] }));
    expect(accountsCreate.mock.calls[0][0].data.currentBalanceCents).toBe(81240);
  });

  it("makes no account when a file can't be read", async () => {
    const result = await saveUpload(
      db,
      form({ ...fields, files: [csv("other.csv", "Date,Payee,Debit\nx,Coffee,1\n")] }),
    );
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/^other\.csv: /) });
    expect(accountsCreate).not.toHaveBeenCalled();
    expect(importCsvFiles).not.toHaveBeenCalled();
  });

  it("removes the new account again if the import fails", async () => {
    importCsvFiles.mockRejectedValue(new CsvFormatError([{ file: "x.csv", error: "Unknown." }]));
    const result = await saveUpload(db, form({ ...fields, files: [csv("card.csv")] }));
    expect(result).toEqual({ ok: false, error: "x.csv: Unknown." });
    expect(accountsDelete).toHaveBeenCalledWith({ where: { id: "acct_new" } });
  });

  it("asks for a name and type", async () => {
    expect(
      await saveUpload(
        db,
        form({
          accountId: "new",
          "new.name": "",
          "new.kind": "checking",
          files: [csv("card.csv")],
        }),
      ),
    ).toEqual({ ok: false, error: "Give the account a name (up to 60 characters)." });
    expect(accountsCreate).not.toHaveBeenCalled();
  });
});
