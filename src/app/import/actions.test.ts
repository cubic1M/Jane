import { beforeEach, describe, expect, it, vi } from "vitest";

const { accountsCreate, importCsvFiles, runDetection, explainFindings, afterCallbacks } =
  vi.hoisted(() => ({
    explainFindings: vi.fn(),
    afterCallbacks: [] as (() => Promise<void>)[],
    accountsCreate: vi.fn(),
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
  scopedDb: vi.fn(async () => ({ userId: "user_1", accounts: { create: accountsCreate } })),
}));
vi.mock("@/detection/engine", () => ({ runDetection }));
vi.mock("@/lib/explanations", () => ({ explainFindings }));
vi.mock("next/server", () => ({
  after: vi.fn((callback: () => Promise<void>) => afterCallbacks.push(callback)),
}));
vi.mock("@/lib/import/import-csv", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/import/import-csv")>()),
  importCsvFiles,
}));

import { confirmImport, createCsvAccount, previewImport } from "./actions";
import { CsvFormatError } from "@/data-sources/csv/csv-source";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";

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
  accountsCreate.mockReset().mockResolvedValue({});
  importCsvFiles.mockReset();
  runDetection.mockReset().mockResolvedValue({});
  explainFindings.mockReset().mockResolvedValue({});
  afterCallbacks.length = 0;
  vi.mocked(track).mockReset();
  vi.mocked(logAudit).mockReset();
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
      error: "Choose at least one CSV file.",
    });
  });
});

describe("confirmImport", () => {
  it("imports, audit-logs the counts, tracks import_completed and moves to /scanning", async () => {
    const counts = { parsed: 1, inserted: 1, duplicates: 0, skipped: 0 };
    importCsvFiles.mockResolvedValue(counts);

    await expect(
      confirmImport(form({ accountId: "acct_1", files: [csv("card.csv")] })),
    ).rejects.toThrow("redirect:/scanning");

    expect(importCsvFiles).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_1" }),
      "acct_1",
      [{ name: "card.csv", text: CHASE_CARD }],
    );
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: "user_1" },
      "import_completed",
      { type: "account", id: "acct_1" },
      { ...counts, files: 1 },
    );
    expect(track).toHaveBeenCalledWith("user_1", "import_completed", { ...counts, files: 1 });
    expect(runDetection).toHaveBeenCalledWith("user_1");
  });

  it("explains the findings after responding", async () => {
    importCsvFiles.mockResolvedValue({ parsed: 1, inserted: 1, duplicates: 0, skipped: 0 });

    await expect(
      confirmImport(form({ accountId: "acct_1", files: [csv("card.csv")] })),
    ).rejects.toThrow("redirect:/scanning");
    expect(explainFindings).not.toHaveBeenCalled();

    explainFindings.mockRejectedValueOnce(new Error("database hiccup"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const callback of afterCallbacks) await callback();
    expect(explainFindings).toHaveBeenCalledWith("user_1");
  });

  it("still moves to /scanning when detection fails after a successful import", async () => {
    importCsvFiles.mockResolvedValue({ parsed: 1, inserted: 1, duplicates: 0, skipped: 0 });
    runDetection.mockRejectedValue(new Error("database hiccup"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      confirmImport(form({ accountId: "acct_1", files: [csv("card.csv")] })),
    ).rejects.toThrow("redirect:/scanning");
    expect(logAudit).toHaveBeenCalled();
  });

  it("returns a readable error and tracks import_failed for an unknown format", async () => {
    importCsvFiles.mockRejectedValue(
      new CsvFormatError([{ file: "x.csv", error: "Unknown format." }]),
    );

    const result = await confirmImport(form({ accountId: "acct_1", files: [csv("x.csv")] }));

    expect(result).toEqual({ ok: false, error: "x.csv: Unknown format." });
    expect(track).toHaveBeenCalledWith("user_1", "import_failed", { reason: "unknown_format" });
    expect(logAudit).not.toHaveBeenCalled();
    expect(runDetection).not.toHaveBeenCalled();
  });
});
