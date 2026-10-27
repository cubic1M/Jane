import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { rlsCoverage, rlsSwitchWorks } from "./rls-coverage";

// What /admin/health and the daily check read about row-level security, against a real, migrated
// and protected Postgres (CI runs scripts/rls-protect.mjs after migrating).
const url = process.env.TEST_DATABASE_URL;

class Undo extends Error {}

describe.runIf(url)("row-level security coverage", () => {
  let client: PrismaClient;

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(() => client.$disconnect());

  it("covers every user-owned table, the ones owned through a parent too", async () => {
    const coverage = await rlsCoverage({ client });

    expect(coverage.role).toBe(true);
    expect(coverage.missing).toEqual([]);
    expect(coverage.ok).toBe(true);
    expect(coverage.tables.length).toBeGreaterThan(150);
    const names = coverage.tables.map((t) => t.table);
    expect(names).toEqual(expect.arrayContaining(["transactions", "gifts", "users", "households"]));
    // The system's own records have no policy on purpose.
    expect(names).not.toContain("audit_log");
    expect(names).not.toContain("analytics_events");
    const transactions = coverage.tables.find((t) => t.table === "transactions");
    expect(transactions).toEqual({
      table: "transactions",
      rls: true,
      policies: 2,
      personPolicy: true,
      ok: true,
    });
  });

  it("shows a new user-owned table as a gap until it is protected", async () => {
    // Inside a transaction that is undone, so no other test ever sees the table.
    const table = `rls_coverage_${crypto.randomUUID().slice(0, 8)}`;
    const seen: Awaited<ReturnType<typeof rlsCoverage>>[] = [];
    await expect(
      client.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`CREATE TABLE "${table}" (id text PRIMARY KEY, user_id text)`);
        seen.push(await rlsCoverage({ client: tx }));
        await tx.$queryRawUnsafe("SELECT * FROM jane_rls_protect_all()");
        seen.push(await rlsCoverage({ client: tx }));
        throw new Undo();
      }),
    ).rejects.toBeInstanceOf(Undo);

    const [before, after] = seen;
    expect(before.ok).toBe(false);
    expect(before.missing).toEqual([table]);
    expect(before.tables.find((t) => t.table === table)).toMatchObject({
      rls: false,
      policies: 0,
      ok: false,
    });
    expect(after.ok).toBe(true);
    expect(after.tables.find((t) => t.table === table)).toMatchObject({ rls: true, ok: true });
  });

  it("finds, live, that a person's queries switch to jane_rls", async () => {
    expect(await rlsSwitchWorks("someone", { client })).toBe(true);
  });
});
