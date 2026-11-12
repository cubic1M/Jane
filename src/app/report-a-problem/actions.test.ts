import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, logAudit, track, saveTryFeedback, emailFeedback, afterCallbacks } = vi.hoisted(
  () => ({
    emailFeedback: vi.fn(),
    afterCallbacks: [] as (() => unknown)[],
    saveTryFeedback: vi.fn(),
    create: vi.fn(async () => ({ id: "rep_1" })),
    logAudit: vi.fn(),
    track: vi.fn(),
  }),
);
vi.mock("@/lib/session", () => ({
  requireUser: vi.fn(async () => ({ id: "user_1", email: "student@example.edu" })),
}));
vi.mock("next/server", () => ({
  after: (callback: () => unknown) => afterCallbacks.push(callback),
}));
vi.mock("@/lib/feedback-email", () => ({ emailFeedback }));
vi.mock("@/lib/crypto", () => ({ encryptBytes: (b: Uint8Array) => new Uint8Array([9, ...b]) }));
vi.mock("@/lib/db-scoped", () => ({
  scopedDb: vi.fn(async () => ({ userId: "user_1", problemReports: { create } })),
}));
vi.mock("@/lib/audit", () => ({ logAudit }));
vi.mock("@/lib/try-feedback", () => ({ saveTryFeedback }));
vi.mock("@/lib/analytics", () => ({ track }));
vi.mock("@/lib/rate-limit", () => ({
  hit: vi.fn(async () => ({ ok: true, remaining: 1, retryAfterSeconds: 0 })),
}));

import { hit } from "@/lib/rate-limit";
import { requireUser } from "@/lib/session";
import { sendProblemReport } from "./actions";

const form = (fields: Record<string, string | Blob>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("sendProblemReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterCallbacks.length = 0;
  });

  it("keeps the words and the page, audits it by id, and tells analytics nothing", async () => {
    const result = await sendProblemReport(
      form({ from: "/transactions?q=rent", message: "A row is missing." }),
    );
    expect(result).toEqual({ ok: true });
    expect(create).toHaveBeenCalledWith({
      data: { userId: "user_1", path: "/transactions", message: "A row is missing." },
      select: { id: true },
    });
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: "user_1" },
      "problem_reported",
      { type: "problem_report", id: "rep_1" },
      { screenshot: false },
    );
    expect(track).not.toHaveBeenCalled();
  });

  // The founders hear as it arrives: the words and the page, and they can reply to the person.
  it("emails the founders the words and the page after answering", async () => {
    await sendProblemReport(form({ from: "/home", message: "Love the tree." }));
    expect(emailFeedback).not.toHaveBeenCalled();
    for (const callback of afterCallbacks) await callback();
    expect(emailFeedback).toHaveBeenCalledWith({
      path: "/home",
      message: "Love the tree.",
      screenshot: false,
      replyTo: "student@example.edu",
    });
  });

  it("keeps an attached screenshot encrypted with the report, and the email only says there is one", async () => {
    const shot = new File([PNG], "shot.png", { type: "image/png" });
    expect(
      await sendProblemReport(form({ from: "/home", message: "See this.", screenshot: shot })),
    ).toEqual({
      ok: true,
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        path: "/home",
        message: "See this.",
        screenshotEncrypted: new Uint8Array([9, ...PNG]),
        screenshotType: "image/png",
      },
      select: { id: true },
    });
    for (const callback of afterCallbacks) await callback();
    expect(emailFeedback).toHaveBeenCalledWith(expect.objectContaining({ screenshot: true }));
  });

  it("refuses a file that isn't a picture, whatever it's called", async () => {
    const fake = new File(["%PDF-1.4"], "shot.png", { type: "image/png" });
    const result = await sendProblemReport(
      form({ from: "/home", message: "See this.", screenshot: fake }),
    );
    expect(result).toEqual({
      ok: false,
      error: "Attach a screenshot as a PNG, JPEG or WebP picture.",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("asks for words instead of saving nothing", async () => {
    expect(await sendProblemReport(form({ from: "/home", message: " " }))).toEqual({
      ok: false,
      error: "Say what went wrong, in a few words.",
    });
    expect(create).not.toHaveBeenCalled();
  });

  // /admin/reports shows the newest 200, and a sample person needs no account.
  it("stops at a few reports an hour, so nobody can push real ones off the page", async () => {
    vi.mocked(hit).mockResolvedValueOnce({ ok: false, remaining: 0, retryAfterSeconds: 60 });
    const result = await sendProblemReport(form({ from: "/home", message: "It broke." }));
    expect(result).toMatchObject({ ok: false });
    expect(hit).toHaveBeenCalledWith("problemReports", "user_1");
    expect(create).not.toHaveBeenCalled();
  });

  // A try is deleted, and a report saved with its person would go too.
  it("keeps a trial person's report apart from them, with nothing to link it back", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({ id: "trial_1" } as never);
    create.mockClear();
    logAudit.mockClear();
    const result = await sendProblemReport(form({ from: "/home", message: "It broke." }));
    expect(result).toEqual({ ok: true });
    expect(saveTryFeedback).toHaveBeenCalledWith("trial_1", {
      path: "/home",
      message: "It broke.",
    });
    expect(create).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  // Anyone can make 40 sample people, at 5 reports each.
  it("has a ceiling for all sample people together", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce({ id: "trial_1" } as never);
    vi.mocked(hit)
      .mockResolvedValueOnce({ ok: true, remaining: 1, retryAfterSeconds: 0 })
      .mockResolvedValueOnce({ ok: false, remaining: 0, retryAfterSeconds: 60 });
    const result = await sendProblemReport(form({ from: "/home", message: "It broke." }));
    expect(result).toMatchObject({ ok: false });
    expect(hit).toHaveBeenCalledWith("sampleProblemReports", "all");
    expect(create).not.toHaveBeenCalled();
  });
});
