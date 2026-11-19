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
import { staleStatementsEnd } from "@/lib/report-state";
import { areaCounts, nowFromOldData, rawNames } from "./invariants";
import { snapshotAt } from "./snapshot";

// The walkers' bug classes as checks on every push (debug 3, 11-19; the classes, and the PRs
// behind each, are in the manager's notes, debug3-invariants.md). Each sweep person
// (./__fixtures__/people.ts: the demo person, every sample person, and people with thin or
// messy uploads) is made once and read once, as everything they'd see (./snapshot.ts), and each
// class's rule (./invariants.ts) runs over all of them. A failure names the person, the path and
// the text. Runs against a real, migrated Postgres.

const url = process.env.TEST_DATABASE_URL;
const ZONE = "America/Los_Angeles";
// After the messy person's exports end (October 2026), so every person reads as of one day.
const DAY = "2026-11-12";

describe.runIf(url)("what every sweep person sees keeps the walkers' rules", () => {
  let client: PrismaClient;
  const made: string[] = [];
  const seen = new Map<Who, Flat>();
  // Where each person's statements end, when that's too long ago to say what's held now.
  const ended = new Map<Who, string | null>();

  // The test's own rows, written here so they go through the database's owner
  // (./__fixtures__/people.ts).
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
      const linked = atLocal(DAY, 8, ZONE);
      vi.setSystemTime(linked);
      const { userId } = await makePerson(client, own(), who, {
        linked,
        seed: `invariants-${who}`,
        email: `invariants-${who}-${made.length}@example.test`,
        timezone: ZONE,
      });
      made.push(userId);
      const afternoon = atLocal(DAY, 15, ZONE);
      vi.setSystemTime(afternoon);
      seen.set(who, await snapshotAt(userId, { client, now: afternoon }));
      const newest = await client.transaction.findFirst({
        where: { userId },
        orderBy: { date: "desc" },
        select: { date: true },
      });
      ended.set(who, staleStatementsEnd(newest?.date ?? null, DAY));
    }
  }, 900_000);

  afterAll(async () => {
    vi.useRealTimers();
    await client.user.deleteMany({ where: { id: { in: made } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const everyone = (rule: (flat: Flat) => string[]) =>
    [...seen].flatMap(([who, flat]) => rule(flat).map((found) => `${who} ${found}`));

  it("reads every person", () => {
    expect([...seen.keys()]).toEqual(EVERYONE);
  });

  // Class 1: 1955, 1962, 1970, 2025, 2034, 2083, 2084, 2091.
  it("names what it shows by the cleaned name, never the bank's raw line", () => {
    expect(everyone(rawNames)).toEqual([]);
  });

  // Class 3: 1889, 1907, 2079, 2101, 2113.
  it("adds up each area's counts, and says on its tile what its page says", () => {
    // The area loaders swallow a failure (src/lib/hub/area-trees.ts): with no tree there'd be
    // nothing to count, so every person's six areas must have read.
    const areas = ["insurance", "loans", "taxes", "ahead", "investments", "money"];
    expect(
      [...seen].flatMap(([who, flat]) =>
        areas
          .filter((a) => typeof flat[`trees.${a}.tree.sub`] !== "string")
          .map((a) => `${who} ${a}`),
      ),
    ).toEqual([]);
    expect(everyone(areaCounts)).toEqual([]);
  });

  // Class 5: 1876, 1938, 1975, 1997, 2002, 2004, 2028, 2047, 2095.
  it("says nothing about now from statements that ended long ago, without saying when", () => {
    expect(
      [...seen].flatMap(([who, flat]) =>
        nowFromOldData(flat, ended.get(who) ?? null).map((found) => `${who} ${found}`),
      ),
    ).toEqual([]);
  });
});
