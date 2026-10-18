import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { codeMatches, hashCode, maskPhone, newCode, normalizeUsPhone, phoneHmac } from "./phone";

describe("normalizeUsPhone (spec step 78)", () => {
  it.each([
    "(415) 555-2671",
    "415-555-2671",
    "415.555.2671",
    "4155552671",
    "+1 415 555 2671",
    "1-415-555-2671",
    "+14155552671",
    " 415 555 2671 ",
  ])("reads %j as +14155552671", (input) => {
    expect(normalizeUsPhone(input)).toBe("+14155552671");
  });

  it.each([
    "",
    "555-2671",
    "+44 20 7946 0958",
    "+4155552671",
    "(015) 555-2671",
    "(415) 155-2671",
    "41555526711",
    "415-555-267a",
    "call me",
    "1".repeat(40),
  ])("refuses %j", (input) => {
    expect(normalizeUsPhone(input)).toBeNull();
  });

  it("shows only the last four digits", () => {
    expect(maskPhone("+14155552671")).toBe("(•••) •••-2671");
  });
});

describe("codes and the number's fingerprint", () => {
  beforeEach(() => vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64")));
  afterEach(() => vi.unstubAllEnvs());

  it("makes six-digit codes", () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^\d{6}$/);
  });

  it("stores a keyed hash of the code, tied to the person", () => {
    const hash = hashCode("u1", "123456");
    expect(hash).not.toContain("123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(codeMatches("u1", "123456", hash)).toBe(true);
    expect(codeMatches("u1", "123 456", hash)).toBe(true);
    expect(codeMatches("u1", "123457", hash)).toBe(false);
    expect(codeMatches("u2", "123456", hash)).toBe(false);
    expect(codeMatches("u1", "12345", hash)).toBe(false);
    expect(codeMatches("u1", "", hash)).toBe(false);
  });

  it("depends on the key, so a database alone can't be matched to numbers", () => {
    const first = phoneHmac("+14155552671");
    expect(first).toBe(phoneHmac("+14155552671"));
    expect(first).not.toBe(phoneHmac("+14155552672"));
    expect(first).not.toContain("4155552671");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    expect(phoneHmac("+14155552671")).not.toBe(first);
  });
});
