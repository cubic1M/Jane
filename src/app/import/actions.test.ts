import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  accountsCreate,
  accountsDelete,
  importCsvFiles,
  runDetection,
  enqueueJob,
  runJob,
  afterCallbacks,
} = vi.hoisted(() => ({
  enqueueJob: vi.fn(),
  runJob: vi.fn(),
  afterCallbacks: [] as (() => Promise<void>)[],
  accountsCreate: vi.fn(),
  accountsDelete: vi.fn(),
  importCsvFiles: vi.fn(),
  runDetection: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/db-scoped", () => ({
  scopedDb: vi.fn(async () => ({
    userId: "user_1",
    accounts: { create: accountsCreate, delete: accountsDelete },
  })),
}));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "user_1" })) }));
vi.mock("@/lib/csv-access", () => ({ canImportCsv: vi.fn() }));
vi.mock("@/detection/engine", () => ({ runDetection }));
vi.mock("@/lib/jobs", () => ({ enqueueJob, runJob }));
vi.mock("@/lib/jane-agent/run", () => ({ runJaneAgentSafely: vi.fn() }));
vi.mock("next/server", () => ({
  after: vi.fn((callback: () => Promise<void>) => afterCallbacks.push(callback)),
}));
vi.mock("@/lib/import/upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/import/upload")>()),
  saveUpload: vi.fn(),
}));
vi.mock("@/lib/import/background", () => ({ dismissImportRun: vi.fn() }));
vi.mock("@/lib/import/import-csv", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/import/import-csv")>()),
  importCsvFiles,
}));

import { createCsvAccount, dismissImport, previewImport, startImport } from "./actions";
import { dismissImportRun } from "@/lib/import/background";
import { saveUpload } from "@/lib/import/upload";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { canImportCsv } from "@/lib/csv-access";

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

beforeEach(() => {
  accountsCreate.mockReset().mockResolvedValue({ id: "acct_new" });
  accountsDelete.mockReset().mockResolvedValue({});
  importCsvFiles.mockReset();
  runDetection.mockReset().mockResolvedValue({});
  enqueueJob.mockReset().mockResolvedValue("job_1");
  runJob.mockReset().mockResolvedValue("done");
  afterCallbacks.length = 0;
  vi.mocked(track).mockReset();
  vi.mocked(logAudit).mockReset();
  vi.mocked(canImportCsv).mockReset().mockReturnValue(true);
});

describe("CSV access", () => {
  it("refuses trial people (sample data)", async () => {
    vi.mocked(canImportCsv).mockReturnValue(false);

    for (const result of [
      await createCsvAccount(null, form({ name: "Card", kind: "credit_card" })),
      await previewImport(form({ files: [csv("card.csv")] })),
    ]) {
      expect(result).toEqual({
        ok: false,
        error: expect.stringContaining("Sign up to upload yours"),
      });
    }
    expect(accountsCreate).not.toHaveBeenCalled();
    expect(importCsvFiles).not.toHaveBeenCalled();
  });
});

describe("createCsvAccount", () => {
  it("creates a CSV account with Plaid's type names and the balance in cents", async () => {
    const result = await createCsvAccount(
      null,
      form({ name: " Sapphire ", kind: "credit_card", balance: "1,234.56" }),
    );

    expect(result).toEqual({ ok: true });
    expect(accountsCreate).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        source: "csv",
        name: "Sapphire",
        type: "credit",
        subtype: "credit card",
        currentBalanceCents: 123456,
      },
    });
  });

  it("allows leaving the balance empty", async () => {
    await createCsvAccount(null, form({ name: "Savings", kind: "savings", balance: "" }));

    expect(accountsCreate.mock.calls[0][0].data.currentBalanceCents).toBeNull();
  });

  it.each([
    [{ name: "", kind: "checking", balance: "" }, "name"],
    [{ name: "X", kind: "brokerage", balance: "" }, "checking, savings or credit card"],
    [{ name: "X", kind: "checking", balance: "lots" }, "as a number"],
  ])("rejects bad input %j", async (fields, message) => {
    const result = await createCsvAccount(null, form(fields));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(message);
    expect(accountsCreate).not.toHaveBeenCalled();
  });
});

describe("previewImport", () => {
  it("previews uploads and tracks import_started", async () => {
    const result = await previewImport(form({ files: [csv("card.csv")] }));

    expect(result.ok && result.files[0]).toMatchObject({ ok: true, rowCount: 1 });
    expect(track).toHaveBeenCalledWith("user_1", "import_started", { files: 1 });
  });

  it("tracks import_failed for files in an unknown format", async () => {
    const result = await previewImport(form({ files: [csv("other.csv", "Date,Payee\n1,2\n")] }));

    expect(result.ok && result.files[0].ok).toBe(false);
    expect(track).toHaveBeenCalledWith("user_1", "import_failed", {
      reason: "unknown_format",
      files: 1,
    });
  });

  it("asks for a file when none was chosen", async () => {
    expect(await previewImport(form({}))).toEqual({
      ok: false,
      error: "Choose at least one statement file.",
    });
    expect(track).toHaveBeenCalledWith("user_1", "upload_failed", { reason: "no_file" });
  });

  it("tracks upload_started, and upload_failed with only the reason", async () => {
    await previewImport(form({ files: [csv("other.csv", "Date,Payee,Debit\nx,Coffee,1\n")] }));

    expect(track).toHaveBeenCalledWith("user_1", "upload_started");
    expect(track).toHaveBeenCalledWith("user_1", "upload_failed", { reason: "unknown_format" });
  });

  it("refuses a web page saved as .csv before the picker, and says what to do", async () => {
    const result = await previewImport(
      form({ files: [csv("statement.csv", "<!doctype html><html><body>Sign in</body></html>")] }),
    );
    expect(result.ok && result.files[0]).toEqual({
      file: "statement.csv",
      ok: false,
      error: "This isn't a CSV statement. Download the CSV from your bank's website.",
      reason: "not_csv",
    });
    expect(track).toHaveBeenCalledWith("user_1", "upload_failed", { reason: "not_csv" });
  });

  it("suggests the new account's name and type from the file", async () => {
    const result = await previewImport(form({ files: [csv("card.csv")] }));
    expect(result.ok && result.files[0]).toMatchObject({
      ok: true,
      account: { name: "Chase card", kind: "credit_card" },
    });
  });

  it("offers the column picker for an unknown layout, then reads it with the picked columns", async () => {
    const text = "Booked,Narrative,Value\n2026-09-27,COFFEE PLACE,-4.50\n";
    const first = await previewImport(form({ files: [csv("bank.csv", text)] }));
    expect(first.ok && first.files[0]).toMatchObject({
      ok: false,
      reason: "unknown_format",
      choices: { hasHeader: true, guess: { date: 0 } },
    });

    const picked = await previewImport(
      form({
        files: [csv("bank.csv", text)],
        "map.0.date": "0",
        "map.0.description": "1",
        "map.0.amount": "2",
        "map.0.out": "negative",
        "map.0.header": "1",
      }),
    );
    expect(picked.ok && picked.files[0]).toMatchObject({
      ok: true,
      formatId: "custom",
      rowCount: 1,
      from: "2026-09-27",
      to: "2026-09-27",
      sample: [{ date: "2026-09-27", description: "COFFEE PLACE", amountCents: 450 }],
    });
  });

  it("says which column is missing in the picker", async () => {
    const result = await previewImport(
      form({ files: [csv("bank.csv", "a,b\n")], "map.0.date": "0" }),
    );
    expect(result).toEqual({ ok: false, error: "bank.csv: Pick the description column." });
    expect(track).toHaveBeenCalledWith("user_1", "upload_failed", { reason: "bad_columns" });
  });
});

describe("startImport", () => {
  it("saves the rows, starts the rest after the response and returns at once", async () => {
    vi.mocked(saveUpload).mockResolvedValue({
      ok: true,
      accountId: "acct_1",
      counts: { parsed: 172, inserted: 172, duplicates: 0, skipped: 0 },
      runId: "run_1",
      jobId: "job_1",
    });
    expect(await startImport(form({ accountId: "acct_1", files: [csv("card.csv")] }))).toEqual({
      ok: true,
      runId: "run_1",
      rows: 172,
    });
    // Nothing ran yet: the job starts once the response is sent.
    expect(runJob).not.toHaveBeenCalled();
    for (const callback of afterCallbacks) await callback();
    expect(runJob).toHaveBeenCalledWith("job_1");
  });

  it("passes on what's wrong with the upload, and starts nothing", async () => {
    vi.mocked(saveUpload).mockResolvedValue({ ok: false, error: "card.csv: The file is empty." });
    expect(await startImport(form({ files: [csv("card.csv")] }))).toEqual({
      ok: false,
      error: "card.csv: The file is empty.",
    });
    expect(afterCallbacks).toHaveLength(0);
  });

  it("refuses trial people", async () => {
    vi.mocked(canImportCsv).mockReturnValue(false);
    expect(await startImport(form({ files: [csv("card.csv")] }))).toEqual({
      ok: false,
      error: expect.stringContaining("Sign up to upload yours"),
    });
    expect(saveUpload).not.toHaveBeenCalled();
  });
});

describe("dismissImport", () => {
  it("closes the chip for the signed-in person's own upload", async () => {
    await dismissImport("run_1");
    expect(dismissImportRun).toHaveBeenCalledWith("user_1", "run_1");
  });
});
