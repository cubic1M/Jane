import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backupCodeHashes, hashBackupCode } from "./backup-codes";

// An admin's backup codes were kept as a plain SHA-256: about 50 bits each, 10 per admin, so a copy
// of the database could be tried offline against all of them at once. They're keyed with the site's
// own secret now, and the old way still opens, so printed codes keep working.

const plain = (code: string) => createHash("sha256").update(code).digest("hex");

describe("an admin's backup codes, as kept", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("aren't a plain hash anyone can recompute from the code", () => {
    vi.stubEnv("AUTH_SECRET", "site-secret-one");
    expect(hashBackupCode("abcde-fghjk")).not.toBe(plain("abcdefghjk"));
    expect(hashBackupCode("ABCDE FGHJK")).toBe(hashBackupCode("abcde-fghjk"));
  });

  it("depend on the site's secret", () => {
    vi.stubEnv("AUTH_SECRET", "site-secret-one");
    const one = hashBackupCode("abcde-fghjk");
    vi.stubEnv("AUTH_SECRET", "site-secret-two");
    expect(hashBackupCode("abcde-fghjk")).not.toBe(one);
  });

  it("are still found when kept the old way", () => {
    vi.stubEnv("AUTH_SECRET", "site-secret-one");
    expect(backupCodeHashes("abcde-fghjk")).toEqual(
      expect.arrayContaining([hashBackupCode("abcde-fghjk"), plain("abcdefghjk")]),
    );
  });
});
