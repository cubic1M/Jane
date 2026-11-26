import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { leaveHousehold } from "./household";

// Leaving a household while another connection holds the same membership. Runs against a real,
// migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("leaving a household while something else is ending the membership", () => {
  let client: PrismaClient;
  const people: string[] = [];
  const households: string[] = [];
  const connection = async () => {
    // As the owner: the suite's own login has no table of its own.
    const owner = process.env.TEST_OWNER_DATABASE_URL ?? url;
    const other = new pg.Client({ connectionString: owner });
    await other.connect();
    return other;
  };
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
  async function pair() {
    const person = () =>
      client.user.create({ data: { email: `leave-${crypto.randomUUID()}@example.com` } });
    const [leaver, stays] = [await person(), await person()];
    people.push(leaver.id, stays.id);
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
    return { leaver, householdId: household.id };
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.household.deleteMany({ where: { id: { in: households } } });
    await client.user.deleteMany({ where: { id: { in: people } } });
    await client.$disconnect();
  });

  // Account deletion takes the membership first: taking the bills first here, each waits on the other.
  it("takes the membership before it touches the shared bills", async () => {
    const { leaver, householdId } = await pair();
    const holder = await connection();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT 1 FROM household_members WHERE user_id = $1 FOR UPDATE", [
        leaver.id,
      ]);
      const leaving = leaveHousehold(leaver.id, { client });
      await blockedBy(holder);
      const bills = await holder.query(
        "SELECT 1 FROM shared_charges WHERE household_id = $1 FOR UPDATE NOWAIT",
        [householdId],
      );
      expect(bills.rowCount).toBe(1);
      await holder.query("COMMIT");
      await leaving;
    } finally {
      await holder.end();
    }
    expect(await client.householdMember.count({ where: { userId: leaver.id } })).toBe(0);
  });

  it("changes nothing when the membership has gone meanwhile", async () => {
    const { leaver, householdId } = await pair();
    vi.mocked(logAudit).mockClear();
    const holder = await connection();
    try {
      await holder.query("BEGIN");
      await holder.query("DELETE FROM household_members WHERE user_id = $1", [leaver.id]);
      const leaving = leaveHousehold(leaver.id, { client });
      await blockedBy(holder);
      await holder.query("COMMIT");
      await expect(leaving).resolves.toBeUndefined();
    } finally {
      await holder.end();
    }
    expect(await client.sharedCharge.count({ where: { householdId } })).toBe(1);
    expect(logAudit).not.toHaveBeenCalled();
  });
});
