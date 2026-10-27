import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { flatPrices } from "@/lib/paper/__fixtures__/prices";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  SYSTEM_ACTOR: { type: "system", id: null },
}));

import { PrismaClient } from "@/generated/prisma/client";
import { startPaperAccount } from "@/lib/paper/account";
import { startTradingAgent, tickTradingAgent } from "@/lib/trading-agent/agent";
import { sampleFeed } from "@/lib/trading-agent/bar-store";
import { policiesFor } from "@/planning/trading-agent/policies";
import { eventsAgentSource } from "./agent-source";
import { runEventOverlay, setEventsOverlay } from "./run";

// The events overlay with the 24-hour agent, against a real, migrated Postgres, on sample bars:
// the agent reads the overlay's slices as its own signals (registered when the paper account
// loads), buys the event's fund only after the event was public, with the event's reason; the
// overlay then places no trades of its own on that account, so nothing trades twice. Off, crypto
// or a real account: no signals. No live call.

const url = process.env.TEST_DATABASE_URL;
// Tuesday 2028-10-17, 10pm UTC: after the US close.
const NOW = new Date("2028-10-17T22:00:00Z");
const STOCKS = policiesFor("stocks")[0].key;
const CRYPTO = policiesFor("crypto")[0].key;

// Market events are shared by every test file: this one keeps to 2028, and clears only those.
const ownYear = () => ({
  date: { gte: new Date("2028-01-01T00:00:00Z"), lt: new Date("2029-01-01T00:00:00Z") },
});

describe.runIf(url)("the events overlay with the 24-hour agent", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const person = async (bank: "demo" | "real") => {
    const user = await client.user.create({
      data: { email: `events-agent-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    await client.plaidItem.create({
      data: {
        userId: user.id,
        plaidItemId: `${bank === "demo" ? "demo-" : "item-"}${crypto.randomUUID()}`,
        accessTokenEncrypted: "test-token",
        institutionName: bank === "demo" ? "Demo Bank" : "First Real Bank",
      },
    });
    return user.id;
  };
  // A chip boom public at 15:00 UTC on the 20th, mid-session.
  const chipBoom = () =>
    client.marketEvent.create({
      data: {
        key: `gdelt:chip_boom:agent-${crypto.randomUUID()}`,
        type: "chip_boom",
        source: "gdelt",
        date: new Date("2028-10-16T00:00:00Z"),
        knownAt: new Date("2028-10-17T15:00:00Z"),
        title: "A chip boom: news coverage 3.1 times its usual level",
        url: null,
        strength: 3.1,
      },
    });
  const withOverlay = async () => {
    const id = await person("demo");
    await startPaperAccount(id, 1_000_000, {
      client,
      now: new Date("2028-10-16T21:30:00Z"),
      prices: flatPrices,
    });
    await setEventsOverlay(id, true, { client, now: new Date("2028-10-16T22:00:00Z") });
    return id;
  };

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    await client.marketEvent.deleteMany({ where: ownYear() });
  });
  afterAll(async () => {
    await client.marketEvent.deleteMany({ where: ownYear() });
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("gives the agent the overlay's slices for the range, only once public, only for funds", async () => {
    const id = await withOverlay();
    await chipBoom();
    const ctx = { client, from: "2028-10-17T13:30:00.000Z", to: "2028-10-17T20:00:00.000Z" };
    const [s, ...rest] = await eventsAgentSource(id, { ...ctx, market: "stocks" });
    expect(rest).toEqual([]);
    expect(s).toMatchObject({ ticker: "SMH", at: "2028-10-17T15:00:00.000Z", source: "events" });
    // A range that ends before it was public: nothing.
    expect(
      await eventsAgentSource(id, { ...ctx, to: "2028-10-17T14:45:00.000Z", market: "stocks" }),
    ).toEqual([]);
    // The agent on crypto gets the crypto events, not this stock-fund one.
    expect(await eventsAgentSource(id, { ...ctx, market: "crypto" })).toEqual([]);
    // Off: nothing.
    await setEventsOverlay(id, false, { client, now: NOW });
    expect(await eventsAgentSource(id, { ...ctx, market: "stocks" })).toEqual([]);
  });

  it("the agent buys the event's fund after it was public, and the overlay places no trades of its own", async () => {
    const id = await withOverlay();
    await chipBoom();
    await startTradingAgent(
      id,
      { policy: STOCKS, interval: "1h" },
      { client, now: NOW, feed: sampleFeed },
    );
    const smh = await client.paperTrade.findMany({
      where: { userId: id, ticker: "SMH" },
      orderBy: { placedAt: "asc" },
    });
    expect(smh.length).toBeGreaterThan(0);
    expect(smh[0]).toMatchObject({ side: "buy", source: "events" });
    expect(smh[0].placedAt.toISOString() > "2028-10-17T15:00:00.000Z").toBe(true);
    expect(smh[0].reason).toContain("Record chip demand");
    // The overlay's own runner leaves an agent-run account alone.
    const before = await client.paperTrade.count({ where: { userId: id } });
    expect((await runEventOverlay(id, { client, now: NOW, prices: flatPrices })).ran).toBe(false);
    expect(await client.paperTrade.count({ where: { userId: id } })).toBe(before);
  });

  it("a crypto day-trading account takes the crypto event's trade on catch-up, only after it was public", async () => {
    const id = await withOverlay();
    // Started on bitcoin and ether at 15 minutes, a day before the events.
    await startTradingAgent(
      id,
      { policy: CRYPTO, interval: "15m" },
      { client, now: new Date("2028-10-16T22:00:00Z"), feed: sampleFeed },
    );
    // Two crypto events in the night: a liquidation cascade (a bitcoin slice in) and a stablecoin
    // losing its peg (slices of bitcoin and ether out to cash).
    const cryptoEvent = async (type: string, knownAt: string) =>
      client.marketEvent.create({
        data: {
          key: `gdelt:${type}:agent-${crypto.randomUUID()}`,
          type,
          source: "gdelt",
          date: new Date("2028-10-17T00:00:00Z"),
          knownAt: new Date(knownAt),
          title: `${type}: news coverage 4.0 times its usual level in the hour`,
          url: null,
          strength: 4,
        },
      });
    await cryptoEvent("crypto_liquidation", "2028-10-17T01:15:00Z");
    await cryptoEvent("stablecoin_depeg", "2028-10-17T02:15:00Z");
    // This account's own record: its last 20 liquidation slices helped, which lifts the type over
    // the bar (the backtest's record alone leaves it under). Whatever the strategy holds then (cash
    // or crypto), the bitcoin slice in or the trim out has something to trade.
    const won = Array.from({ length: 20 }, (_, i) => ({
      eventKey: `past-${i}`,
      type: "crypto_liquidation",
      ticker: "BTC/USD",
      side: "buy",
      tilt: 0.02,
      enteredOn: "2028-09-01",
      entryCents: 100,
      confidence: 50,
      reason: "",
      exitedOn: "2028-09-29",
      exitCents: 110,
      stopped: false,
      fundReturn: 0.1,
      baseReturn: 0,
      hit: true,
    }));
    await client.paperEventOverlay.update({
      where: { userId: id },
      data: { state: { open: [], watching: [], closed: won, seen: [] } },
    });
    // A stock-fund event: the crypto agent never gets it.
    await chipBoom();
    // The next tick, hours later, catches up the bars since, in order.
    await tickTradingAgent(id, { client, now: new Date("2028-10-17T09:00:00Z"), feed: sampleFeed });
    const trades = await client.paperTrade.findMany({
      where: { userId: id, source: "events" },
      orderBy: { placedAt: "asc" },
    });
    expect(trades.length).toBeGreaterThan(0);
    expect(trades.every((t) => ["BTC/USD", "ETH/USD"].includes(t.ticker))).toBe(true);
    // Each trade at the next bar after its own event became public (the 15-minute bar closing then
    // is the first it may act on, filled at the next bar's open), never earlier, and within the hour.
    const publicAt = (reason: string) =>
      reason.startsWith("crypto_liquidation")
        ? "2028-10-17T01:15:00.000Z"
        : "2028-10-17T02:15:00.000Z";
    for (const t of trades.filter((t) => !t.reason.startsWith("Stopped"))) {
      const at = publicAt(t.reason);
      expect(t.placedAt.toISOString() >= at, t.reason).toBe(true);
    }
    const first = trades.find((t) => t.reason.startsWith("crypto_liquidation")) ?? trades[0];
    expect(
      Date.parse(first.placedAt.toISOString()) - Date.parse(publicAt(first.reason)),
    ).toBeLessThan(3_600_000);
  });

  it("gives a real account nothing", async () => {
    const id = await person("real");
    await chipBoom();
    expect(
      await eventsAgentSource(id, {
        client,
        from: "2028-10-17T13:30:00.000Z",
        to: "2028-10-17T20:00:00.000Z",
        market: "stocks",
      }),
    ).toEqual([]);
  });
});
