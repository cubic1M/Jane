import { beforeEach, describe, expect, it, vi } from "vitest";

const { set } = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  ipKey: () => "ip",
  hit: vi.fn(async () => ({ ok: true, remaining: 1, retryAfterSeconds: 0 })),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("@/auth", () => ({
  googleEnabled: true,
  signIn: vi.fn(),
  signOut: vi.fn(),
  auth: vi.fn(),
}));
vi.mock("@/lib/auth-events", () => ({ recordFailedSignIn: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/session", () => ({ HOME_PATH: "/import" }));
vi.mock("@/lib/trial-delete", () => ({ deleteTrialPerson: vi.fn(async () => true) }));
vi.mock("@/lib/invites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/invites")>()),
  checkCode: vi.fn(async () => "used_up"),
}));

import { SIGNUP_DRAFT_COOKIE, readDraft } from "@/lib/signup-draft";
import { signInWithGoogle } from "./auth-actions";

// "Sign up with Google" with a code that won't work (debug 3, 11-16): sent back to /signup with
// every field empty, though the email button keeps what was typed (#1612). Both keep it now.
describe("signing up with Google and an invite that won't work", () => {
  beforeEach(() => set.mockClear());

  it("comes back with the error and what was typed", async () => {
    const form = new FormData();
    form.set("invite", "USED-UPAA-2222");
    form.set("email", "maya@example.test");
    form.set("consent", "on");
    await expect(signInWithGoogle(form)).rejects.toThrow("redirect:/signup?error=InviteUsedUp");
    const draft = set.mock.calls.find(([name]) => name === SIGNUP_DRAFT_COOKIE);
    expect(draft).toBeDefined();
    expect(readDraft(draft![1])).toEqual({ invite: "USED-UPAA-2222", email: "maya@example.test" });
  });
});
