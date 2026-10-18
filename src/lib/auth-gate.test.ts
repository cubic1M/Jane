import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookieGet } = vi.hoisted(() => ({ cookieGet: vi.fn() }));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: cookieGet })) }));
vi.mock("@/lib/invites", () => ({
  mayCreateAccount: vi.fn(),
  redeemInvite: vi.fn(),
  isAdminEmail: vi.fn(),
}));

import { mayCreateAccount, redeemInvite } from "@/lib/invites";
import { allowSignIn } from "./auth-gate";

describe("allowSignIn", () => {
  beforeEach(() => {
    vi.mocked(mayCreateAccount).mockReset().mockResolvedValue(false);
    vi.mocked(redeemInvite).mockReset();
    cookieGet.mockReset().mockReturnValue(undefined);
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
    expect(await allowSignIn({ user: { email: null } })).toBe(false);
  });

  it("redeems the code a Google sign-up brought along", async () => {
    cookieGet.mockReturnValue({ value: "ABCD-EFGH-JKMN" });
    vi.mocked(redeemInvite).mockResolvedValue("ok");

    expect(await allowSignIn({ user: { email: "new@example.com" } })).toBe(true);
    expect(redeemInvite).toHaveBeenCalledWith("ABCD-EFGH-JKMN", "new@example.com");
  });
});
