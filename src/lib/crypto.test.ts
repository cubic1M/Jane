import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt, decryptBytes, encrypt, encryptBytes } from "./crypto";

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

describe("file encryption (spec step 68)", () => {
  beforeEach(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY));
  afterEach(() => vi.unstubAllEnvs());

  const file = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(5000)]);

  it("round-trips a file's bytes without keeping them in the clear", () => {
    const encrypted = Buffer.from(encryptBytes(file));
    expect(encrypted.includes(Buffer.from("%PDF"))).toBe(false);
    expect(decryptBytes(encrypted).equals(file)).toBe(true);
    expect(decryptBytes(encryptBytes(new Uint8Array())).length).toBe(0);
  });

  it("uses a fresh IV each time", () => {
    expect(Buffer.from(encryptBytes(file)).equals(Buffer.from(encryptBytes(file)))).toBe(false);
  });

  it("refuses a file that was changed, cut short or given another version", () => {
    const encrypted = encryptBytes(file);
    for (const index of [5, 20, 40, encrypted.length - 1]) {
      const changed = Buffer.from(encrypted);
      changed[index] ^= 0x01;
      expect(() => decryptBytes(changed), `byte ${index}`).toThrow();
    }
    expect(() => decryptBytes(encrypted.subarray(0, 20))).toThrow("Malformed");
    const versioned = Buffer.from(encrypted);
    versioned[0] = 2;
    expect(() => decryptBytes(versioned)).toThrow("Malformed");
  });

  it("refuses a file encrypted with another key", () => {
    const encrypted = encryptBytes(file);
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    expect(() => decryptBytes(encrypted)).toThrow();
  });
});
