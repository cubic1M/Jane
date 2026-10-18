import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { generateCode, invitesRequired, isAdminEmail, normalizeCode } from "./invites";

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

  it("are required unless OPEN_SIGNUPS is true", () => {
    expect(invitesRequired()).toBe(true);
    vi.stubEnv("OPEN_SIGNUPS", "true");
    expect(invitesRequired()).toBe(false);
  });

  it("aren't needed by ADMIN_EMAILS, matched case-insensitively", () => {
    vi.stubEnv("ADMIN_EMAILS", "Sam@Example.com, jo@example.com");
    expect(isAdminEmail("sam@example.com")).toBe(true);
    expect(isAdminEmail("jo@example.com")).toBe(true);
    expect(isAdminEmail("eve@example.com")).toBe(false);
  });
});
