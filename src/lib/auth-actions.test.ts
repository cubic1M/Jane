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
vi.mock("@/lib/auth-events", () => ({ recordFailedSignIn: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
  cookies: vi.fn(async () => ({ set: cookieSet })),
}));
vi.mock("@/lib/invites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/invites")>()),
  redeemInvite: vi.fn(),
  checkCode: vi.fn(),
  joinWaitlist: vi.fn(),
}));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("next-auth", () => ({ AuthError }));
// Google set up or not (AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET), switched per test.
const google = vi.hoisted(() => ({ enabled: true }));
vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
  signIn: vi.fn(),
  signOut: vi.fn(),
  get googleEnabled() {
    return google.enabled;
  },
}));
vi.mock("@/lib/session", () => ({ HOME_PATH: "/import" }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

import { auth, signIn, signOut } from "@/auth";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { recordFailedSignIn } from "@/lib/auth-events";
import { checkCode, joinWaitlist, redeemInvite } from "@/lib/invites";
import { hit } from "@/lib/rate-limit";
import { TERMS_VERSION } from "@/config/legal";
import { joinTheWaitlist, signInWithEmail, signInWithGoogle, signOutToHome } from "./auth-actions";

function emailForm(email: string) {
  const form = new FormData();
  form.set("email", email);
  return form;
}

describe("auth actions", () => {
  beforeEach(() => {
    vi.mocked(signIn).mockReset().mockResolvedValue(undefined);
    vi.mocked(signOut).mockReset().mockResolvedValue(undefined);
    vi.mocked(redeemInvite).mockReset();
    cookieSet.mockReset();
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

  it("sends a Google sign-in back to email when Google isn't set up", async () => {
    google.enabled = false;
    try {
      await expect(signInWithGoogle()).rejects.toThrow("redirect:/login");
      expect(signIn).not.toHaveBeenCalled();
    } finally {
      google.enabled = true;
    }
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

  it("puts a sign-out on the access log first, while it knows whose session it was", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { id: "user_1" } } as never);
    vi.mocked(logAudit).mockClear();
    await signOutToHome();
    expect(logAudit).toHaveBeenCalledWith({ type: "user", id: "user_1" }, "user_signed_out", {
      type: "user",
      id: "user_1",
    });
    expect(vi.mocked(logAudit).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(signOut).mock.invocationCallOrder.at(-1)!,
    );
  });

  it("stops sign-in emails past the limit, per IP and per address", async () => {
    vi.mocked(hit).mockResolvedValueOnce({ ok: true, remaining: 0, retryAfterSeconds: 60 });
    vi.mocked(hit).mockResolvedValueOnce({ ok: false, remaining: 0, retryAfterSeconds: 60 });

    await expect(signInWithEmail(emailForm("A@Example.com"))).rejects.toThrow(
      "redirect:/login?error=TooManyRequests",
    );
    expect(vi.mocked(hit).mock.calls.map((c) => c[1])).toEqual(["ip", "email:a@example.com"]);
    expect(signIn).not.toHaveBeenCalled();
    expect(recordFailedSignIn).toHaveBeenCalledWith("rate_limited");
  });

  it("redeems a sign-up invite before sending the link, and stops on a bad code", async () => {
    vi.mocked(redeemInvite).mockResolvedValueOnce("ok");
    const form = emailForm("new@example.com");
    form.set("invite", "abcd-efgh-jkmn");
    form.set("consent", "on");
    await signInWithEmail(form).catch(() => {});
    expect(redeemInvite).toHaveBeenCalledWith("abcd-efgh-jkmn", "new@example.com");
    expect(signIn).toHaveBeenCalled();

    vi.mocked(signIn).mockClear();
    vi.mocked(redeemInvite).mockResolvedValueOnce("used_up");
    await expect(signInWithEmail(form)).rejects.toThrow("redirect:/signup?error=InviteUsedUp");
    expect(signIn).not.toHaveBeenCalled();
    expect(recordFailedSignIn).toHaveBeenCalledWith("invite_used_up");
  });

  it("refuses sign-up without agreeing to the Terms, and remembers consent until the account exists", async () => {
    const form = emailForm("new@example.com");
    form.set("invite", "abcd-efgh-jkmn");

    await expect(signInWithEmail(form)).rejects.toThrow("redirect:/signup?error=ConsentRequired");
    expect(redeemInvite).not.toHaveBeenCalled();

    vi.mocked(redeemInvite).mockResolvedValueOnce("ok");
    form.set("consent", "on");
    await signInWithEmail(form).catch(() => {});
    expect(cookieSet).toHaveBeenCalledWith(
      "fc_terms",
      TERMS_VERSION,
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it("carries a checked invite code through Google sign-up in a cookie", async () => {
    vi.mocked(checkCode).mockResolvedValueOnce("ok");
    const form = new FormData();
    form.set("invite", "abcd efgh jkmn");
    form.set("consent", "on");

    await signInWithGoogle(form).catch(() => {});

    expect(cookieSet).toHaveBeenCalledWith(
      "fc_invite",
      "ABCD-EFGH-JKMN",
      expect.objectContaining({ httpOnly: true, maxAge: 900 }),
    );
  });

  // Spec step 138: from a Try Jane session, the sample person's session ends first, so a
  // Google sign-up is never linked to the sample person (who is deleted after a day).
  it("ends a sample person's session before signing up or in, and no one else's", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { id: "trial_abc" } } as never);
    await signInWithGoogle();
    expect(signOut).toHaveBeenCalledWith({ redirect: false });
    expect(vi.mocked(signOut).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(signIn).mock.invocationCallOrder[0],
    );

    vi.mocked(signOut).mockClear();
    vi.mocked(auth).mockResolvedValueOnce({ user: { id: "trial_abc" } } as never);
    await signInWithEmail(emailForm("maya@example.com"));
    expect(signOut).toHaveBeenCalledWith({ redirect: false });

    vi.mocked(signOut).mockClear();
    vi.mocked(auth).mockResolvedValueOnce({ user: { id: "u1" } } as never);
    await signInWithEmail(emailForm("maya@example.com"));
    expect(signOut).not.toHaveBeenCalled();
  });

  // The closed beta: an email left without an invite is stored, counted once, sent nothing.
  it("puts an email on the waitlist, counts it once and sends no link", async () => {
    vi.mocked(joinWaitlist).mockReset().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    vi.mocked(track).mockReset();
    await expect(joinTheWaitlist(emailForm("new@example.com"))).rejects.toThrow(
      "redirect:/signup?waitlist=joined",
    );
    await expect(joinTheWaitlist(emailForm("new@example.com"))).rejects.toThrow(
      "redirect:/signup?waitlist=joined",
    );
    expect(joinWaitlist).toHaveBeenCalledWith("new@example.com");
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(null, "waitlist_joined", {});
    expect(signIn).not.toHaveBeenCalled();
    await expect(joinTheWaitlist(new FormData())).rejects.toThrow(
      "redirect:/signup?error=InvalidEmail",
    );
  });

  it("rate-limits the waitlist like sign-in", async () => {
    vi.mocked(hit).mockResolvedValueOnce({ ok: false, remaining: 0, retryAfterSeconds: 60 });
    vi.mocked(joinWaitlist).mockReset();
    await expect(joinTheWaitlist(emailForm("new@example.com"))).rejects.toThrow(
      "redirect:/login?error=TooManyRequests",
    );
    expect(joinWaitlist).not.toHaveBeenCalled();
  });

  it("names a revoked code and a code for someone else", async () => {
    const form = emailForm("ada@example.com");
    form.set("invite", "ABCD-EFGH-JKMN");
    form.set("consent", "on");
    vi.mocked(redeemInvite).mockResolvedValueOnce("revoked");
    await expect(signInWithEmail(form)).rejects.toThrow("redirect:/signup?error=InviteRevoked");
    vi.mocked(redeemInvite).mockResolvedValueOnce("wrong_email");
    await expect(signInWithEmail(form)).rejects.toThrow("redirect:/signup?error=InviteWrongEmail");
    expect(signIn).not.toHaveBeenCalled();
  });
});
