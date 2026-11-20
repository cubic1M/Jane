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
import {
  areaCounts,
  hiddenPageLinks,
  noneFromShortHistory,
  nowFromOldData,
  onePlurals,
  owedTotals,
  rawNames,
  saidTwice,
  twoCardsOneHolding,
  decidedOnEstimate,
  listDoubles,
  walkedUnlabelled,
  sameFigures,
} from "./invariants";
import { CASH_FLOW_MIN_HISTORY_DAYS } from "@/config/areas";
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

  // Class 9: 1886, 1894, 1907, 1909, 1931, 1986, 2060, 2079.
  it("never links to a page the beta hides", () => {
    expect(everyone(hiddenPageLinks)).toEqual([]);
  });

  // Class 6: 1944, 2001, 2007, 2064, 2107.
  it("says nothing is due only with history enough to know", () => {
    expect(
      [...seen].flatMap(([who, flat]) => {
        const days = flat["home.summary.cashFlow.historyDays"];
        const short = typeof days === "number" && days < CASH_FLOW_MIN_HISTORY_DAYS;
        return noneFromShortHistory(flat, short).map((found) => `${who} ${found}`);
      }),
    ).toEqual([]);
  });

  // Class 2: 2019, 2064, 2084, 2093, 2097.
  it("counts one thing in the singular", () => {
    expect(everyone(onePlurals)).toEqual([]);
  });

  // Class 8: 1942, 1965, 2018, 2050, 2070, 2096, 2043.
  it("adds up as owed only what's owed", () => {
    expect(everyone(owedTotals)).toEqual([]);
  });

  // Class 4: 1900, 1904, 1938, 2011, 2014, 2016, 2027, 2063, 2097, 2114.
  it("reads the same figure the same everywhere it's shown", () => {
    expect(everyone(sameFigures)).toEqual([]);
  });

  // Class 7: 1882, 1886, 1897, 1906, 1911, 1917, 1920, 1928, 1947, 1948, 1982, 2060, 2086, 2088.
  it("says each figure once in a sentence", () => {
    expect(everyone(saidTwice)).toEqual([]);
  });

  // And inside a list: one column of an area page counts each charge once (#2147, #2160).
  it("counts each charge, merchant and holding once in a column", () => {
    expect(everyone(listDoubles)).toEqual([]);
  });

  // And one holding, one card (the fee card and the 401(k) menu card, 11-19; #2090, #2094).
  it("raises one card for one holding", () => {
    expect(everyone(twoCardsOneHolding)).toEqual([]);
  });

  // And a balance walked forward from a statement says it's an estimate (#2142; the cash page and
  // the chat's cash answer, 11-19).
  it("says estimated wherever it shows a balance walked forward from a statement", () => {
    expect(everyone(walkedUnlabelled)).toEqual([]);
  });

  // And decides nothing from an estimate (the pay-later payoff, 11-19).
  it("decides from checking as the bank or statement shows it", () => {
    expect(everyone(decidedOnEstimate)).toEqual([]);
  });
});
