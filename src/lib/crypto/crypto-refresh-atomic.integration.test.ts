import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

// The source can be told to hand back a second coin the database refuses.
const broken = vi.hoisted(() => ({ on: false }));
vi.mock("./source", async (importOriginal) => {
  const real = await importOriginal<typeof import("./source")>();
  return {
    ...real,
    demoCryptoSource: (anchor: string) => {
      const source = real.demoCryptoSource(anchor);
      return {
        ...source,
        async balances(...args: Parameters<typeof source.balances>) {
          const balances = await source.balances(...args);
          if (!broken.on) return balances;
          return [
            { ...balances[0], quantity: balances[0].quantity + 1 },
            { ...balances[0], asset: "BAD", name: null as unknown as string },
          ];
        },
      };
    },
  };
});

import { linkDemoBank } from "@/lib/plaid/demo";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { linkDemoCrypto, syncCrypto } from "./crypto";

// A refresh replaces a connection's coins together: when the second write fails, the first is not
// left in place beside old balances for the other coins (CodeRabbit sweep, part 4).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-04T15:00:00Z");

describe.runIf(url)("refreshing crypto balances", () => {
  let client: PrismaClient;
  const people: string[] = [];

  beforeAll(() => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: people } } });
    await client.$disconnect();
  });

  it("keeps the previous complete snapshot when it fails partway", async () => {
    const { id } = await client.user.create({
      data: { email: `crypto-atomic-${crypto.randomUUID()}@example.com` },
    });
    people.push(id);
    await linkDemoBank(id, { client, now: NOW });
    await linkDemoCrypto(id, "exchange", { client, now: NOW });
    const before = await client.cryptoHolding.findMany({
      where: { userId: id },
      orderBy: { asset: "asc" },
      select: { asset: true, quantity: true, asOf: true },
    });
    expect(before.length).toBeGreaterThan(0);

    broken.on = true;
    try {
      await expect(
        syncCrypto(id, { client, now: new Date(NOW.getTime() + 3_600_000) }),
      ).rejects.toThrow();
    } finally {
      broken.on = false;
    }
    const after = await client.cryptoHolding.findMany({
      where: { userId: id },
      orderBy: { asset: "asc" },
      select: { asset: true, quantity: true, asOf: true },
    });
    expect(after).toEqual(before);
  });
});
