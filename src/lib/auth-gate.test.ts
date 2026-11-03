import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookieGet } = vi.hoisted(() => ({ cookieGet: vi.fn() }));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: cookieGet })) }));
vi.mock("@/lib/auth-events", () => ({ recordFailedSignIn: vi.fn() }));
vi.mock("@/lib/admin-gate", () => ({
  sessionTokenFrom: (cookies: { get(name: string): { value: string } | undefined }) =>
    cookies.get("authjs.session-token")?.value,
}));
vi.mock("@/lib/user-sessions", () => ({ emailOfSession: vi.fn() }));
vi.mock("@/lib/invites", () => ({
  mayCreateAccount: vi.fn(),
  redeemInvite: vi.fn(),
  isAdminEmail: vi.fn(),
}));

import { recordFailedSignIn } from "@/lib/auth-events";
import { mayCreateAccount, redeemInvite } from "@/lib/invites";
import { emailOfSession } from "@/lib/user-sessions";
import { allowSignIn } from "./auth-gate";

describe("allowSignIn", () => {
  beforeEach(() => {
    vi.mocked(mayCreateAccount).mockReset().mockResolvedValue(false);
    vi.mocked(redeemInvite).mockReset();
    cookieGet.mockReset().mockReturnValue(undefined);
    vi.mocked(emailOfSession).mockReset().mockResolvedValue(null);
  });

  it("lets in existing users and people on the beta list", async () => {
    vi.mocked(mayCreateAccount).mockResolvedValue(true);
    expect(await allowSignIn({ user: { email: "Sam@Example.com" } })).toBe(true);
    expect(mayCreateAccount).toHaveBeenCalledWith("sam@example.com");
  });

  it("sends everyone else to sign up with a code", async () => {
    expect(await allowSignIn({ user: { email: "new@example.com" } })).toBe(
      "/signup?error=InviteRequired",
    );
    // On the access log as a failed sign-in, without the address.
    expect(recordFailedSignIn).toHaveBeenCalledWith("no_invite");
    expect(await allowSignIn({ user: { email: null } })).toBe(false);
  });

  // A local build sent an unknown address to /signup and a known one to "check your email", which
  // told anyone who has an account.
  it("answers an email-link request for an unknown address just as for a known one", async () => {
    expect(
      await allowSignIn({
        user: { email: "new@example.com" },
        email: { verificationRequest: true },
      }),
    ).toBe("/api/auth/verify-request?provider=resend&type=email");
    expect(recordFailedSignIn).toHaveBeenCalledWith("no_invite");
  });

  it("redeems the code a Google sign-up brought along", async () => {
    cookieGet.mockReturnValue({ value: "ABCD-EFGH-JKMN" });
    vi.mocked(redeemInvite).mockResolvedValue("ok");

    expect(await allowSignIn({ user: { email: "new@example.com" } })).toBe(true);
    expect(redeemInvite).toHaveBeenCalledWith("ABCD-EFGH-JKMN", "new@example.com");
  });

  describe("Google", () => {
    const account = { provider: "google" };
    const REFUSED = "/login?error=GoogleAccountRefused";
    const verified = (email: string) => ({ email, email_verified: true });

    it("lets in a verified address", async () => {
      vi.mocked(mayCreateAccount).mockResolvedValue(true);
      const user = { email: "Sam@Example.com" };
      expect(await allowSignIn({ user, account, profile: verified("sam@example.com") })).toBe(true);
    });

    // src/auth.ts lets Google join an account with the same address, an admin's included.
    it.each([
      { email: "sam@example.com", email_verified: false },
      { email: "sam@example.com" },
      null,
    ])("refuses an address Google hasn't checked: %j", async (profile) => {
      vi.mocked(mayCreateAccount).mockResolvedValue(true);
      const user = { email: "sam@example.com" };
      expect(await allowSignIn({ user, account, profile })).toBe(REFUSED);
      expect(recordFailedSignIn).toHaveBeenCalledWith("google_unverified");
    });

    // Auth.js adds a Google account to whoever is signed in: a way back in after every sign-out.
    it("refuses to add another Google account to the signed-in person", async () => {
      vi.mocked(mayCreateAccount).mockResolvedValue(true);
      cookieGet.mockImplementation((name: string) =>
        name === "authjs.session-token" ? { value: "token" } : undefined,
      );
      vi.mocked(emailOfSession).mockResolvedValue("victim@example.com");
      const user = { email: "attacker@example.com" };
      expect(await allowSignIn({ user, account, profile: verified("attacker@example.com") })).toBe(
        REFUSED,
      );
      expect(recordFailedSignIn).toHaveBeenCalledWith("google_other_account");
    });

    it("refuses a Google account already joined to someone with another address", async () => {
      vi.mocked(mayCreateAccount).mockResolvedValue(true);
      const user = { email: "victim@example.com" };
      expect(await allowSignIn({ user, account, profile: verified("attacker@example.com") })).toBe(
        REFUSED,
      );
    });

    it("lets a signed-in person add their own Google account", async () => {
      vi.mocked(mayCreateAccount).mockResolvedValue(true);
      cookieGet.mockImplementation((name: string) =>
        name === "authjs.session-token" ? { value: "token" } : undefined,
      );
      vi.mocked(emailOfSession).mockResolvedValue("Sam@example.com");
      const user = { email: "sam@example.com" };
      expect(await allowSignIn({ user, account, profile: verified("sam@example.com") })).toBe(true);
    });
  });
});
