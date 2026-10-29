import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { afterJobs } = vi.hoisted(() => ({ afterJobs: [] as (() => Promise<void>)[] }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (job: () => Promise<void>) => afterJobs.push(job),
}));
vi.mock("@/lib/session", () => ({ getSessionState: vi.fn(async () => null) }));
vi.mock("@/lib/rate-limit", () => ({ hit: vi.fn(), ipKey: vi.fn(() => "iphash") }));
vi.mock("@/lib/trial", () => ({
  startTrial: vi.fn(),
  trialEnabled: vi.fn(() => true),
  TrialError: class TrialError extends Error {},
}));
vi.mock("@/lib/trial-pool", () => ({
  claimReadyPerson: vi.fn(),
  afterClaim: vi.fn(async () => {}),
}));
// The scan reports the accounts and transactions are in by calling onReady.
vi.mock("@/lib/plaid/sync", () => ({
  syncItem: vi.fn(async (_id: string, options?: { onReady?: () => void }) => {
    options?.onReady?.();
    return {};
  }),
}));

import { hit } from "@/lib/rate-limit";
import { getSessionState } from "@/lib/session";
import { syncItem } from "@/lib/plaid/sync";
import { TrialError, startTrial, trialEnabled } from "@/lib/trial";
import { afterClaim, claimReadyPerson } from "@/lib/trial-pool";
import { GET } from "./route";

// The one-tap demo link: /try signs the visitor in as their own sample person and opens the
// report at once, from one made ahead when there is one; never for previews or prefetches,
// never twice for someone signed in, and limited per IP.

const EXPIRES = new Date("2026-10-30T15:00:00Z");
const PHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const open = (headers: Record<string, string> = {}) =>
  GET(
    new NextRequest("http://localhost:3000/try", { headers: { "user-agent": PHONE, ...headers } }),
  );

describe("GET /try", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterJobs.length = 0;
    vi.mocked(trialEnabled).mockReturnValue(true);
    vi.mocked(getSessionState).mockResolvedValue(null);
    vi.mocked(hit).mockResolvedValue({ ok: true, remaining: 19, retryAfterSeconds: 0 });
    vi.mocked(claimReadyPerson).mockResolvedValue({
      userId: "trial_ready",
      sessionToken: "trial_tok",
      expires: EXPIRES,
    });
    vi.mocked(startTrial).mockResolvedValue({
      userId: "trial_new",
      itemId: "item_1",
      sessionToken: "trial_new_tok",
      expires: EXPIRES,
    });
  });

  it("hands out a ready sample person and opens the report, signed in for a day", async () => {
    const response = await open();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/report");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-try")).toBe("ready");
    expect(hit).toHaveBeenCalledWith("trial", "iphash");
    expect(claimReadyPerson).toHaveBeenCalledWith({ userAgent: PHONE });
    const cookie = response.cookies.get("authjs.session-token");
    expect(cookie).toMatchObject({
      value: "trial_tok",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      expires: EXPIRES,
    });
    expect(cookie?.secure).toBeFalsy();
    // Nothing is made while the visitor waits; the card text, the top-up and the clean-up
    // come after the response.
    expect(startTrial).not.toHaveBeenCalled();
    expect(afterClaim).not.toHaveBeenCalled();
    for (const job of afterJobs) await job();
    expect(afterClaim).toHaveBeenCalledWith("trial_ready");
  });

  it("uses the secure cookie name over HTTPS", async () => {
    const response = await open({ "x-forwarded-proto": "https" });
    expect(response.cookies.get("__Secure-authjs.session-token")?.value).toBe("trial_tok");
  });

  it("with none ready, makes one now and opens the report once its transactions are in", async () => {
    vi.mocked(claimReadyPerson).mockResolvedValue(null);
    const response = await open();
    expect(response.headers.get("location")).toBe("http://localhost:3000/report");
    expect(response.headers.get("x-try")).toBe("new");
    expect(startTrial).toHaveBeenCalledWith({
      userAgent: PHONE,
      defer: true,
      termsVia: "try_link",
    });
    expect(syncItem).toHaveBeenCalledWith("item_1", expect.objectContaining({ progressive: true }));
    expect(response.cookies.get("authjs.session-token")?.value).toBe("trial_new_tok");
    for (const job of afterJobs) await job();
    // Its own scan brought its card text; the pool is topped up for the next visitor.
    expect(afterClaim).toHaveBeenCalledWith(null);
  });

  it("sends someone already signed in to their own report, never making a second person", async () => {
    vi.mocked(getSessionState).mockResolvedValue({
      user: { id: "trial_mine" } as never,
      mfaPending: false,
    });
    const response = await open();
    expect(response.headers.get("location")).toBe("http://localhost:3000/report");
    expect(response.cookies.get("authjs.session-token")).toBeUndefined();
    expect(hit).not.toHaveBeenCalled();
    expect(claimReadyPerson).not.toHaveBeenCalled();
    expect(startTrial).not.toHaveBeenCalled();
  });

  it("is limited per IP, with the landing page's counter", async () => {
    vi.mocked(hit).mockResolvedValue({ ok: false, remaining: 0, retryAfterSeconds: 600 });
    const response = await open();
    expect(response.headers.get("location")).toBe("http://localhost:3000/try/busy");
    expect(response.cookies.get("authjs.session-token")).toBeUndefined();
    expect(claimReadyPerson).not.toHaveBeenCalled();
    expect(startTrial).not.toHaveBeenCalled();
  });

  it("never makes a person for a link preview or a prefetch", async () => {
    const preview = await open({ "user-agent": "Slackbot-LinkExpanding 1.0" });
    expect(preview.headers.get("location")).toBe("http://localhost:3000/");
    const prefetch = await open({ "sec-purpose": "prefetch" });
    expect(prefetch.status).toBe(204);
    expect(prefetch.headers.get("cache-control")).toBe("no-store");
    expect(hit).not.toHaveBeenCalled();
    expect(claimReadyPerson).not.toHaveBeenCalled();
    expect(startTrial).not.toHaveBeenCalled();
  });

  it("goes to the landing page where trying Jane isn't offered", async () => {
    vi.mocked(trialEnabled).mockReturnValue(false);
    const response = await open();
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
    expect(claimReadyPerson).not.toHaveBeenCalled();
  });

  it("goes to the landing page if a new person can't be made", async () => {
    vi.mocked(claimReadyPerson).mockResolvedValue(null);
    vi.mocked(startTrial).mockRejectedValue(new TrialError("Trying Jane isn't available here."));
    const response = await open();
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
    expect(response.cookies.get("authjs.session-token")).toBeUndefined();
  });
});
