import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateSecret, otpauthUri, totp, verifyTotp } from "./totp";

// RFC 6238 appendix B test vectors (SHA-1, secret "12345678901234567890"), last 6 digits.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("totp", () => {
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("matches the RFC 6238 vector at %i", (seconds, code) => {
    expect(totp(RFC_SECRET, new Date(seconds * 1000))).toBe(code);
  });

  it("accepts the current code and one step either side, nothing else", () => {
    const secret = generateSecret();
    const now = new Date("2026-10-19T12:00:00Z");

    expect(verifyTotp(secret, totp(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now, -1), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now, 2), now)).toBe(false);
    expect(verifyTotp(secret, "12345", now)).toBe(false);
    expect(verifyTotp(secret, "abcdef", now)).toBe(false);
  });

  it("round-trips base32 and builds an authenticator link", () => {
    const bytes = Buffer.from("hello world");
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(generateSecret()).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri("team@example.com", "ABC")).toBe(
      "otpauth://totp/Financial%20Controller%3Ateam%40example.com?secret=ABC&issuer=Financial+Controller&algorithm=SHA1&digits=6&period=30",
    );
  });
});
