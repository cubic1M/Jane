import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decrypt,
  decryptBytes,
  encrypt,
  encryptBytes,
  keyIdOf,
  keyIdOfBytes,
  rotate,
  rotateBytes,
} from "./crypto";

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
    versioned[0] = 9;
    expect(() => decryptBytes(versioned)).toThrow("Malformed");
  });

  it("refuses a file encrypted with another key", () => {
    const encrypted = encryptBytes(file);
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    expect(() => decryptBytes(encrypted)).toThrow();
  });
});

// Key rotation (docs/security/keys.md): a keyring of named keys, the original single key
// kept as "legacy".
describe("keyring encryption", () => {
  const LEGACY = randomBytes(32).toString("base64");
  const K2 = randomBytes(32).toString("base64");
  const K3 = randomBytes(32).toString("base64");
  const file = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(3000)]);

  function useKeys(env: { legacy?: string; keys?: string; current?: string }) {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", env.legacy ?? "");
    vi.stubEnv("TOKEN_ENCRYPTION_KEYS", env.keys ?? "");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", env.current ?? "");
  }
  afterEach(() => vi.unstubAllEnvs());

  it("with only today's single key, writes exactly today's v1 format", () => {
    useKeys({ legacy: LEGACY });
    const value = encrypt("access-production-abc");
    expect(value).toMatch(/^v1\.[^.]+\.[^.]+\.[^.]*$/);
    expect(keyIdOf(value)).toBe("legacy");
    expect(Buffer.from(encryptBytes(file))[0]).toBe(1);
    expect(rotate(value)).toBeNull();
  });

  it("writes v2 under the current named key, with the key's name on the value", () => {
    useKeys({ legacy: LEGACY, keys: `k2:${K2}`, current: "k2" });
    const value = encrypt("access-production-abc");
    expect(value.startsWith("v2.k2.")).toBe(true);
    expect(value).not.toContain("access-production-abc");
    expect(keyIdOf(value)).toBe("k2");
    expect(decrypt(value)).toBe("access-production-abc");
    expect(decrypt(encrypt(""))).toBe("");
    expect(encrypt("same")).not.toBe(encrypt("same"));

    const sealed = encryptBytes(file);
    expect(keyIdOfBytes(sealed.subarray(0, 34))).toBe("k2");
    expect(decryptBytes(sealed).equals(file)).toBe(true);
  });

  it("reads old and new values side by side", () => {
    useKeys({ legacy: LEGACY });
    const old = encrypt("old-token");
    const oldFile = encryptBytes(file);
    useKeys({ legacy: LEGACY, keys: `k2:${K2}`, current: "k2" });
    const middle = encrypt("middle-token");
    useKeys({ legacy: LEGACY, keys: `k2:${K2}, k3:${K3}`, current: "k3" });
    const fresh = encrypt("new-token");

    expect([old, middle, fresh].map(decrypt)).toEqual(["old-token", "middle-token", "new-token"]);
    expect([old, middle, fresh].map(keyIdOf)).toEqual(["legacy", "k2", "k3"]);
    expect(decryptBytes(oldFile).equals(file)).toBe(true);
  });

  it("rotates every format to the current key, and leaves current values alone", () => {
    useKeys({ legacy: LEGACY });
    const old = encrypt("old-token");
    const oldFile = encryptBytes(file);
    useKeys({ legacy: LEGACY, keys: `k2:${K2}`, current: "k2" });
    const middle = encrypt("middle-token");
    const middleFile = encryptBytes(file);
    useKeys({ legacy: LEGACY, keys: `k2:${K2}\nk3:${K3}`, current: "k3" });

    const rotated = [old, middle].map((v) => rotate(v)!);
    expect(rotated.map(keyIdOf)).toEqual(["k3", "k3"]);
    expect(rotated.map(decrypt)).toEqual(["old-token", "middle-token"]);
    expect(rotate(rotated[0])).toBeNull();

    // v2 to v2 re-wraps the data key only: the encrypted text itself stays the same.
    expect(rotated[1].split(".").slice(3)).toEqual(middle.split(".").slice(3));
    const movedFile = rotateBytes(middleFile)!;
    expect(
      Buffer.from(movedFile)
        .subarray(-file.length)
        .equals(Buffer.from(middleFile).subarray(-file.length)),
    ).toBe(true);
    expect(decryptBytes(movedFile).equals(file)).toBe(true);
    expect(decryptBytes(rotateBytes(oldFile)!).equals(file)).toBe(true);
    expect(rotateBytes(movedFile)).toBeNull();

    // Once nothing needs them, the old keys can go.
    useKeys({ keys: `k3:${K3}`, current: "k3" });
    expect(rotated.map(decrypt)).toEqual(["old-token", "middle-token"]);
    expect(decryptBytes(movedFile).equals(file)).toBe(true);
  });

  it("can roll back to the original key", () => {
    useKeys({ legacy: LEGACY, keys: `k2:${K2}`, current: "k2" });
    const value = encrypt("token");
    useKeys({ legacy: LEGACY, keys: `k2:${K2}` });
    const back = rotate(value)!;
    expect(keyIdOf(back)).toBe("legacy");
    useKeys({ legacy: LEGACY });
    expect(decrypt(back)).toBe("token");
  });

  it("fails safely, naming the key but never showing it, when a key is missing or wrong", () => {
    useKeys({ legacy: LEGACY, keys: `k2:${K2}`, current: "k2" });
    const value = encrypt("token");
    const sealed = encryptBytes(file);
    const old = (() => {
      useKeys({ legacy: LEGACY });
      return encrypt("old");
    })();

    const failures: string[] = [];
    const expectFailure = (run: () => unknown, message: string | RegExp) => {
      try {
        run();
      } catch (error) {
        failures.push(String(error));
        expect(String(error)).toMatch(message);
        return;
      }
      throw new Error("expected a failure");
    };

    useKeys({ legacy: LEGACY });
    expectFailure(() => decrypt(value), 'Encryption key "k2" is not configured');
    expectFailure(() => decryptBytes(sealed), 'Encryption key "k2" is not configured');
    useKeys({ legacy: LEGACY, keys: `k2:${K3}` });
    expectFailure(() => decrypt(value), /unable to authenticate|Unsupported state/);
    useKeys({ keys: `k2:${K2}`, current: "k2" });
    expectFailure(() => decrypt(old), "TOKEN_ENCRYPTION_KEY is not set");
    useKeys({ legacy: LEGACY, keys: `k2:${K2}`, current: "k9" });
    expectFailure(() => encrypt("x"), 'TOKEN_ENCRYPTION_KEY_CURRENT is "k9"');
    expectFailure(() => rotate(old), 'TOKEN_ENCRYPTION_KEY_CURRENT is "k9"');
    expect(decrypt(value)).toBe("token");
    useKeys({ legacy: LEGACY, keys: "k2:short", current: "k2" });
    expectFailure(() => encrypt("x"), 'TOKEN_ENCRYPTION_KEY_CURRENT is "k2"');
    expect(decrypt(old)).toBe("old");

    // A relabelled value isn't tried under another key.
    useKeys({ legacy: LEGACY, keys: `k2:${K2},k3:${K2}`, current: "k2" });
    expectFailure(
      () => decrypt(value.replace("v2.k2.", "v2.k3.")),
      /unable to authenticate|Unsupported state/,
    );
    expectFailure(() => decrypt("v2.k2.only-three"), "Malformed encrypted value");
    expectFailure(() => decrypt("v2.bad id.a.b.c.d"), "Malformed encrypted value");

    for (const failure of failures) {
      for (const key of [LEGACY, K2, K3]) {
        expect(failure).not.toContain(key);
        expect(failure).not.toContain(Buffer.from(key, "base64").toString("hex"));
        expect(failure).not.toContain(Buffer.from(key, "base64").toString("base64url"));
      }
      expect(failure).not.toContain("token");
    }
  });
});
