import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The area loaders read the default client: the test database here.
vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { PrismaClient } from "@/generated/prisma/client";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { EVERYONE, makePerson, type OwnRows, type Who } from "./__fixtures__/people";
import { atLocal, type Flat } from "./diff";
import { sameTwice } from "./same-twice";
import { snapshotAt } from "./snapshot";

// The same data reads the same (manager, 11-20): each sweep person (./__fixtures__/people.ts) is
// made twice from the same seed and statements, linked at the same moment, and both copies are read
// at the same afternoon (./snapshot.ts). The first is deleted before the second is made: the demo
// bank's account ids come from the seed, so two copies can't be in the database at once. Everything but their ids must match, in the same order: a
// list that follows the table's order (the fee card's funds, #2165) differs here. Runs against a
// real, migrated Postgres.

const url = process.env.TEST_DATABASE_URL;
const ZONE = "America/Los_Angeles";
const DAY = "2026-11-12";

describe.runIf(url)("one person made twice from the same data", () => {
  let client: PrismaClient;
  const seen = new Map<Who, [Flat, Flat]>();

  const own = (): OwnRows => ({
    person: (data) => client.user.create({ data }),
    token: (id, accessTokenEncrypted) =>
      client.plaidItem.update({ where: { id }, data: { accessTokenEncrypted } }),
  });

  beforeAll(async () => {
    stubTestKeys();
    vi.stubEnv("SYNC_SNAPSHOTS", "off");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    vi.useFakeTimers({ toFake: ["Date"] });
    for (const who of EVERYONE) {
      const copies: Flat[] = [];
      for (const copy of [1, 2]) {
        const linked = atLocal(DAY, 8, ZONE);
        vi.setSystemTime(linked);
        const { userId } = await makePerson(client, own(), who, {
          linked,
          seed: `same-twice-${who}`,
          email: `same-twice-${who}-${copy}@example.test`,
          timezone: ZONE,
        });
        const afternoon = atLocal(DAY, 15, ZONE);
        vi.setSystemTime(afternoon);
        copies.push(await snapshotAt(userId, { client, now: afternoon }));
        await client.user.delete({ where: { id: userId } });
      }
      seen.set(who, [copies[0]!, copies[1]!]);
    }
  }, 1_800_000);

  afterAll(async () => {
    vi.useRealTimers();
    // A copy left by a failure on the way, as well.
    await client.user.deleteMany({ where: { email: { startsWith: "same-twice-" } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("reads every person twice", () => {
    expect([...seen.keys()]).toEqual(EVERYONE);
  });

  it("shows each the same thing in the same order", () => {
    expect(
      [...seen].flatMap(([who, [first, second]]) =>
        sameTwice(first, second).map((line) => `${who} ${line}`),
      ),
    ).toEqual([]);
  });
});
