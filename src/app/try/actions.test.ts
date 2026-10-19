import { beforeEach, describe, expect, it, vi } from "vitest";

const { set, headerValues } = vi.hoisted(() => ({
  set: vi.fn(),
  headerValues: new Map<string, string>(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set }),
  headers: async () => new Headers([...headerValues]),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("@/lib/rate-limit", () => ({ hit: vi.fn(), ipKey: vi.fn(() => "iphash") }));
vi.mock("@/lib/trial", () => ({
  startTrial: vi.fn(),
  TrialError: class TrialError extends Error {},
}));

import { redirect } from "next/navigation";
import { hit } from "@/lib/rate-limit";
import { TrialError, startTrial } from "@/lib/trial";
import { tryJane } from "./actions";

// Spec step 138: "Try it with sample data" signs the visitor in as their own sample person
// and opens the chat; it's limited per IP.

const EXPIRES = new Date("2026-10-19T15:00:00Z");
const agreed = (consent = true) => {
  const data = new FormData();
  if (consent) data.set("consent", "on");
  return data;
};

describe("tryJane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    headerValues.clear();
    vi.mocked(hit).mockResolvedValue({ ok: true, remaining: 4, retryAfterSeconds: 0 });
    vi.mocked(startTrial).mockResolvedValue({
      userId: "trial_1",
      sessionToken: "tok",
      expires: EXPIRES,
    });
  });

  it("sets the session cookie for a day and opens the chat", async () => {
    headerValues.set("user-agent", "Browser");
    await expect(tryJane(null, agreed())).rejects.toThrow("NEXT_REDIRECT");
    expect(hit).toHaveBeenCalledWith("trial", "iphash");
    expect(startTrial).toHaveBeenCalledWith({ userAgent: "Browser" });
    expect(set).toHaveBeenCalledWith("authjs.session-token", "tok", {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      expires: EXPIRES,
    });
    expect(redirect).toHaveBeenCalledWith("/chat");
  });

  it("uses the secure cookie on HTTPS", async () => {
    headerValues.set("x-forwarded-proto", "https");
    await expect(tryJane(null, agreed())).rejects.toThrow("NEXT_REDIRECT");
    expect(set.mock.calls[0][0]).toBe("__Secure-authjs.session-token");
    expect(set.mock.calls[0][2]).toMatchObject({ secure: true });
  });

  it("needs the Terms agreed to first, as at sign-up", async () => {
    expect(await tryJane(null, agreed(false))).toEqual({
      error: "Tick the box to agree to the Terms and Privacy Policy first.",
    });
    expect(hit).not.toHaveBeenCalled();
    expect(startTrial).not.toHaveBeenCalled();
  });

  it("is rate-limited, and says so when trying isn't available", async () => {
    vi.mocked(hit).mockResolvedValueOnce({ ok: false, remaining: 0, retryAfterSeconds: 60 });
    expect(await tryJane(null, agreed())).toEqual({
      error: expect.stringMatching(/try again in an hour/),
    });
    expect(startTrial).not.toHaveBeenCalled();
    vi.mocked(startTrial).mockRejectedValueOnce(
      new TrialError("Trying Jane isn't available here."),
    );
    expect(await tryJane(null, agreed())).toEqual({ error: "Trying Jane isn't available here." });
    expect(set).not.toHaveBeenCalled();
  });
});
