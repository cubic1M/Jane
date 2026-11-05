import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { input } from "@/detection/__fixtures__/build";
import { safeToSpend } from "@/planning/safe-to-spend";

// An attack on the fix for stale balances: past 35 days the forecast says the balance is too old to
// walk forward, but "safe to spend" still read it as today's, which was the original bug.
const person = (balanceAsOf?: string) =>
  input({
    accounts: [
      {
        id: "a1",
        name: "Old Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 500_000,
        ...(balanceAsOf ? { balanceAsOf } : {}),
      },
    ],
    asOf: "2026-11-04",
  });
const money = { budgetsLeftCents: 0, goalsCents: 0 };

describe("safe to spend", () => {
  it("leaves out a balance too old to count, and says so", () => {
    const old = safeToSpend(person("2026-08-01"), money);
    expect(old.safeCents).toBeLessThanOrEqual(0);
    expect(old.leftOut).toContain("Old Checking");
  });

  it("still counts one from today", () => {
    const today = safeToSpend(person(), money);
    expect(today.safeCents).toBe(500_000);
    expect(today.leftOut).toEqual([]);
  });
});

describe("the row-level security probes", () => {
  // A switch marked "reads" is answered by the pool itself (src/lib/rls-pg.ts), so it can't fail.
  it("actually reach the database", () => {
    const code = (path: string) => readFileSync(path, "utf8");
    expect(code("src/lib/db-scoped.ts")).toMatch(
      /rlsSwitchFails\(asUserFlight\(\[asUser\(client, userId\)\]\)\)/,
    );
    expect(code("src/lib/system-db.ts")).toMatch(
      /\$transaction\(\[asSystem\(client\)\], SCOPED_QUERY_TRANSACTION\)/,
    );
  });
});
