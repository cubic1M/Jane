import { AuthError } from "@auth/core/errors";
import { describe, expect, it, vi } from "vitest";
import { authErrorMessage } from "./auth-errors";
import { MagicLinkSendError } from "./magic-link-error";

// The real class next-auth re-exports: next-auth itself can't load outside Next.js.
vi.mock("next-auth", async () => ({
  AuthError: (await import("@auth/core/errors")).AuthError,
}));

describe("authErrorMessage", () => {
  it("returns nothing without an error", () => {
    expect(authErrorMessage(undefined)).toBeNull();
    expect(authErrorMessage("")).toBeNull();
  });

  it("explains an expired or reused magic link", () => {
    expect(authErrorMessage("Verification")).toContain("expired or was already used");
  });

  it("uses the first value when the code repeats", () => {
    expect(authErrorMessage(["InvalidEmail", "Verification"])).toBe("Enter a valid email address.");
  });

  it("falls back to a generic message for unknown codes", () => {
    expect(authErrorMessage("Configuration")).toBe(
      "Something went wrong signing you in. Please try again.",
    );
  });
});

// Founder's admin sign-in, 11-02: a failed send read "Something went wrong signing you in".
describe("a sign-in email that couldn't be sent", () => {
  it("says so", () => {
    expect(authErrorMessage("EmailSignInError")).toBe(
      "We couldn't send your sign-in email. Please try again in a few minutes.",
    );
  });

  it("comes as the Auth.js error type that says so, to show on the sign-in page", () => {
    const error = new MagicLinkSendError();
    expect(error.type).toBe("EmailSignInError");
    expect(error.kind).toBe("signIn");
    expect(error).toBeInstanceOf(AuthError);
  });
});
