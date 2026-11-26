import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { deleteAllData } from "./account-deletion";

// Account deletion with another connection acting at the same moment. Runs against a real, migrated
// Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("deleting an account while something else changes it", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const households: string[] = [];
  const person = async () => {
    const user = await client.user.create({
      data: { email: `locks-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user;
  };
  const connection = async () => {
    // As the owner: the suite's own login has no table of its own.
    const owner = process.env.TEST_OWNER_DATABASE_URL ?? url;
    const other = new pg.Client({ connectionString: owner });
    await other.connect();
    return other;
  };
  // Until the deletion is waiting on a lock `holder` has.
  const blockedBy = async (holder: pg.Client) => {
    const { rows } = await holder.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const watcher = await connection();
    try {
      await vi.waitFor(
        async () => {
          const waiting = await watcher.query(
            "SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
            [rows[0].pid],
          );
          expect(waiting.rowCount).toBeGreaterThan(0);
        },
        { timeout: 20_000, interval: 50 },
      );
    } finally {
      await watcher.end();
    }
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.household.deleteMany({ where: { id: { in: households } } });
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  // The bank would go with the account's row and never be ended at Plaid.
  it("makes a bank linked part way through wait, rather than slip in", async () => {
    const user = await person();
    await client.waitlistEntry.create({ data: { email: user.email! } });
    const holder = await connection();
    const linker = await connection();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT 1 FROM waitlist WHERE email = $1 FOR UPDATE", [user.email]);
      const deleting = deleteAllData(user.id, { client });
      await blockedBy(holder);
      await linker.query("SET lock_timeout = '500ms'");
      await expect(
        linker.query(
          `INSERT INTO plaid_items (id, user_id, plaid_item_id, access_token_encrypted, updated_at)
           VALUES ($1, $2, $1, 'x', now())`,
          [`late-${user.id}`, user.id],
        ),
      ).rejects.toMatchObject({ code: "55P03" });
      await holder.query("COMMIT");
      await deleting;
    } finally {
      await holder.end();
      await linker.end();
    }
    expect(await client.user.count({ where: { id: user.id } })).toBe(0);
  });

  it("leaves the shared bills alone when the person has just left the household", async () => {
    const [leaver, stays] = [await person(), await person()];
    const household = await client.household.create({ select: { id: true } });
    households.push(household.id);
    await client.householdMember.createMany({
      data: [leaver, stays].map((u) => ({ householdId: household.id, userId: u.id })),
    });
    await client.sharedCharge.create({
      data: {
        householdId: household.id,
        transactionId: `shared-${stays.id}`,
        payerId: stays.id,
        amountCents: 10_000,
        partnerShareBps: 5_000,
        userId: stays.id,
      },
    });
    const holder = await connection();
    try {
      await holder.query("BEGIN");
      await holder.query("DELETE FROM household_members WHERE user_id = $1", [leaver.id]);
      const deleting = deleteAllData(leaver.id, { client });
      await blockedBy(holder);
      await holder.query("COMMIT");
      await deleting;
    } finally {
      await holder.end();
    }
    expect(await client.sharedCharge.count({ where: { householdId: household.id } })).toBe(1);
  });
});
