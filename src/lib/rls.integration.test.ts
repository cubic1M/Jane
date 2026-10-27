import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { scopedFor } from "./db-scoped";
import { asUserTransaction, rlsStatus } from "./rls";
import { rlsPool } from "./rls-pg";

// Row-level security (docs/security/rls.md) against a real, migrated Postgres. The database
// itself refuses one person's rows to another: through every scoped helper, and through queries
// that forget to scope at all (Prisma calls with no user filter, raw SQL) while a person's id is
// set. The app's own role, which cron jobs, admin pages, retention and trial cleanup use, keeps
// its full access, and nothing of a scoped transaction is left on a pooled connection. All of it
// holds through a plain pg connection (tests, other tools) and through the app's own pool, which
// sends a scoped query in one round trip (src/lib/rls-pg.ts).

const url = process.env.TEST_DATABASE_URL;

type Plan = { table_name: string; kind: string; visible: string | null; privileges: string[] };

const connections: [string, (max?: number) => PrismaPg][] = [
  ["a plain pg connection", (max) => new PrismaPg({ connectionString: url!, max })],
  ["the app's pool", (max) => new PrismaPg(rlsPool(url, { max }))],
];

describe.runIf(url).each(connections)("row-level security, through %s", (_, adapter) => {
  let client: PrismaClient;
  let plan: Plan[];
  const suffix = crypto.randomUUID();
  let alice: { userId: string; findingId: string; budgetId: string };
  let bob: { userId: string; findingId: string; budgetId: string };

  async function seedUser(name: string) {
    const user = await client.user.create({ data: { email: `rls-${name}-${suffix}@example.com` } });
    const finding = await client.finding.create({
      data: {
        userId: user.id,
        type: "bank_fees",
        key: "account:checking",
        title: `${name}'s fees`,
        confidence: "high",
        annualSavingsCents: 3500,
      },
    });
    const budget = await client.budget.create({
      data: { userId: user.id, category: "FOOD_AND_DRINK", amountCents: 40_000 },
    });
    const link = await client.giftLink.create({
      data: { userId: user.id, token: `rls-${name}-${suffix}`, collegePlanId: "plan" },
    });
    await client.gift.create({
      data: { giftLinkId: link.id, amountCents: 1000, giverName: "Gran" },
    });
    return { userId: user.id, findingId: finding.id, budgetId: budget.id };
  }

  const owned = () => plan.filter((p) => p.kind === "owner").map((p) => p.table_name);

  beforeAll(async () => {
    client = new PrismaClient({ adapter: adapter() });
    plan = await client.$queryRaw<Plan[]>`SELECT * FROM jane_rls_plan()`;
    alice = await seedUser("alice");
    bob = await seedUser("bob");
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: [alice.userId, bob.userId] } } });
    await client.$disconnect();
  });

  describe("the tables", () => {
    it("protects every table with a user_id, except the system's own records", async () => {
      const withUserId = await client.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'user_id' ORDER BY table_name`;
      const records = ["analytics_events", "audit_log"];

      expect(owned().sort()).toEqual(
        withUserId.map((t) => t.table_name).filter((t) => !records.includes(t)),
      );
      expect(owned().length).toBeGreaterThan(100);
    });

    it("has row-level security on, with the user policy, wherever jane_rls can see anything", async () => {
      const state = await client.$queryRaw<
        { table_name: string; rls: boolean; policies: string[] }[]
      >`
        SELECT c.relname AS table_name, c.relrowsecurity AS rls,
          coalesce(array_agg(p.polname::text) FILTER (WHERE p.polname IS NOT NULL), '{}') AS policies
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
        LEFT JOIN pg_policy p ON p.polrelid = c.oid
        WHERE c.relkind = 'r'
        GROUP BY c.relname, c.relrowsecurity`;
      const byName = new Map(state.map((s) => [s.table_name, s]));

      for (const p of plan.filter((p) => p.visible !== null)) {
        const s = byName.get(p.table_name);
        expect(s?.rls, p.table_name).toBe(true);
        expect(s?.policies.sort(), p.table_name).toEqual(["jane_rls_owner", "jane_system"]);
      }
      // Tables owned through a parent, and the two shared ones a person's rows point at.
      expect(plan.find((p) => p.table_name === "gifts")?.kind).toBe("child");
      expect(plan.find((p) => p.table_name === "users")?.kind).toBe("self");
      expect(plan.find((p) => p.table_name === "households")?.kind).toBe("household");
    });

    it("gives jane_rls nothing on the audit log, analytics, sign-in tokens or jobs", async () => {
      const rows = await client.$queryRaw<{ table_name: string; any: boolean }[]>`
        SELECT t AS table_name,
          has_table_privilege('jane_rls', format('public.%I', t), 'SELECT,INSERT,UPDATE,DELETE') AS any
        FROM unnest(ARRAY['audit_log', 'analytics_events', 'verification_tokens', 'jobs',
          'rate_limits', 'invite_codes', 'waitlist', 'error_events', '_prisma_migrations']) t`;

      expect(rows.filter((r) => r.any)).toEqual([]);
      for (const p of plan.filter((p) => p.kind === "none")) expect(p.privileges).toEqual([]);
    });

    it("is a role nobody can sign in as and that can't skip the policies", async () => {
      const [role] = await client.$queryRaw<
        { rolcanlogin: boolean; rolbypassrls: boolean; rolsuper: boolean }[]
      >`SELECT rolcanlogin, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'jane_rls'`;

      expect(role).toEqual({ rolcanlogin: false, rolbypassrls: false, rolsuper: false });
    });

    it("protect_all is idempotent and finishes every table", async () => {
      const [first] = await client.$queryRaw<{ protected: number; skipped: string[] }[]>`
        SELECT * FROM jane_rls_protect_all()`;

      expect(first.skipped).toEqual([]);
      expect(first.protected).toBe(plan.length);
    });
  });

  describe("a query that forgets to scope, while Alice's id is set", () => {
    it("sees only Alice's rows through Prisma with no user filter", async () => {
      const seen = await asUserTransaction(client, alice.userId, async (tx) => ({
        findings: await tx.finding.findMany({ select: { userId: true } }),
        budgets: await tx.budget.findMany({ select: { userId: true } }),
        gifts: await tx.gift.findMany({ select: { link: { select: { userId: true } } } }),
        users: await tx.user.findMany({ select: { id: true } }),
        bobsFinding: await tx.finding.findUnique({ where: { id: bob.findingId } }),
      }));

      expect(seen.findings.map((f) => f.userId)).toEqual([alice.userId]);
      expect(seen.budgets.map((b) => b.userId)).toEqual([alice.userId]);
      expect(seen.gifts.map((g) => g.link.userId)).toEqual([alice.userId]);
      expect(seen.users).toEqual([{ id: alice.userId }]);
      expect(seen.bobsFinding).toBeNull();
    });

    it("sees none of anyone else's rows in any user-owned table, through raw SQL", async () => {
      const foreign = await asUserTransaction(client, alice.userId, async (tx) => {
        const counts: Record<string, number> = {};
        for (const table of owned()) {
          const [row] = await tx.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT count(*) AS n FROM "${table}" WHERE user_id <> $1`,
            alice.userId,
          );
          if (Number(row.n) > 0) counts[table] = Number(row.n);
        }
        return counts;
      });

      expect(foreign).toEqual({});
      // The app's own role does see other people's rows in those tables.
      expect(
        await client.finding.count({ where: { userId: { not: alice.userId } } }),
      ).toBeGreaterThan(0);
    });

    it("can't update, delete or take over Bob's rows through raw SQL", async () => {
      const changed = await asUserTransaction(client, alice.userId, async (tx) => ({
        updated:
          await tx.$executeRaw`UPDATE findings SET title = 'hacked' WHERE id = ${bob.findingId}`,
        deleted: await tx.$executeRaw`DELETE FROM budgets WHERE user_id = ${bob.userId}`,
        everything: await tx.$executeRaw`DELETE FROM gifts`,
      }));
      // Only her own gift was in reach.
      expect(changed).toEqual({ updated: 0, deleted: 0, everything: 1 });

      await expect(
        asUserTransaction(
          client,
          alice.userId,
          (tx) =>
            tx.$executeRaw`INSERT INTO budgets (id, user_id, category, amount_cents, updated_at)
            VALUES (${`rls-${suffix}`}, ${bob.userId}, 'GENERAL', 1, now())`,
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        asUserTransaction(
          client,
          alice.userId,
          (tx) =>
            tx.$executeRaw`UPDATE budgets SET user_id = ${bob.userId} WHERE id = ${alice.budgetId}`,
        ),
      ).rejects.toThrow(/row-level security/);

      const bobs = await client.finding.findUniqueOrThrow({ where: { id: bob.findingId } });
      expect(bobs.title).toBe("bob's fees");
      expect(await client.budget.count({ where: { userId: bob.userId } })).toBe(1);
      expect(await client.gift.count({ where: { link: { userId: bob.userId } } })).toBe(1);
    });

    it("can't read the audit log, analytics or sign-in tokens at all", async () => {
      for (const table of ["audit_log", "analytics_events", "verification_tokens", "sessions"]) {
        const read = asUserTransaction(client, alice.userId, (tx) =>
          tx.$queryRawUnsafe(
            `SELECT count(*) FROM "${table}" WHERE user_id IS DISTINCT FROM $1`,
            alice.userId,
          ),
        );
        if (table === "sessions") expect(await read).toEqual([{ count: BigInt(0) }]);
        else await expect(read, table).rejects.toThrow(/permission denied|does not exist/);
      }
    });
  });

  describe("every scoped helper", () => {
    it("reads, updates and deletes nothing of Bob's, asked for by his user id", async () => {
      const asAlice = scopedFor(alice.userId, client) as unknown as Record<string, unknown>;
      type Delegate = {
        findMany: (a: unknown) => Promise<unknown[]>;
        updateMany: (a: unknown) => Promise<{ count: number }>;
        deleteMany: (a: unknown) => Promise<{ count: number }>;
      };
      const delegates = Object.entries(asAlice).filter(
        (e): e is [string, Delegate] =>
          typeof (e[1] as Delegate | undefined)?.findMany === "function",
      );
      expect(delegates.length).toBeGreaterThan(100);

      const leaks: string[] = [];
      for (const [name, delegate] of delegates) {
        const where = { userId: bob.userId };
        if ((await delegate.findMany({ where })).length > 0) leaks.push(`${name}.findMany`);
        if ((await delegate.updateMany({ where, data: {} })).count > 0)
          leaks.push(`${name}.updateMany`);
        if ((await delegate.deleteMany({ where })).count > 0) leaks.push(`${name}.deleteMany`);
      }
      expect(leaks).toEqual([]);
      expect(rlsStatus()).toBe("on");
      expect(await client.finding.count({ where: { userId: bob.userId } })).toBe(1);
    });

    it("still reads and writes the person's own rows, in and out of a transaction", async () => {
      const asAlice = scopedFor(alice.userId, client);

      expect((await asAlice.findings.findMany()).map((f) => f.id)).toEqual([alice.findingId]);
      const goal = await asAlice.savingsGoals.create({
        data: {
          userId: alice.userId,
          name: "Car",
          targetCents: 1,
          targetDate: new Date("2030-01-01"),
        },
      });
      expect(goal.userId).toBe(alice.userId);
      const titles = await asAlice.transaction(async (tx) => {
        await tx.findings.update({ where: { id: alice.findingId }, data: { title: "renamed" } });
        return (await tx.findings.findMany()).map((f) => f.title);
      });
      expect(titles).toEqual(["renamed"]);
    });
  });

  describe("the bypass", () => {
    it("exists only as the app's own role: jane_rls has no setting that lifts the policies", async () => {
      const seen = await asUserTransaction(client, alice.userId, async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        return tx.finding.count({ where: { userId: bob.userId } });
      });

      expect(seen).toBe(0);
    });

    it("sees nothing as jane_rls when no person's id is set", async () => {
      const seen = await client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('role', 'jane_rls', true)`;
        return [await tx.finding.count(), await tx.budget.count(), await tx.user.count()];
      });

      expect(seen).toEqual([0, 0, 0]);
    });

    it("leaves the app's role, used by cron jobs, admin pages, retention and trial cleanup, with full access", async () => {
      const both = { userId: { in: [alice.userId, bob.userId] } };

      expect(await client.finding.count({ where: both })).toBe(2);
      expect(await client.budget.count({ where: both })).toBe(2);
      expect(
        await client.$queryRaw`SELECT nullif(current_setting('app.user_id', true), '') AS id`,
      ).toEqual([{ id: null }]);
    });

    it("leaves nothing on a pooled connection after a scoped transaction, committed or rolled back", async () => {
      // One connection, so the next query surely gets the one the scoped query used.
      const single = new PrismaClient({ adapter: adapter(1) });
      try {
        const asAlice = scopedFor(alice.userId, single);
        const before = await single.$queryRaw<{ role: string }[]>`SELECT current_user AS role`;
        await asAlice.findings.findMany();
        await expect(
          asAlice.findings.update({ where: { id: bob.findingId }, data: { title: "x" } }),
        ).rejects.toThrow();
        await expect(
          asUserTransaction(single, alice.userId, async () => {
            throw new Error("rolled back");
          }),
        ).rejects.toThrow("rolled back");

        const after = await single.$queryRaw<{ role: string; id: string | null }[]>`
          SELECT current_user AS role, nullif(current_setting('app.user_id', true), '') AS id`;
        expect(after).toEqual([{ role: before[0].role, id: null }]);
        expect(await single.finding.count({ where: { userId: bob.userId } })).toBe(1);
      } finally {
        await single.$disconnect();
      }
    });
  });
});

describe.runIf(url)("the app's pool (src/lib/rls-pg.ts)", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg(rlsPool(url, { max: 1 })) });
    userId = (
      await client.user.create({ data: { email: `rls-pool-${crypto.randomUUID()}@example.com` } })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("sends a scoped read in one round trip, and a write in two, in one transaction", async () => {
    const asUser = scopedFor(userId, client);
    await asUser.budgets.findMany(); // a connection is open
    const sent = vi.spyOn(pg.Client.prototype, "query");

    await asUser.budgets.findMany({ where: { category: "FOOD_AND_DRINK" } });
    expect(sent).toHaveBeenCalledTimes(1);

    const created = await asUser.budgets.create({
      data: { userId, category: "GENERAL", amountCents: 1 },
    });
    // BEGIN, the switch and the insert; then COMMIT.
    expect(sent).toHaveBeenCalledTimes(3);
    expect(created.userId).toBe(userId);
  });

  it("still runs every other transaction as written: isolation, rollback, raw SQL", async () => {
    const level = await client.$transaction(
      (tx) => tx.$queryRaw`SELECT current_setting('transaction_isolation') AS level`,
      { isolationLevel: "Serializable" },
    );
    expect(level).toEqual([{ level: "serializable" }]);

    await expect(
      client.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { name: "Rolled back" } });
        throw new Error("undo");
      }),
    ).rejects.toThrow("undo");
    expect((await client.user.findUniqueOrThrow({ where: { id: userId } })).name).toBeNull();

    const both = await client.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { name: "Kept" } });
      return tx.$queryRaw<{ n: number }[]>`SELECT 1 AS n`;
    });
    expect(both).toEqual([{ n: 1 }]);
    expect((await client.user.findUniqueOrThrow({ where: { id: userId } })).name).toBe("Kept");
    expect(await client.$queryRaw`SELECT current_user = session_user AS same`).toEqual([
      { same: true },
    ]);
  });
});
