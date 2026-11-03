import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { ensureAppLogin } from "@/test-setup/no-bypass-role";

// This file is about the login role itself, so it gets the real client (no-bypass-client.ts routes
// a test's own calls to the owner).
vi.unmock("@/generated/prisma/client");
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { scopedFor } from "./db-scoped";
import { rlsPool } from "./rls-pg";
import { systemDb, systemTransaction } from "./system-db";

// Deny by default (docs/security/rls.md), against a real Postgres, on the login production moves
// to: it can use no table. A query that goes through neither door fails; scopedFor still sees one
// person; systemDb sees everyone; nothing stays on a pooled connection. Through a plain pg
// connection and through the app's own pool, which sends the switch and the query in one flight.
const ownerUrl = process.env.TEST_OWNER_DATABASE_URL ?? process.env.TEST_DATABASE_URL;

const denied = /permission denied|42501/;

describe.runIf(ownerUrl).each([
  ["a plain pg connection", (url: string) => new PrismaPg({ connectionString: url, max: 1 })],
  ["the app's pool", (url: string) => new PrismaPg(rlsPool(url, { max: 1 }))],
])("deny by default, through %s", (_, adapter) => {
  let owner: PrismaClient;
  let app: PrismaClient;
  const suffix = crypto.randomUUID();
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    const appUrl = await ensureAppLogin(ownerUrl!);
    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: ownerUrl! }) });
    app = new PrismaClient({ adapter: adapter(appUrl) });
    for (const name of ["alice", "bob"]) {
      const user = await owner.user.create({
        data: { email: `deny-${name}-${suffix}@example.com` },
      });
      await owner.budget.create({
        data: { userId: user.id, category: "FOOD_AND_DRINK", amountCents: 40_000 },
      });
      if (name === "alice") alice = user.id;
      else bob = user.id;
    }
  });

  afterAll(async () => {
    await owner.user.deleteMany({ where: { id: { in: [alice, bob] } } });
    await owner.$disconnect();
    await app.$disconnect();
  });

  describe("the login role, going through neither door", () => {
    it("can't read or write a person's table, a system table or the system's records", async () => {
      await expect(app.budget.findMany()).rejects.toThrow(denied);
      await expect(app.user.findMany()).rejects.toThrow(denied);
      await expect(app.job.findMany()).rejects.toThrow(denied);
      await expect(app.auditLog.findMany()).rejects.toThrow(denied);
      await expect(
        app.budget.create({ data: { userId: alice, category: "RENT", amountCents: 1 } }),
      ).rejects.toThrow(denied);
    });

    it("can't reach anything through raw SQL either", async () => {
      await expect(app.$queryRaw`SELECT * FROM budgets LIMIT 1`).rejects.toThrow(denied);
      await expect(app.$executeRaw`DELETE FROM audit_log`).rejects.toThrow(denied);
    });

    it("has no bypass and is not a superuser", async () => {
      const [me] = await app.$queryRaw<
        { current_user: string; rolsuper: boolean; rolbypassrls: boolean; rolinherit: boolean }[]
      >`SELECT current_user, rolsuper, rolbypassrls, rolinherit FROM pg_roles WHERE rolname = current_user`;
      expect(me).toEqual({
        current_user: "jane_app",
        rolsuper: false,
        rolbypassrls: false,
        rolinherit: false,
      });
    });

    it("can't change the schema", async () => {
      await expect(app.$executeRaw`CREATE TABLE deny_probe (id int)`).rejects.toThrow(denied);
    });
  });

  describe("scopedFor", () => {
    it("reads and writes one person's rows, and only theirs", async () => {
      const scoped = scopedFor(alice, app);
      const mine = await scoped.budgets.findMany();
      expect(mine.map((b) => b.userId)).toEqual([alice]);

      const updated = await scoped.budgets.updateMany({ data: { amountCents: 41_000 } });
      expect(updated.count).toBe(1);
      const bobs = await owner.budget.findFirstOrThrow({ where: { userId: bob } });
      expect(bobs.amountCents).toBe(40_000);
    });
  });

  describe("systemDb", () => {
    it("sees everyone, as jane_system", async () => {
      const everyone = await systemDb("test: both people", app).budget.findMany({
        where: { userId: { in: [alice, bob] } },
      });
      expect(everyone.map((b) => b.userId).sort()).toEqual([alice, bob].sort());

      const [who] = await systemDb("test: who am I", app).$queryRaw<{ role: string }[]>`
        SELECT current_user AS role`;
      expect(who.role).toBe("jane_system");
    });

    it("writes, reads a system table, and a nested write stays one transaction", async () => {
      const system = systemDb("test: writes", app);
      const job = await system.job.create({ data: { kind: "deny-probe", payload: {} } });
      expect(await system.job.count({ where: { id: job.id } })).toBe(1);
      await system.job.delete({ where: { id: job.id } });

      await expect(
        system.user.create({
          data: {
            email: `deny-nested-${suffix}@example.com`,
            // The nested row breaks a constraint: the person must not be left behind.
            budgets: {
              create: [
                { category: "RENT", amountCents: 1 },
                { category: "RENT", amountCents: 2 },
              ],
            },
          },
        }),
      ).rejects.toThrow();
      expect(
        await system.user.count({ where: { email: `deny-nested-${suffix}@example.com` } }),
      ).toBe(0);
    });

    it("runs several statements as one transaction, and rolls them all back", async () => {
      await expect(
        systemTransaction(
          "test: rollback",
          async (tx) => {
            await tx.budget.updateMany({ where: { userId: bob }, data: { amountCents: 1 } });
            const [who] = await tx.$queryRaw<{ role: string }[]>`SELECT current_user AS role`;
            expect(who.role).toBe("jane_system");
            throw new Error("undo it");
          },
          app,
        ),
      ).rejects.toThrow("undo it");
      const bobs = await owner.budget.findFirstOrThrow({ where: { userId: bob } });
      expect(bobs.amountCents).toBe(40_000);
    });

    it("leaves nothing on the pooled connection (max 1), after success or failure", async () => {
      const after = async () => {
        await expect(app.budget.findMany()).rejects.toThrow(denied);
        const [{ role }] = await app.$queryRaw<{ role: string }[]>`SELECT current_user AS role`;
        expect(role).toBe("jane_app");
      };
      await systemDb("test: pool", app).budget.count();
      await after();
      await systemDb("test: pool", app).job.findMany({ take: 1 });
      await after();
      await expect(
        systemTransaction(
          "test: pool",
          async () => {
            throw new Error("undo it");
          },
          app,
        ),
      ).rejects.toThrow("undo it");
      await after();
      await systemTransaction("test: pool", (tx) => tx.budget.count(), app);
      await after();
    });
  });

  describe("a person's own row", () => {
    it("reads through scopedFor, and only theirs, and can't be written there", async () => {
      const scoped = scopedFor(alice, app);
      const me = await scoped.me.findUniqueOrThrow({ where: { id: alice }, select: { id: true } });
      expect(me.id).toBe(alice);
      expect(await scoped.me.findUnique({ where: { id: bob } })).toBeNull();
      expect(Object.keys(scoped.me).sort()).toEqual([
        "findFirst",
        "findUnique",
        "findUniqueOrThrow",
      ]);
    });
  });

  it("switching to a person can't be widened into the system's door by a query's own filter", async () => {
    const scoped = scopedFor(alice, app);
    const asked = await scoped.budgets.findMany({ where: { userId: bob } });
    expect(asked).toEqual([]);
  });
});
