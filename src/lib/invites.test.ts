import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import {
  generateCode,
  inviteStatus,
  invitesRequired,
  isAdminEmail,
  normalizeCode,
} from "./invites";

describe("invite codes", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("are three groups of four unambiguous characters", () => {
    const code = generateCode();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(new Set(Array.from({ length: 50 }, generateCode)).size).toBe(50);
  });

  it("accept any spacing or case", () => {
    expect(normalizeCode(" abcd efgh-jkmn ")).toBe("ABCD-EFGH-JKMN");
    expect(normalizeCode("ABCD-EFGH-JKM")).toBeNull();
    expect(normalizeCode("ABCD-EFGH-JKM0")).toBeNull();
  });

  it("are required unless BETA_INVITE_ONLY is false (on by default)", () => {
    expect(invitesRequired()).toBe(true);
    vi.stubEnv("BETA_INVITE_ONLY", "true");
    expect(invitesRequired()).toBe(true);
    vi.stubEnv("BETA_INVITE_ONLY", " FALSE ");
    expect(invitesRequired()).toBe(false);
    vi.stubEnv("BETA_INVITE_ONLY", "0");
    expect(invitesRequired()).toBe(false);
  });

  it("say whether a code still works, revoked first", () => {
    const now = new Date("2026-10-25T00:00:00Z");
    const base = { revokedAt: null, expiresAt: null, uses: 0, maxUses: 1 };
    expect(inviteStatus(base, now)).toBe("active");
    expect(inviteStatus({ ...base, uses: 1 }, now)).toBe("used_up");
    expect(inviteStatus({ ...base, expiresAt: new Date("2026-10-24T00:00:00Z") }, now)).toBe(
      "expired",
    );
    expect(inviteStatus({ ...base, uses: 1, revokedAt: now }, now)).toBe("revoked");
  });

  it("aren't needed by ADMIN_EMAILS, matched case-insensitively", () => {
    vi.stubEnv("ADMIN_EMAILS", "Sam@Example.com, jo@example.com");
    expect(isAdminEmail("sam@example.com")).toBe(true);
    expect(isAdminEmail("jo@example.com")).toBe(true);
    expect(isAdminEmail("eve@example.com")).toBe(false);
  });
});
