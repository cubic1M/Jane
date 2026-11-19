import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "@/lib/db-scoped";
import { rlsPool } from "./rls-pg";

// Production's pg warning, "Calling client.query() when the client is already executing a query"
// (debug 3, 11-19, mvp-ready.md gates G, H): a scoped read with relations (loadAction's action,
// its decision, its user and its messages) is one transaction on one connection, and Prisma loads
// the relations side by side. Through the app's own pool (rlsPool) each statement must reach pg
// only once the one before it on that connection is done: pg 8 warns when one waits in its queue
// and pg 9 refuses it.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("a scoped read with relations, through the app's pool", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    app = new PrismaClient({ adapter: new PrismaPg(rlsPool(url!, { max: 1 })) });
    const user = await owner.user.create({
      data: { email: `rls-one-at-a-time-${crypto.randomUUID()}@example.test` },
    });
    userId = user.id;
    await owner.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository" },
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await owner.user.deleteMany({ where: { id: userId } });
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  it("sends each statement once the one before it on the connection is done", async () => {
    // What pg holds when a statement arrives: one running, and any waiting behind it.
    const waiting: number[] = [];
    const query = pg.Client.prototype.query;
    vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (
      this: pg.Client & { _queryQueue: unknown[]; _activeQuery: unknown },
      ...args: unknown[]
    ) {
      waiting.push(this._queryQueue.length + (this._activeQuery ? 1 : 0));
      return (query as (...a: unknown[]) => unknown).apply(this, args);
    } as never);

    const accounts = await scopedFor(userId, app).accounts.findMany({
      include: { transactions: true, holdings: true, balanceSnapshots: true },
    });

    expect(accounts).toHaveLength(1);
    // The account, then its three relations: four statements, none sent over another.
    expect(waiting.length).toBeGreaterThanOrEqual(4);
    expect(waiting.filter((n) => n > 0)).toEqual([]);
  });
});
