import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect, getSessionState } = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  getSessionState: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/session", () => ({ getSessionState, HOME_PATH: "/chat" }));

import { RedirectIfSignedIn } from "./redirect-if-signed-in";

// /signup and /login send someone already signed in to the chat, except a person trying Jane
// with sample data: the trial banner's "Sign up" must reach the form.
describe("RedirectIfSignedIn", () => {
  beforeEach(() => {
    redirect.mockClear();
  });

  it("lets a visitor who isn't signed in stay", async () => {
    getSessionState.mockResolvedValue(null);
    expect(await RedirectIfSignedIn()).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("sends a signed-in person to the chat, or to their two-factor code", async () => {
    getSessionState.mockResolvedValue({ user: { id: "u1" }, mfaPending: false });
    await expect(RedirectIfSignedIn()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenLastCalledWith("/chat");
    getSessionState.mockResolvedValue({ user: { id: "u1" }, mfaPending: true });
    await expect(RedirectIfSignedIn()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenLastCalledWith("/mfa");
  });

  it("lets someone trying Jane with a sample person reach sign-up", async () => {
    getSessionState.mockResolvedValue({ user: { id: "trial_abc123" }, mfaPending: false });
    expect(await RedirectIfSignedIn()).toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });
});
