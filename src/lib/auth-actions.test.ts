import { beforeEach, describe, expect, it, vi } from "vitest";

const { AuthError } = vi.hoisted(() => ({
  AuthError: class AuthError extends Error {
    type = "Configuration";
  },
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
});
