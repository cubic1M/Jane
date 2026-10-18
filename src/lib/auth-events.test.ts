import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookieGet, updateMany } = vi.hoisted(() => ({ cookieGet: vi.fn(), updateMany: vi.fn() }));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: cookieGet }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { user: { updateMany } } }));

import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { recordSignIn, signInMethod } from "./auth-events";

const USER = { type: "user", id: "user_1" };

describe("recordSignIn", () => {
  beforeEach(() => {
    vi.mocked(track).mockReset().mockResolvedValue(undefined);
    vi.mocked(logAudit).mockReset().mockResolvedValue(undefined);
    cookieGet.mockReset().mockReturnValue({ value: "anon-123" });
    updateMany.mockReset().mockResolvedValue({ count: 0 });
    vi.unstubAllEnvs();
  });

  it("makes ADMIN_EMAILS admins on sign-in, once", async () => {
    vi.stubEnv("ADMIN_EMAILS", "founder@example.com");
    updateMany.mockResolvedValueOnce({ count: 1 });

    await recordSignIn({ user: { id: "user_1", email: "Founder@example.com" }, isNewUser: false });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "user_1", role: "user" },
      data: { role: "admin" },
    });
    expect(logAudit).toHaveBeenCalledWith(USER, "user_made_admin", USER, { via: "ADMIN_EMAILS" });
  });

  it("leaves everyone else's role alone", async () => {
    vi.stubEnv("ADMIN_EMAILS", "founder@example.com");
    await recordSignIn({ user: { id: "user_1", email: "someone@example.com" }, isNewUser: false });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("logs sign-up and sign-in and tracks signup_completed for a new user", async () => {
    await recordSignIn({
      user: { id: "user_1" },
      account: { provider: "resend" },
      isNewUser: true,
    });

    expect(logAudit).toHaveBeenCalledWith(USER, "user_signed_up", USER, { method: "email" });
    expect(logAudit).toHaveBeenCalledWith(USER, "user_signed_in", USER, { method: "email" });
    expect(track).toHaveBeenCalledWith("user_1", "signup_completed", {
      method: "email",
      anonymous_id: "anon-123",
    });
  });

  it("logs and tracks only the sign-in for a returning user", async () => {
    await recordSignIn({
      user: { id: "user_1" },
      account: { provider: "google" },
      isNewUser: false,
    });

    expect(logAudit).toHaveBeenCalledOnce();
    expect(logAudit).toHaveBeenCalledWith(USER, "user_signed_in", USER, { method: "google" });
    expect(track).toHaveBeenCalledOnce();
    expect(track).toHaveBeenCalledWith("user_1", "signed_in", { method: "google" });
  });

  it("tracks sign-up without an anonymous id when the visitor has none", async () => {
    cookieGet.mockReturnValue(undefined);

    await recordSignIn({
      user: { id: "user_1" },
      account: { provider: "google" },
      isNewUser: true,
    });

    expect(track).toHaveBeenCalledWith("user_1", "signup_completed", {
      method: "google",
      anonymous_id: null,
    });
  });

  it("does nothing without a user id", async () => {
    await recordSignIn({ user: {}, account: { provider: "google" }, isNewUser: true });

    expect(logAudit).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });
});

describe("signInMethod", () => {
  it("names the magic-link provider email", () => {
    expect(signInMethod("resend")).toBe("email");
    expect(signInMethod("google")).toBe("google");
    expect(signInMethod(undefined)).toBe("unknown");
  });
});
