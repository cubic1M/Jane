import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { loadNetWorthHistory } from "./net-worth-history";

// CodeRabbit sweep 1b: a person with no accounts but a home they entered lost their net worth
// (the loader returned null).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-27T18:00:00Z");

describe.runIf(url)("net worth with only something owned", () => {
  let client: PrismaClient;
  const users: string[] = [];
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: users } } });
    await client.$disconnect();
  });

  it("keeps the figure from an owned asset; nothing at all is still null", async () => {
    const owner = await client.user.create({
      data: { email: `owned-only-${crypto.randomUUID()}@example.com` },
    });
    const nobody = await client.user.create({
      data: { email: `nothing-${crypto.randomUUID()}@example.com` },
    });
    users.push(owner.id, nobody.id);
    await client.ownedAsset.create({
      data: {
        userId: owner.id,
        kind: "home",
        name: "Home",
        valueCents: 500_000_00,
        valuedOn: new Date("2026-09-01T00:00:00Z"),
      },
    });
    const view = await loadNetWorthHistory(owner.id, { client, now: NOW });
    expect(view?.known).toBe(true);
    expect(view?.todayCents).toBe(500_000_00);
    expect(await loadNetWorthHistory(nobody.id, { client, now: NOW })).toBeNull();
  });
});
