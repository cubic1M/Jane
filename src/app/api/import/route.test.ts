import { beforeEach, describe, expect, it, vi } from "vitest";

const { afterWork } = vi.hoisted(() => ({ afterWork: [] as Promise<unknown>[] }));

vi.mock("@/lib/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/db-scoped", () => ({ scopedFor: vi.fn(() => ({ userId: "u1" })) }));
vi.mock("@/detection/engine", () => ({ moneyFound: vi.fn() }));
vi.mock("@/lib/import/upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/import/upload")>()),
  saveUpload: vi.fn(),
  detectAfterUpload: vi.fn(),
  finishUpload: vi.fn(),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn((work: Promise<unknown>) => afterWork.push(work)),
}));

import { TERMS_VERSION } from "@/config/legal";
import { moneyFound } from "@/detection/engine";
import { detectAfterUpload, finishUpload, saveUpload } from "@/lib/import/upload";
import { getCurrentUser } from "@/lib/session";
import { POST } from "./route";

// Importing an upload, with each step streamed to the progress bar: one JSON object per line.

const post = (headers: Record<string, string> = { "x-jane-import": "1" }) => {
  const body = new FormData();
  body.set("accountId", "acct_1");
  body.append("files", new File(["a,b,c\n"], "card.csv", { type: "text/csv" }));
  return POST(new Request("http://localhost/api/import", { method: "POST", headers, body }));
};
const lines = async (response: Response) =>
  (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

describe("POST /api/import", () => {
  beforeEach(() => {
    afterWork.length = 0;
    vi.mocked(getCurrentUser)
      .mockReset()
      .mockResolvedValue({ id: "u1", termsVersion: TERMS_VERSION } as never);
    vi.mocked(saveUpload)
      .mockReset()
      .mockImplementation(async (_db, _form, options) => {
        options?.onStage?.({ stage: "reading" });
        options?.onStage?.({ stage: "sorting", rows: 172 });
        options?.onStage?.({ stage: "saving" });
        return {
          ok: true,
          accountId: "acct_1",
          counts: { parsed: 172, inserted: 172, duplicates: 0, skipped: 0 },
          jobId: "job_1",
        };
      });
    vi.mocked(detectAfterUpload).mockReset().mockResolvedValue(true);
    vi.mocked(finishUpload).mockReset().mockResolvedValue();
    vi.mocked(moneyFound).mockReset().mockResolvedValue(48000);
  });

  it("streams each step, then the money found and where to go", async () => {
    const response = await post();
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(await lines(response)).toEqual([
      { stage: "reading" },
      { stage: "sorting", rows: 172 },
      { stage: "saving" },
      { stage: "looking" },
      { type: "done", foundCents: 48000, next: "/report" },
    ]);
    expect(detectAfterUpload).toHaveBeenCalledWith("u1");
  });

  it("keeps working after the response: Claude's sorting, the card text, Jane's message", async () => {
    await lines(await post());
    await Promise.all(afterWork);
    expect(finishUpload).toHaveBeenCalledWith("u1", "job_1");
    // Only once the findings were sent.
    expect(vi.mocked(detectAfterUpload).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(finishUpload).mock.invocationCallOrder[0],
    );
  });

  it("says what's wrong with the upload, and looks for nothing", async () => {
    vi.mocked(saveUpload).mockResolvedValue({ ok: false, error: "card.csv: The file is empty." });
    expect(await lines(await post())).toEqual([
      { type: "error", text: "card.csv: The file is empty." },
    ]);
    expect(detectAfterUpload).not.toHaveBeenCalled();
    expect(finishUpload).not.toHaveBeenCalled();
  });

  it("answers a crash with a plain error line", async () => {
    vi.mocked(saveUpload).mockRejectedValue(new Error("database down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await lines(await post())).toEqual([
      { type: "error", text: "Something went wrong saving your upload. Try again." },
    ]);
  });

  it("refuses people who aren't signed in, haven't accepted the Terms, or are trial people", async () => {
    vi.mocked(getCurrentUser).mockResolvedValueOnce(null);
    expect((await post()).status).toBe(401);
    vi.mocked(getCurrentUser).mockResolvedValueOnce({ id: "u1", termsVersion: "old" } as never);
    expect((await post()).status).toBe(403);
    vi.mocked(getCurrentUser).mockResolvedValueOnce({
      id: "trial_abc",
      termsVersion: TERMS_VERSION,
    } as never);
    expect((await post()).status).toBe(403);
    expect(saveUpload).not.toHaveBeenCalled();
  });

  it("refuses a post without the page's header, so another site's form can't upload", async () => {
    const response = await post({});
    expect(response.status).toBe(400);
    expect(saveUpload).not.toHaveBeenCalled();
  });
});
