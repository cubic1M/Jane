import { describe, expect, it } from "vitest";
import { googleConfigured } from "./auth-providers";

// Google sign-in is on only with both halves of its OAuth client (docs/setup/google-sign-in.md).
describe("Google sign-in set up", () => {
  it("is on with both keys", () => {
    expect(googleConfigured({ AUTH_GOOGLE_ID: "id", AUTH_GOOGLE_SECRET: "secret" })).toBe(true);
  });

  it("is off with either missing or blank, as on the live site now", () => {
    expect(googleConfigured({})).toBe(false);
    expect(googleConfigured({ AUTH_GOOGLE_ID: "id" })).toBe(false);
    expect(googleConfigured({ AUTH_GOOGLE_SECRET: "secret" })).toBe(false);
    expect(googleConfigured({ AUTH_GOOGLE_ID: " ", AUTH_GOOGLE_SECRET: "secret" })).toBe(false);
  });
});
