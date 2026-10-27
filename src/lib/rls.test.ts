import { afterEach, describe, expect, it, vi } from "vitest";

const recordError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/error-log", () => ({ recordError }));
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  AS_USER_READ_SQL,
  AS_USER_SQL,
  asUser,
  isAsUser,
  resetRlsForTests,
  rlsStatus,
  withRls,
} from "./rls";

const missingRole = new Error(
  'Raw query failed. Code: `42704`. Message: `role "jane_rls" does not exist`',
);

describe("withRls", () => {
  afterEach(() => {
    resetRlsForTests();
    vi.unstubAllEnvs();
  });

  it("runs with row-level security when the database has it", async () => {
    const attempt = vi.fn(async (rls: boolean) => rls);

    expect(await withRls(attempt)).toBe(true);
    expect(rlsStatus()).toBe("on");
  });

  it("falls back to the app's own filter once, and remembers, when the role is missing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const attempt = vi.fn(async (rls: boolean) => {
      if (rls) throw missingRole;
      return "ok";
    });

    expect(await withRls(attempt)).toBe("ok");
    expect(await withRls(attempt)).toBe("ok");
    expect(attempt.mock.calls.map(([rls]) => rls)).toEqual([true, false, false]);
    expect(rlsStatus()).toBe("off");
    expect(console.error).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(recordError).toHaveBeenCalledTimes(1));
    expect(String(recordError.mock.calls[0][0])).toContain("Row-level security is off");
  });

  it("fails closed with RLS_REQUIRED=1", async () => {
    vi.stubEnv("RLS_REQUIRED", "1");

    await expect(withRls(async () => Promise.reject(missingRole))).rejects.toBe(missingRole);
    expect(rlsStatus()).toBe("unknown");
  });

  it("never retries other errors, or a role error from the work rather than the switch", async () => {
    const other = new Error("permission denied for table audit_log");
    await expect(withRls(async () => Promise.reject(other))).rejects.toBe(other);

    const attempt = vi.fn(async () => Promise.reject(missingRole));
    await expect(withRls(attempt, () => false)).rejects.toBe(missingRole);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(rlsStatus()).toBe("unknown");
  });
});

describe("asUser", () => {
  it("sets the role and the person's id, transaction-local, as a parameter", () => {
    const $executeRawUnsafe = vi.fn();
    asUser({ $executeRawUnsafe }, "user_1");

    expect($executeRawUnsafe).toHaveBeenCalledWith(AS_USER_SQL, "user_1");
    expect(AS_USER_SQL).toContain("set_config('role', 'jane_rls', true)");
    expect(AS_USER_SQL).toContain("set_config('app.user_id', $1, true)");
    expect(isAsUser("$executeRawUnsafe", [AS_USER_SQL, "user_1"])).toBe(true);
    expect(isAsUser("$executeRawUnsafe", [AS_USER_READ_SQL, "user_1"])).toBe(true);
    expect(isAsUser("$executeRawUnsafe", ["DELETE FROM findings"])).toBe(false);
  });

  it("refuses an empty user id", () => {
    expect(() => asUser({ $executeRawUnsafe: vi.fn() }, "")).toThrow();
  });
});
