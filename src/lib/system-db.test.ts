import { afterEach, describe, expect, it, vi } from "vitest";

const recordError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/error-log", () => ({ recordError }));
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  AS_SYSTEM_SQL,
  asSystem,
  isRoleSwitch,
  resetRlsForTests,
  systemRoleStatus,
  withSystemRole,
} from "./rls";
import { systemDb, systemTransaction } from "./system-db";

const missingRole = new Error(
  'Raw query failed. Code: `42704`. Message: `role "jane_system" does not exist`',
);

describe("withSystemRole", () => {
  afterEach(() => {
    resetRlsForTests();
    vi.unstubAllEnvs();
  });

  it("switches when the database has the role", async () => {
    expect(await withSystemRole(async (switched) => switched)).toBe(true);
    expect(systemRoleStatus()).toBe("on");
  });

  it("falls back to the login role once, and reports it, when the role is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const attempt = vi.fn(async (switched: boolean) => {
      if (switched) throw missingRole;
      return "ok";
    });

    expect(await withSystemRole(attempt)).toBe("ok");
    expect(await withSystemRole(attempt)).toBe("ok");
    expect(attempt.mock.calls.map(([switched]) => switched)).toEqual([true, false, false]);
    expect(systemRoleStatus()).toBe("off");
    await vi.waitFor(() => expect(recordError).toHaveBeenCalledTimes(1));
    expect(String(recordError.mock.calls[0][0])).toContain("jane_system role is off");
  });

  it("fails closed with RLS_REQUIRED=1", async () => {
    vi.stubEnv("RLS_REQUIRED", "1");

    await expect(withSystemRole(async () => Promise.reject(missingRole))).rejects.toBe(missingRole);
    expect(systemRoleStatus()).toBe("unknown");
  });

  it("never retries other errors", async () => {
    const other = new Error("permission denied for table jobs");
    const attempt = vi.fn(async () => Promise.reject(other));

    await expect(withSystemRole(attempt)).rejects.toBe(other);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});

describe("the switch statement", () => {
  it("isn't counted as a write by the read cache", () => {
    expect(isRoleSwitch("$executeRawUnsafe", [AS_SYSTEM_SQL])).toBe(true);
    expect(isRoleSwitch("$executeRawUnsafe", ["DELETE FROM users"])).toBe(false);
  });

  it("marks what the transaction does, for the app's pool", () => {
    const client = { $executeRawUnsafe: vi.fn((_sql: string) => 1) };
    asSystem(client as never, "reads");
    asSystem(client as never, "writes");
    asSystem(client as never);
    expect(client.$executeRawUnsafe.mock.calls.map(([sql]) => sql)).toEqual([
      `${AS_SYSTEM_SQL} /* reads */`,
      `${AS_SYSTEM_SQL} /* writes */`,
      AS_SYSTEM_SQL,
    ]);
  });
});

describe("a reason", () => {
  it("is required, in words", async () => {
    expect(() => systemDb("  ", {} as never)).toThrow("needs a reason");
    expect(() => systemTransaction("", async () => 1, {} as never)).toThrow("needs a reason");
  });
});
