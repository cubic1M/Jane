import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt } from "./crypto";

const KEY = randomBytes(32).toString("base64");

// Flip one bit in the base64url part at `index` of a "v1.iv.tag.ciphertext" value.
function tamper(payload: string, index: number): string {
  const parts = payload.split(".");
  const bytes = Buffer.from(parts[index], "base64url");
  bytes[0] ^= 0x01;
  parts[index] = bytes.toString("base64url");
  return parts.join(".");
}

describe("crypto", () => {
  beforeEach(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips a value", () => {
    const secret = "access-sandbox-1234abcd-5678-efgh";
    const encrypted = encrypt(secret);

    expect(encrypted).not.toContain(secret);
    expect(decrypt(encrypted)).toBe(secret);
  });

  it("round-trips unicode and empty strings", () => {
    expect(decrypt(encrypt("café ☕"))).toBe("café ☕");
    expect(decrypt(encrypt(""))).toBe("");
  });

  it("uses a fresh IV each time", () => {
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("rejects tampered ciphertext", () => {
    expect(() => decrypt(tamper(encrypt("secret"), 3))).toThrow();
  });

  it("rejects a tampered auth tag", () => {
    expect(() => decrypt(tamper(encrypt("secret"), 2))).toThrow();
  });

  it("rejects a tampered IV", () => {
    expect(() => decrypt(tamper(encrypt("secret"), 1))).toThrow();
  });

  it("rejects a value encrypted with a different key", () => {
    const encrypted = encrypt("secret");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));

    expect(() => decrypt(encrypted)).toThrow();
  });

  it("rejects malformed values", () => {
    expect(() => decrypt("not-encrypted")).toThrow("Malformed encrypted value");
    expect(() => decrypt(encrypt("secret").replace(/^v1/, "v2"))).toThrow(
      "Malformed encrypted value",
    );
  });

  it("requires a 32-byte key", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    expect(() => encrypt("secret")).toThrow("TOKEN_ENCRYPTION_KEY is not set");

    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(16).toString("base64"));
    expect(() => encrypt("secret")).toThrow("must be 32 bytes");
  });
});
