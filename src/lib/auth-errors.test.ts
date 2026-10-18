import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./auth-errors";

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
