import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/lib/crypto";
import { sealSecrets } from "./secrets";
import { open, seal } from "./sealed";

// A value the server hands to a browser and takes back: it opens only as what was sealed, for the
// purpose and the person it was sealed for, while it is fresh. Anything else is null, never a throw.

const KEY = randomBytes(32).toString("base64");
const OTHER_KEY = randomBytes(32).toString("base64");
const NOW = new Date("2026-11-18T12:00:00Z");
const MINUTE = 60_000;
const after = (ms: number) => new Date(NOW.getTime() + ms);

const ME = "user_me";
const sealed = (data: unknown = "connected") => seal("a_purpose", ME, data, NOW);
const opened = (value: string | null | undefined) => open(value, "a_purpose", ME, MINUTE, NOW);

// The same value with one bit of its encrypted part changed.
function tampered(value: string): string {
  const parts = value.split(".");
  const last = Buffer.from(parts[parts.length - 1], "base64url");
  last[0] ^= 0x01;
  return [...parts.slice(0, -1), last.toString("base64url")].join(".");
}

beforeEach(() => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY);
  vi.stubEnv("TOKEN_ENCRYPTION_KEYS", "");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY_CURRENT", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("a sealed value", () => {
  it.each([
    ["a word", "connected"],
    ["an object", { session: "abc", disclosure: "2026-11-18" }],
    ["a list", [1, "two", null]],
    ["a number", 0],
    ["false", false],
    ["an empty string", ""],
  ])("opens to what was sealed: %s", (_what, data) => {
    expect(opened(sealed(data))).toEqual(data);
  });

  it("opens as nothing when nothing was sealed", () => {
    expect(opened(seal("a_purpose", ME, undefined, NOW))).toBeNull();
    expect(opened(seal("a_purpose", ME, null, NOW))).toBeNull();
  });

  it("shows nothing of what is inside, in any encoding", () => {
    const secret = `marker-${randomUUID()}`;
    const value = seal(`purpose-${secret}`, `user-${secret}`, { word: secret }, NOW);
    const forms = [
      secret,
      Buffer.from(secret).toString("base64"),
      Buffer.from(secret).toString("base64url"),
      Buffer.from(secret).toString("hex"),
    ];
    const decoded = value.split(".").map((p) => Buffer.from(p, "base64url").toString("latin1"));
    for (const form of forms) expect(value).not.toContain(form);
    expect(decoded.some((part) => part.includes(secret))).toBe(false);
  });

  it("is never the same twice, so two can't be compared", () => {
    expect(sealed()).not.toBe(sealed());
  });

  it("can go in an address and in a cookie as it is", () => {
    const value = sealed({ session: "abc", disclosure: "2026-11-18" });
    expect(value).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(encodeURIComponent(value)).toBe(value);
  });

  it("opens until it is as old as it may get, and not after", () => {
    const value = sealed();
    expect(open(value, "a_purpose", ME, MINUTE, after(MINUTE - 1))).toBe("connected");
    expect(open(value, "a_purpose", ME, MINUTE, after(MINUTE))).toBeNull();
    expect(open(value, "a_purpose", ME, MINUTE, after(24 * 60 * MINUTE))).toBeNull();
    expect(open(value, "a_purpose", ME, 0, NOW)).toBeNull();
  });

  it("opens on a server whose clock is a little behind the one that sealed it", () => {
    expect(open(sealed(), "a_purpose", ME, MINUTE, after(-2_000))).toBe("connected");
  });
});

describe("a value that won't open", () => {
  it("is another person's", () => {
    expect(open(sealed(), "a_purpose", "user_other", MINUTE, NOW)).toBeNull();
    expect(open(sealed(), "a_purpose", "", MINUTE, NOW)).toBeNull();
    expect(open(sealed(), "a_purpose", "USER_ME", MINUTE, NOW)).toBeNull();
  });

  it("was sealed for something else", () => {
    expect(open(sealed(), "another_purpose", ME, MINUTE, NOW)).toBeNull();
    expect(open(sealed(), "", ME, MINUTE, NOW)).toBeNull();
    expect(open(sealed(), "a_purpose ", ME, MINUTE, NOW)).toBeNull();
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty string", ""],
    ["text that was never encrypted", "connected"],
    [
      "what is inside, as plain JSON",
      JSON.stringify({ for: "a_purpose", userId: ME, at: 1, data: "x" }),
    ],
    ["a made-up value in the right shape", "v1.AAAA.BBBB.CCCC"],
    ["a very long value", "v1.".repeat(100_000)],
  ])("is %s", (_what, value) => {
    expect(opened(value)).toBeNull();
  });

  it("was changed by one bit", () => {
    expect(opened(tampered(sealed()))).toBeNull();
  });

  it("is missing a part", () => {
    expect(opened(sealed().split(".").slice(0, 3).join("."))).toBeNull();
  });

  it("was sealed under another key", () => {
    const value = sealed();
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", OTHER_KEY);
    expect(opened(value)).toBeNull();
  });

  it("can't be opened when there is no key at all", () => {
    const value = sealed();
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    expect(opened(value)).toBeNull();
  });

  // Encrypted with the same key by something else of ours, so it decrypts: what is inside refuses.
  it.each([
    ["a mailbox's tokens", () => sealSecrets({ accessToken: "a", refreshToken: "r" })],
    [
      "a sign-in cookie",
      () =>
        encrypt(
          JSON.stringify({ for: "gmail_sign_in", state: "s", userId: ME, at: NOW.getTime() }),
        ),
    ],
    ["text that isn't JSON", () => encrypt("connected")],
    ["a bare word", () => encrypt('"connected"')],
    ["a number", () => encrypt("5")],
    ["null", () => encrypt("null")],
    ["a list", () => encrypt(JSON.stringify(["a_purpose", ME, NOW.getTime(), "connected"]))],
    ["no time", () => encrypt(JSON.stringify({ for: "a_purpose", userId: ME, data: "connected" }))],
    [
      "a time written as text",
      () => encrypt(JSON.stringify({ for: "a_purpose", userId: ME, at: "now", data: "connected" })),
    ],
    [
      "a time in digits, as text",
      () =>
        encrypt(
          JSON.stringify({ for: "a_purpose", userId: ME, at: String(NOW.getTime()), data: "x" }),
        ),
    ],
    [
      "no person",
      () => encrypt(JSON.stringify({ for: "a_purpose", at: NOW.getTime(), data: "x" })),
    ],
    ["no purpose", () => encrypt(JSON.stringify({ userId: ME, at: NOW.getTime(), data: "x" }))],
  ])("holds %s", (_what, make) => {
    expect(opened(make())).toBeNull();
  });

  it("never throws, whatever it is given", () => {
    const odd = ["v1", "v2.....", ".", "v1.a.b", "v9.a.b.c", "\u0000", "v1.%.%.%", "{}", "[]"];
    for (const value of odd) expect(() => opened(value)).not.toThrow();
    for (const value of odd) expect(opened(value)).toBeNull();
  });
});
