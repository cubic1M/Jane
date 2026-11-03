import { beforeEach, describe, expect, it, vi } from "vitest";

const { jar, headerValues, afterJobs } = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  headerValues: new Map<string, string>(),
  afterJobs: [] as (() => Promise<unknown>)[],
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
  headers: async () => new Headers([...headerValues]),
}));
vi.mock("next/server", () => ({ after: (job: () => Promise<unknown>) => afterJobs.push(job) }));
vi.mock("@/lib/rate-limit", () => ({
  hit: vi.fn(),
  giveBack: vi.fn(),
  ipKey: vi.fn(() => "iphash"),
}));
vi.mock("@/lib/statement-trial", () => ({
  sessionOwner: vi.fn(),
  startStatementPerson: vi.fn(),
  statementTrialEnabled: vi.fn(() => true),
}));
vi.mock("@/lib/trial", () => ({ cleanUpTrials: vi.fn(async () => 0) }));
vi.mock("@/lib/trial-delete", () => ({ deleteTrialPerson: vi.fn(async () => true) }));
vi.mock("@/lib/import/upload", () => ({ saveUpload: vi.fn() }));
vi.mock("@/lib/jobs", () => ({ runJob: vi.fn(async () => "done") }));
vi.mock("@/lib/db-scoped", () => ({ scopedFor: vi.fn((id: string) => ({ userId: id })) }));

import { STATEMENT_TRIAL_BUSY, STATEMENT_TRIAL_MAX_FILE_BYTES } from "@/config/statement-trial";
import { saveUpload } from "@/lib/import/upload";
import { runJob } from "@/lib/jobs";
import { giveBack, hit } from "@/lib/rate-limit";
import { sessionOwner, startStatementPerson, statementTrialEnabled } from "@/lib/statement-trial";
import { deleteTrialPerson } from "@/lib/trial-delete";
import { madeUpChaseCsv } from "@/lib/__fixtures__/made-up-statement";
import { startOverTry, tryWithStatement } from "./statement-actions";

// The landing page's "Try it with your own statement": agreed to first, limited, read in memory
// before anyone is made, and it never touches a real person.

const COOKIE = "authjs.session-token";
const EXPIRES = new Date("2026-11-03T15:00:00Z");
const OK = { ok: true, remaining: 1, retryAfterSeconds: 0 };

function submitted(file: File | null, consent = true) {
  const data = new FormData();
  if (consent) data.set("consent", "on");
  if (file) data.set("file", file);
  return data;
}
const statement = () => new File([madeUpChaseCsv("ZZFORM")], "statement.csv", { type: "text/csv" });

describe("tryWithStatement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jar.clear();
    headerValues.clear();
    afterJobs.length = 0;
    vi.mocked(statementTrialEnabled).mockReturnValue(true);
    vi.mocked(hit).mockResolvedValue(OK);
    vi.mocked(sessionOwner).mockResolvedValue(null);
    vi.mocked(startStatementPerson).mockResolvedValue({
      userId: "trial_own_new",
      sessionToken: "trial_token",
      expires: EXPIRES,
    });
    vi.mocked(saveUpload).mockResolvedValue({
      ok: true,
      accountId: "a1",
      counts: {} as never,
      runId: "r1",
      jobId: "j1",
    });
  });

  it("makes a person, signs them in with no email, saves the statement and scans", async () => {
    headerValues.set("user-agent", "Browser");
    expect(await tryWithStatement(null, submitted(statement()))).toEqual({ next: "/scanning" });
    expect(startStatementPerson).toHaveBeenCalledWith({ userAgent: "Browser", previous: null });
    expect(jar.get(COOKIE)).toBe("trial_token");
    // Into the new person, a new account named from the file; nothing else is stored from it.
    const [db, form] = vi.mocked(saveUpload).mock.calls[0];
    expect(db).toEqual({ userId: "trial_own_new" });
    expect(form.get("accountId")).toBe("new");
    expect(form.get("new.kind")).toBe("checking");
    expect((form.get("files") as File).name).toBe("statement.csv");
    // The rest after the response.
    expect(runJob).not.toHaveBeenCalled();
    await Promise.all(afterJobs.map((job) => job()));
    expect(runJob).toHaveBeenCalledWith("j1");
  });

  it("deletes this browser's last temporary person through a new start", async () => {
    vi.mocked(sessionOwner).mockResolvedValue("trial_own_old");
    await tryWithStatement(null, submitted(statement()));
    expect(startStatementPerson).toHaveBeenCalledWith(
      expect.objectContaining({ previous: "trial_own_old" }),
    );
    vi.mocked(sessionOwner).mockResolvedValue("trial_sample");
    await tryWithStatement(null, submitted(statement()));
    expect(startStatementPerson).toHaveBeenLastCalledWith(
      expect.objectContaining({ previous: "trial_sample" }),
    );
  });

  it("refuses a browser signed in as a real person, and leaves them signed in", async () => {
    vi.mocked(sessionOwner).mockResolvedValue("cm1real");
    jar.set(COOKIE, "their-session");
    expect(await tryWithStatement(null, submitted(statement()))).toEqual({
      error: expect.stringMatching(/You're signed in/),
    });
    expect(startStatementPerson).not.toHaveBeenCalled();
    expect(deleteTrialPerson).not.toHaveBeenCalled();
    expect(jar.get(COOKIE)).toBe("their-session");
  });

  it("wants the box ticked and a file before anything", async () => {
    expect(await tryWithStatement(null, submitted(statement(), false))).toEqual({
      error: expect.stringMatching(/Tick the box/),
    });
    expect(await tryWithStatement(null, submitted(null))).toEqual({
      error: "Choose a statement file first.",
    });
    const empty = new File([], "empty.csv");
    expect(await tryWithStatement(null, submitted(empty))).toEqual({
      error: "Choose a statement file first.",
    });
    expect(hit).not.toHaveBeenCalled();
    expect(startStatementPerson).not.toHaveBeenCalled();
  });

  it("is off in production until it's turned on", async () => {
    vi.mocked(statementTrialEnabled).mockReturnValue(false);
    expect(await tryWithStatement(null, submitted(statement()))).toEqual({
      error: expect.stringMatching(/isn't available/),
    });
    expect(startStatementPerson).not.toHaveBeenCalled();
  });

  it("refuses a file past the size, without reading it or counting a start", async () => {
    const big = new File([new Uint8Array(STATEMENT_TRIAL_MAX_FILE_BYTES + 1)], "big.csv");
    expect(await tryWithStatement(null, submitted(big))).toEqual({
      error: expect.stringMatching(/up to 1 MB/),
    });
    expect(hit).not.toHaveBeenCalled();
    expect(startStatementPerson).not.toHaveBeenCalled();
  });

  it("refuses too many rows, and gives the start back", async () => {
    const lines = ["Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #"];
    for (let i = 0; i < 3_001; i += 1) {
      lines.push(`DEBIT,10/14/2026,"SHOP ${i}",-1.00,DEBIT_CARD,100.00,,`);
    }
    const many = new File([lines.join("\n")], "many.csv");
    expect(await tryWithStatement(null, submitted(many))).toEqual({
      error: expect.stringMatching(/transactions at a time/),
    });
    expect(giveBack).toHaveBeenCalledWith("trialStatement", "iphash");
    expect(startStatementPerson).not.toHaveBeenCalled();
  });

  it("limits starts per IP, then by everyone in a day, and says so politely", async () => {
    vi.mocked(hit).mockResolvedValueOnce({ ...OK, ok: false });
    expect(await tryWithStatement(null, submitted(statement()))).toEqual({
      error: expect.stringMatching(/try again in an hour/),
    });
    expect(hit).toHaveBeenCalledWith("trialStatement", "iphash");
    expect(startStatementPerson).not.toHaveBeenCalled();

    vi.mocked(hit).mockClear();
    vi.mocked(hit)
      .mockResolvedValueOnce(OK)
      .mockResolvedValueOnce({ ...OK, ok: false });
    expect(await tryWithStatement(null, submitted(statement()))).toEqual({
      error: STATEMENT_TRIAL_BUSY,
    });
    expect(hit).toHaveBeenLastCalledWith("trialStatementDay", "all");
    expect(startStatementPerson).not.toHaveBeenCalled();
    expect(jar.has(COOKIE)).toBe(false);
  });

  it("makes no one for a file it can't read, leaves an earlier try alone, and gives the start back", async () => {
    vi.mocked(sessionOwner).mockResolvedValue("trial_own_old");
    const notCsv = new File(["%PDF-1.7 not a statement"], "statement.pdf");
    const result = await tryWithStatement(null, submitted(notCsv));
    expect(result).toEqual({ error: expect.any(String) });
    expect(startStatementPerson).not.toHaveBeenCalled();
    expect(deleteTrialPerson).not.toHaveBeenCalled();
    expect(giveBack).toHaveBeenCalledWith("trialStatement", "iphash");
  });

  it("sends a layout it doesn't know to the column picker", async () => {
    const unknown = new File(
      ["When,What,How much\n2026-10-14,Coffee,5.75\n2026-10-13,Lunch,12.00\n"],
      "other.csv",
    );
    expect(await tryWithStatement(null, submitted(unknown))).toEqual({
      next: "/import?columns=1",
    });
    expect(startStatementPerson).toHaveBeenCalled();
    expect(saveUpload).not.toHaveBeenCalled();
    expect(jar.get(COOKIE)).toBe("trial_token");
  });

  it("says so when the person can't be made, and leaves the browser as it was", async () => {
    jar.set(COOKIE, "their-old-try");
    vi.mocked(sessionOwner).mockResolvedValue("trial_own_old");
    vi.mocked(startStatementPerson).mockRejectedValue(new Error("the database went away"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await tryWithStatement(null, submitted(statement()))).toEqual({
      error: expect.stringMatching(/try again/),
    });
    // The error's kind only: its message could quote a row of someone's statement.
    expect(JSON.stringify(error.mock.calls)).not.toContain("database went away");
    expect(jar.get(COOKIE)).toBe("their-old-try");
  });

  it("deletes the new person when saving fails, and signs them out", async () => {
    vi.mocked(saveUpload).mockResolvedValue({ ok: false, error: "That didn't work." });
    expect(await tryWithStatement(null, submitted(statement()))).toEqual({
      error: "That didn't work.",
    });
    expect(deleteTrialPerson).toHaveBeenCalledWith("trial_own_new", "failed_start");
    expect(jar.has(COOKIE)).toBe(false);
    vi.mocked(saveUpload).mockRejectedValue(new Error("the database went away"));
    expect(await tryWithStatement(null, submitted(statement()))).toEqual({
      error: expect.stringMatching(/couldn't read this file/),
    });
    expect(jar.has(COOKIE)).toBe(false);
  });
});

describe("startOverTry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jar.clear();
  });

  it("deletes the person this browser holds, signs out and says so", async () => {
    jar.set(COOKIE, "trial_token");
    vi.mocked(sessionOwner).mockResolvedValue("trial_own_me");
    expect(await startOverTry()).toEqual({ next: "/?try=upload&deleted=1" });
    expect(deleteTrialPerson).toHaveBeenCalledWith("trial_own_me", "start_over");
    expect(jar.has(COOKIE)).toBe(false);
  });

  it("does nothing to a real person or a sample person", async () => {
    for (const owner of ["cm1real", "trial_sample", null]) {
      jar.set(COOKIE, "a-session");
      vi.mocked(sessionOwner).mockResolvedValue(owner);
      expect(await startOverTry()).toEqual({ next: "/" });
      expect(jar.get(COOKIE)).toBe("a-session");
    }
    expect(deleteTrialPerson).not.toHaveBeenCalled();
  });

  it("keeps the session and says so when the delete fails", async () => {
    jar.set(COOKIE, "trial_token");
    vi.mocked(sessionOwner).mockResolvedValue("trial_own_me");
    vi.mocked(deleteTrialPerson).mockRejectedValueOnce(new Error("deadlock"));
    expect(await startOverTry()).toEqual({ error: expect.stringMatching(/try again/) });
    expect(jar.get(COOKIE)).toBe("trial_token");
  });
});
