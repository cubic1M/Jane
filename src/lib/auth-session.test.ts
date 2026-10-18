import { describe, expect, it } from "vitest";
import { sessionPayload } from "./auth-session";

const USER = {
  id: "u1",
  email: "ada@example.com",
  emailVerified: null,
  name: "Ada",
  image: null,
  role: "user" as const,
  termsVersion: "2026-10-18",
  mfaEnabled: false,
};
const EXPIRES = new Date("2099-01-01T00:00:00Z");

describe("sessionPayload", () => {
  it("never includes the session token or user id fields beyond the user", () => {
    const payload = sessionPayload({
      session: { sessionToken: "secret-token", userId: "u1", expires: EXPIRES } as never,
      user: USER,
    });
    expect(JSON.stringify(payload)).not.toContain("secret-token");
    expect(payload).toEqual({
      expires: "2099-01-01T00:00:00.000Z",
      user: {
        id: "u1",
        email: "ada@example.com",
        name: "Ada",
        image: null,
        role: "user",
        termsVersion: "2026-10-18",
      },
      mfaPending: false,
    });
  });

  it("is pending until a code is entered, only when two-factor is on", () => {
    const user = { ...USER, mfaEnabled: true };
    expect(sessionPayload({ session: { expires: EXPIRES }, user }).mfaPending).toBe(true);
    expect(
      sessionPayload({ session: { expires: EXPIRES, mfaVerified: true }, user }).mfaPending,
    ).toBe(false);
  });
});
