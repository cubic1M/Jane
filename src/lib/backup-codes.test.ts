import { describe, expect, it } from "vitest";
import {
  generateBackupCodes,
  hashBackupCode,
  looksLikeBackupCode,
  normalizeBackupCode,
} from "./backup-codes";

describe("backup codes", () => {
  it("makes ten different, easy-to-read codes", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-hjkmnp-z2-9]{5}-[a-hjkmnp-z2-9]{5}$/);
  });

  it("hashes the same code however it's typed, and never keeps the code itself", () => {
    expect(normalizeBackupCode(" ABCDE-fghjk ")).toBe("abcdefghjk");
    expect(hashBackupCode("ABCDE FGHJK")).toBe(hashBackupCode("abcde-fghjk"));
    expect(hashBackupCode("abcde-fghjk")).not.toContain("abcde");
  });

  it("tells a backup code from a 6-digit app code", () => {
    expect(looksLikeBackupCode("abcde-fghjk")).toBe(true);
    expect(looksLikeBackupCode("123 456")).toBe(false);
  });
});
