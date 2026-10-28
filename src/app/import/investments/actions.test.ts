import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  canImportCsv,
  importPositionsFiles,
  previewPositionsFiles,
  refreshAfterUpload,
  afterCallbacks,
} = vi.hoisted(() => ({
  canImportCsv: vi.fn(),
  importPositionsFiles: vi.fn(),
  previewPositionsFiles: vi.fn(),
  refreshAfterUpload: vi.fn(),
  afterCallbacks: [] as (() => unknown)[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({
  after: vi.fn((callback: () => unknown) => afterCallbacks.push(callback)),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "user_1" })) }));
vi.mock("@/lib/csv-access", () => ({ canImportCsv }));
vi.mock("@/lib/db-scoped", () => ({ scopedDb: vi.fn(async () => ({ userId: "user_1" })) }));
vi.mock("@/lib/import/background", () => ({ refreshAfterUpload }));
vi.mock("@/lib/import/positions", () => ({ importPositionsFiles, previewPositionsFiles }));

import { importPositions, previewPositions } from "./actions";
import { track } from "@/lib/analytics";
import { NOT_ALLOWED } from "@/lib/import/upload";

function form(fields: Record<string, string> = {}, text = "Account Number,Investment Name\n") {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  data.append("files", new File([text], "ofxdownload.csv", { type: "text/csv" }));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  canImportCsv.mockReturnValue(true);
});

describe("previewPositions", () => {
  it("is only for people who may upload (not sample data)", async () => {
    canImportCsv.mockReturnValue(false);
    expect(await previewPositions(form())).toEqual({ ok: false, error: NOT_ALLOWED });
    expect(previewPositionsFiles).not.toHaveBeenCalled();
  });

  it("previews the files in memory and counts a file it can't read as a failed upload", async () => {
    previewPositionsFiles.mockResolvedValue([{ ok: false, file: "x.csv", error: "nope" }]);
    const result = await previewPositions(form());
    expect(result).toEqual({ ok: true, files: [{ ok: false, file: "x.csv", error: "nope" }] });
    const [, files] = previewPositionsFiles.mock.calls[0];
    expect(files).toEqual([{ name: "ofxdownload.csv", text: "Account Number,Investment Name\n" }]);
    expect(track).toHaveBeenCalledWith("user_1", "upload_failed", { reason: "unknown_format" });
  });

  it("says so when no file was chosen", async () => {
    const result = await previewPositions(new FormData());
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/Choose/) });
  });
});

describe("importPositions", () => {
  it("passes the account types picked and refreshes the checks after the response", async () => {
    importPositionsFiles.mockResolvedValue({ ok: true, accounts: 1, holdings: 2, valueCents: 100 });
    const result = await importPositions(form({ "subtype.vanguard:00000004": "roth", other: "x" }));
    expect(result).toEqual({ ok: true, accounts: 1, holdings: 2, valueCents: 100 });
    expect(importPositionsFiles.mock.calls[0][2]).toEqual({
      subtypes: { "vanguard:00000004": "roth" },
    });
    expect(refreshAfterUpload).not.toHaveBeenCalled();
    await Promise.all(afterCallbacks.map((c) => c()));
    expect(refreshAfterUpload).toHaveBeenCalledWith("user_1");
  });

  it("returns the file's problem and refreshes nothing", async () => {
    importPositionsFiles.mockResolvedValue({ ok: false, error: "x.csv: nope" });
    expect(await importPositions(form())).toEqual({ ok: false, error: "x.csv: nope" });
    expect(afterCallbacks).toHaveLength(0);
  });

  it("is only for people who may upload", async () => {
    canImportCsv.mockReturnValue(false);
    expect(await importPositions(form())).toEqual({ ok: false, error: NOT_ALLOWED });
    expect(importPositionsFiles).not.toHaveBeenCalled();
  });
});
