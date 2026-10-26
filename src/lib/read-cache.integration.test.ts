import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
import { scopedFor } from "@/lib/db-scoped";
import { loadHousehold } from "@/lib/insurance/household";
import { demoAnchorFor, demoPersonFor, hasDemoBank } from "@/lib/plaid/demo";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { loadTaxForms, loadTaxTags } from "@/lib/tax-organizer";
import { cachedCopy, cachedRead, inReadCache, withReadCache } from "./read-cache";

// The read cache for one sync (src/lib/read-cache.ts), against a real, migrated Postgres: a
// read is made once until anything is written through the scope's client, by any route (a model
// call, the user-scoped helper, an interactive transaction or a raw query), so it can never hand
// back something stale.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("the read cache", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    userId = (
      await client.user.create({ data: { email: `read-cache-${crypto.randomUUID()}@example.com` } })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("reads once inside a scope, and every time outside one", async () => {
    const read = vi.fn(async () => 1);
    await withReadCache(client, async (c) => {
      expect(inReadCache()).toBe(true);
      await cachedRead("k", c, read);
      await cachedRead("k", c, read);
      await cachedRead("other", c, read);
    });
    expect(read).toHaveBeenCalledTimes(2);
    await cachedRead("k", client, read);
    await cachedRead("k", client, read);
    expect(read).toHaveBeenCalledTimes(4);
    expect(inReadCache()).toBe(false);
  });

  it("reads afresh with a client that isn't the scope's", async () => {
    const read = vi.fn(async () => 1);
    await withReadCache(client, async () => {
      await cachedRead("k", client, read);
      await cachedRead("k", client, read);
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("forgets everything on any write, by every route", async () => {
    const writes: [string, (c: PrismaClient) => Promise<unknown>][] = [
      ["a model write", (c) => c.user.update({ where: { id: userId }, data: { name: "A" } })],
      [
        "the user-scoped helper",
        (c) =>
          scopedFor(userId, c).savingsGoals.create({
            data: {
              userId,
              name: "Trip",
              targetCents: 100_000,
              targetDate: new Date("2027-06-01"),
            },
          }),
      ],
      [
        "an interactive transaction",
        (c) =>
          c.$transaction(async (tx) =>
            tx.user.update({ where: { id: userId }, data: { name: "B" } }),
          ),
      ],
      ["a raw query", (c) => c.$executeRaw`UPDATE users SET name = 'C' WHERE id = ${userId}`],
    ];
    for (const [name, write] of writes) {
      const read = vi.fn(async () => 1);
      await withReadCache(client, async (c) => {
        await cachedRead("k", c, read);
        await write(c);
        await cachedRead("k", c, read);
      });
      expect(read, name).toHaveBeenCalledTimes(2);
    }
  });

  it("keeps reads across reads, and hands each caller its own copy", async () => {
    await withReadCache(client, async (c) => {
      const read = vi.fn(async () => ({ list: [1, 2] }));
      const a = await cachedCopy("k", c, read);
      await c.user.findMany({ where: { id: userId } });
      const b = await cachedCopy("k", c, read);
      expect(read).toHaveBeenCalledTimes(1);
      a.list.push(3);
      expect(b.list).toEqual([1, 2]);
    });
  });

  it("reads each slow loader once in a scope, each caller getting its own copy", async () => {
    let queries = 0;
    const counted = client.$extends({
      query: {
        $allOperations({ args, query }) {
          queries += 1;
          return query(args);
        },
      },
    }) as unknown as PrismaClient;
    const now = new Date("2026-10-20T15:00:00Z");
    const all = (c: PrismaClient) =>
      Promise.all([
        loadTaxEstimate(userId, { client: c, now }),
        loadTaxForms(userId, 2026, { client: c, now }),
        loadTaxTags(userId, 2026, { client: c }),
        loadHousehold(userId, { client: c, now }),
        hasDemoBank(userId, { client: c }),
        demoAnchorFor(userId, { client: c }),
        demoPersonFor(userId, { client: c }),
      ]);
    const once = await withReadCache(counted, all);
    const single = queries;
    queries = 0;
    const [first, second] = await withReadCache(counted, (c) => Promise.all([all(c), all(c)]));
    expect(queries).toBe(single);
    expect(second).toEqual(first);
    expect(first).toEqual(once);
    expect(second[0]).not.toBe(first[0]);
    expect(second[3]).not.toBe(first[3]);
  });

  it("doesn't keep a failed read, and shares one scope when nested", async () => {
    let calls = 0;
    const read = async () => {
      calls += 1;
      if (calls === 1) throw new Error("down");
      return 2;
    };
    await withReadCache(client, async (c) => {
      await expect(cachedRead("k", c, read)).rejects.toThrow("down");
      expect(await cachedRead("k", c, read)).toBe(2);
      await withReadCache(c, async (inner) => {
        expect(inner).toBe(c);
        expect(await cachedRead("k", inner, read)).toBe(2);
      });
    });
    expect(calls).toBe(2);
  });
});
