import { beforeEach, describe, expect, it, vi } from "vitest";

const { AuthError, cookieSet } = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  AuthError: class AuthError extends Error {
    type = "Configuration";
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  limitOrNull: vi.fn(async () => null),
  hit: vi.fn(async () => ({ ok: true, remaining: 1, retryAfterSeconds: 0 })),
  ipKey: vi.fn(() => "ip"),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ set: cookieSet })),
}));
vi.mock("@/lib/invites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/invites")>()),
  redeemInvite: vi.fn(),
  checkCode: vi.fn(),
}));
vi.mock("next-auth", () => ({ AuthError }));
vi.mock("@/auth", () => ({ signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("@/lib/session", () => ({ HOME_PATH: "/import" }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

import { signIn, signOut } from "@/auth";
import { checkCode, redeemInvite } from "@/lib/invites";
import { hit } from "@/lib/rate-limit";
import { signInWithEmail, signInWithGoogle, signOutToHome } from "./auth-actions";

function emailForm(email: string) {
  const form = new FormData();
  form.set("email", email);
  return form;
}

describe("auth actions", () => {
  beforeEach(() => {
    vi.mocked(signIn).mockReset().mockResolvedValue(undefined);
    vi.mocked(signOut).mockReset().mockResolvedValue(undefined);
  });

  it("sends a magic link and lands the user on the home path", async () => {
    await signInWithEmail(emailForm(" ada@example.com "));

    expect(signIn).toHaveBeenCalledWith("resend", {
      email: "ada@example.com",
      redirectTo: "/import",
    });
  });

  it("rejects a missing email without calling Auth.js", async () => {
    await expect(signInWithEmail(new FormData())).rejects.toThrow(
      "redirect:/login?error=InvalidEmail",
    );
    expect(signIn).not.toHaveBeenCalled();
  });

  it("starts Google sign-in with the home path as the destination", async () => {
    await signInWithGoogle();

    expect(signIn).toHaveBeenCalledWith("google", { redirectTo: "/import" });
  });

  it("shows Auth.js errors on the login page", async () => {
    vi.mocked(signIn).mockRejectedValue(new AuthError());

    await expect(signInWithGoogle()).rejects.toThrow("redirect:/login?error=Configuration");
  });

  it("lets other errors through, including Next's redirect", async () => {
    vi.mocked(signIn).mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(signInWithEmail(emailForm("ada@example.com"))).rejects.toThrow("NEXT_REDIRECT");
  });

  it("signs out to the landing page", async () => {
    await signOutToHome();

    expect(signOut).toHaveBeenCalledWith({ redirectTo: "/" });
  });

  it("stops sign-in emails past the limit, per IP and per address", async () => {
    vi.mocked(hit).mockResolvedValueOnce({ ok: true, remaining: 0, retryAfterSeconds: 60 });
    vi.mocked(hit).mockResolvedValueOnce({ ok: false, remaining: 0, retryAfterSeconds: 60 });

    await expect(signInWithEmail(emailForm("A@Example.com"))).rejects.toThrow(
      "redirect:/login?error=TooManyRequests",
    );
    expect(vi.mocked(hit).mock.calls.map((c) => c[1])).toEqual(["ip", "email:a@example.com"]);
    expect(signIn).not.toHaveBeenCalled();
  });

  it("redeems a sign-up invite before sending the link, and stops on a bad code", async () => {
    vi.mocked(redeemInvite).mockResolvedValueOnce("ok");
    const form = emailForm("new@example.com");
    form.set("invite", "abcd-efgh-jkmn");
    await signInWithEmail(form).catch(() => {});
    expect(redeemInvite).toHaveBeenCalledWith("abcd-efgh-jkmn", "new@example.com");
    expect(signIn).toHaveBeenCalled();

    vi.mocked(signIn).mockClear();
    vi.mocked(redeemInvite).mockResolvedValueOnce("used_up");
    await expect(signInWithEmail(form)).rejects.toThrow("redirect:/signup?error=InviteUsedUp");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("carries a checked invite code through Google sign-up in a cookie", async () => {
    vi.mocked(checkCode).mockResolvedValueOnce("ok");
    const form = new FormData();
    form.set("invite", "abcd efgh jkmn");

    await signInWithGoogle(form).catch(() => {});

    expect(cookieSet).toHaveBeenCalledWith(
      "fc_invite",
      "ABCD-EFGH-JKMN",
      expect.objectContaining({ httpOnly: true, maxAge: 900 }),
    );
  });
});
