import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The SnapTrade tap on the investing card, reached by a sample person (C8, 11-19). The demo people
// send nothing to a brokerage, so none of them sees the card; the connector fixtures' investor does.
// Against a real, migrated Postgres and the real registry: the card has money to show, the tap offers
// SnapTrade's sandbox twin (never the real one, which is for nobody yet), and it goes once connected
// or turned down.

vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});

import { renderToStaticMarkup } from "react-dom/server";
import { KILL_SWITCH_VARS } from "@/config/kill-switches";
import { ConnectTap } from "@/components/connect-tap";
import { canImportHoldings } from "@/lib/csv-access";
import { db } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { brokerageAsks } from "@/lib/investing/brokerage-balance";
import { stubTestKeys } from "@/lib/__fixtures__/env";
import { removePeople, sampleInvestor, samplePerson } from "../__fixtures__/people";
import { declineConnect } from "../connect";
import { grantConsent } from "../consent";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-19T15:00:00Z");
// The investing card's own tap (src/app/investments/page.tsx).
const tap = async (userId: string) => {
  const element = await ConnectTap({
    userId,
    connectorIds: ["snaptrade_holdings", "sandbox_snaptrade_holdings"],
    from: "/investments",
    label: "Or bring in the account itself, read only",
  });
  return element ? renderToStaticMarkup(element) : null;
};

describe.runIf(url)("the SnapTrade tap on the investing card", () => {
  const people: string[] = [];

  beforeAll(() => stubTestKeys());
  afterAll(async () => {
    await removePeople(db, people);
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    for (const name of KILL_SWITCH_VARS) vi.stubEnv(name, "");
    vi.stubEnv("CONNECTORS", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("reaches the fixtures' investor: the card has money to show and offers SnapTrade's twin", async () => {
    const investor = await sampleInvestor(db, NOW);
    people.push(investor);
    expect(canImportHoldings({ id: investor })).toBe(true);
    const asks = await brokerageAsks(scopedFor(investor, db), NOW);
    expect(asks.inLast3MonthsCents).toBe(50_000);
    expect(asks.asks.map((a) => a.app)).toEqual(["Robinhood"]);
    const html = await tap(investor);
    expect(html).toContain(
      'href="/settings/connections/sandbox_snaptrade_holdings?from=%2Finvestments"',
    );
    expect(html).not.toContain("/settings/connections/snaptrade_holdings?");
  });

  it("doesn't reach a demo person who sent nothing to a brokerage: no card to hold it", async () => {
    const plain = await samplePerson(db);
    people.push(plain);
    expect((await brokerageAsks(scopedFor(plain, db), NOW)).inLast3MonthsCents).toBe(0);
  });

  it("goes once the person connects, and never comes back after Not now", async () => {
    const connected = await sampleInvestor(db, NOW);
    const declined = await sampleInvestor(db, NOW);
    people.push(connected, declined);
    await grantConsent(connected, "sandbox_snaptrade_holdings", ["read_holdings"], {
      client: db,
      now: NOW,
    });
    expect(await tap(connected)).toBeNull();
    await declineConnect(declined, "sandbox_snaptrade_holdings", { client: db });
    expect(await tap(declined)).toBeNull();
  });

  it("offers nothing while connectors are off", async () => {
    const investor = await sampleInvestor(db, NOW);
    people.push(investor);
    vi.stubEnv("CONNECTORS", "");
    expect(await tap(investor)).toBeNull();
  });
});
