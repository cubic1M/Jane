import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  SYSTEM_ACTOR: { type: "system", id: null },
}));

import { AGENT_INTERVALS, AGENT_LOOKBACK_BARS, AGENT_MARKETS } from "@/config/trading-agent";
import { PrismaClient } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import type { Bar } from "@/lib/market/types";
import { revertTrade, runPaperDay, startPaperAccount } from "@/lib/paper/account";
import type { PaperPrices } from "@/lib/paper/prices";
import { runAgent, startState } from "@/planning/trading-agent/engine";
import { policyByKey } from "@/planning/trading-agent/policies";
import type { AgentSignal } from "@/planning/trading-agent/types";
import {
  AgentError,
  loadAgentView,
  registerAgentSignals,
  startTradingAgent,
  stopTradingAgent,
  tickTradingAgent,
} from "./agent";
import { liveFeed, sampleFeed } from "./bar-store";
import { sampleAgentBars } from "./sample-bars";

// The 24-hour agent on a real, migrated Postgres, on the sample bars (deterministic by time):
// started on a paper account it replays the last day at once; ticks at any times land on exactly
// the trades of one unbroken run; two ticks at once write once; every trade has its time, price,
// reason and fees; the events layer's signals are read; real accounts get nothing. No live call.

const url = process.env.TEST_DATABASE_URL;
const T0 = new Date("2026-10-20T12:00:00Z");
const hours = (h: number) => new Date(T0.getTime() + h * 3_600_000);
const POLICY = "catalog:vol_target@BTC/USD";

const dailyPrices: PaperPrices = {
  name: "sample",
  real: false,
  closes: async (ticker: string, from: string, to: string) => {
    const out: Bar[] = [];
    const base = 5_000 + [...ticker].reduce((a, c) => a + c.charCodeAt(0), 0) * 20;
    for (
      let d = Date.parse(`${from}T00:00:00Z`);
      d <= Date.parse(`${to}T00:00:00Z`);
      d += 86_400_000
    ) {
      const day = new Date(d).getUTCDay();
      if (day !== 0 && day !== 6)
        out.push({ date: new Date(d).toISOString().slice(0, 10), closeCents: base });
    }
    return out;
  },
};

describe.runIf(url)("the 24-hour agent", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const person = async (bank: "demo" | "real") => {
    const user = await client.user.create({
      data: { email: `agent-${crypto.randomUUID()}@example.com` },
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
  const withAccount = async () => {
    const userId = await person("demo");
    await startPaperAccount(userId, 1_000_000, { client, now: T0, prices: dailyPrices });
    return userId;
  };
  const agentTrades = (userId: string) =>
    client.paperTrade.findMany({
      where: { userId, source: { notIn: ["start", "agent_start"] } },
      orderBy: [{ placedAt: "asc" }, { ticker: "asc" }],
    });

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("starts from cash, replays the last day at once, and every trade has its price, fees and reason", async () => {
    const userId = await withAccount();
    await startTradingAgent(
      userId,
      { policy: POLICY, interval: "15m" },
      { client, now: T0, feed: sampleFeed },
    );
    const account = await client.paperAccount.findUniqueOrThrow({ where: { userId } });
    expect(account).toMatchObject({
      agentPolicy: POLICY,
      agentInterval: "15m",
      agentMarket: "crypto",
    });
    // What it held went to cash first.
    const switched = await client.paperTrade.findMany({ where: { userId, source: "agent_start" } });
    expect(switched.length).toBeGreaterThan(0);
    const trades = await agentTrades(userId);
    expect(trades.length).toBeGreaterThan(0);
    for (const t of trades) {
      expect(t.placedAt.getTime()).toBeGreaterThan(hours(-24).getTime());
      expect(t.placedAt.getTime()).toBeLessThanOrEqual(T0.getTime());
      expect(t.priceCents).toBeGreaterThan(0);
      expect(t.feeCents).toBeGreaterThan(0);
      expect(t.spreadCents).toBeGreaterThan(0);
      expect(t.reason.length).toBeGreaterThan(10);
      expect(t.source).toBe("agent");
    }
    // Its last bar is the last one closed before the start.
    expect(account.agentLastBarAt!.getTime()).toBeLessThan(T0.getTime());
    const view = await loadAgentView(userId, { client });
    expect(view).toMatchObject({
      policy: POLICY,
      interval: "15m",
      market: "crypto",
      prices: "sample",
    });
    expect(view!.trades).toHaveLength(trades.length);
    expect(await client.paperValue.count({ where: { userId } })).toBeGreaterThan(0);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "paper_agent_started",
      expect.anything(),
      expect.objectContaining({ policy: POLICY, simulated: "true" }),
    );
  });

  it("catches up in any number of ticks onto exactly one unbroken run", async () => {
    const a = await withAccount();
    const b = await withAccount();
    for (const id of [a, b])
      await startTradingAgent(
        id,
        { policy: POLICY, interval: "15m" },
        { client, now: T0, feed: sampleFeed },
      );
    // A: a tick now and then, one of them twice. B: one catch-up a day and a half later.
    for (const h of [0.3, 5, 5, 13.2, 29, 36])
      await tickTradingAgent(a, { client, now: hours(h), feed: sampleFeed });
    await tickTradingAgent(b, { client, now: hours(36), feed: sampleFeed });
    const shape = (rows: Awaited<ReturnType<typeof agentTrades>>) =>
      rows.map((t) => [
        t.placedAt.toISOString(),
        t.ticker,
        t.side,
        t.priceCents,
        t.amountCents,
        t.feeCents,
      ]);
    const ta = await agentTrades(a);
    const tb = await agentTrades(b);
    expect(shape(ta)).toEqual(shape(tb));
    const [sa, sb] = await Promise.all(
      [a, b].map((id) => client.paperAccount.findUniqueOrThrow({ where: { userId: id } })),
    );
    expect(sa.agentState).toEqual(sb.agentState);
    expect(sa.cashCents).toBe(sb.cashCents);
    // And both are the pure loop run straight through the same bars.
    const policy = policyByKey(POLICY)!;
    const step = AGENT_INTERVALS["15m"].minutes * 60_000;
    const start = (sa.agentState as { state: { startValue: number } }).state.startValue;
    const warm = hours(-24).toISOString();
    const to = new Date(hours(36).getTime() - step - 60_000).toISOString();
    const from = new Date(Date.parse(warm) - AGENT_LOOKBACK_BARS * step).toISOString();
    const bars = {
      "BTC/USD": sampleAgentBars("BTC/USD", from, to, "15m"),
    };
    const once = runAgent({ ...startState(start), lastBarAt: warm, lastBarN: 0 }, bars, [], {
      policy,
      param: sa.agentParam!,
      costs: AGENT_MARKETS.crypto,
      cash: "USD",
      master: "BTC/USD",
      session: "24h",
      minutes: 15,
    });
    expect(once.trades.map((t) => [t.at, t.ticker, t.side, Math.round(t.priceCents)])).toEqual(
      ta.map((t) => [t.placedAt.toISOString(), t.ticker, t.side, t.priceCents]),
    );
  });

  it("writes once when two ticks run at the same time", async () => {
    const userId = await withAccount();
    await startTradingAgent(
      userId,
      { policy: POLICY, interval: "15m" },
      { client, now: T0, feed: sampleFeed },
    );
    const before = (await agentTrades(userId)).length;
    const reports = await Promise.all([
      tickTradingAgent(userId, { client, now: hours(20), feed: sampleFeed }),
      tickTradingAgent(userId, { client, now: hours(20), feed: sampleFeed }),
    ]);
    expect(reports.filter((r) => r.ran)).toHaveLength(1);
    const after = await agentTrades(userId);
    const keys = after.map((t) => `${t.placedAt.toISOString()}:${t.ticker}:${t.side}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(after.length).toBeGreaterThanOrEqual(before);
  });

  it("reads the events layer's signals", async () => {
    const userId = await withAccount();
    const signal: AgentSignal = {
      id: "test-ether",
      at: hours(-6).toISOString(),
      until: hours(-2).toISOString(),
      ticker: "ETH/USD",
      weight: 0.3,
      reason: "Ether: a test event.",
      source: "events",
    };
    registerAgentSignals(async (id) => (id === userId ? [signal] : []));
    await startTradingAgent(
      userId,
      { policy: POLICY, interval: "15m" },
      { client, now: T0, feed: sampleFeed },
    );
    const ether = (await agentTrades(userId)).filter((t) => t.ticker === "ETH/USD");
    expect(ether[0]).toMatchObject({
      side: "buy",
      source: "events",
      reason: "Ether: a test event.",
    });
    expect(ether[0].placedAt.getTime()).toBeGreaterThanOrEqual(hours(-6).getTime());
    // Sold when the signal ends: none left after it.
    expect(ether.at(-1)!.side).toBe("sell");
    expect(ether.at(-1)!.placedAt.getTime()).toBeGreaterThanOrEqual(hours(-2).getTime());
    const account = await client.paperAccount.findUniqueOrThrow({ where: { userId } });
    expect(
      (account.agentState as { state: { units: Record<string, number> } }).state.units["ETH/USD"],
    ).toBeUndefined();
  });

  it("runs the account in the daily run instead of the pop-up's trades, and stops", async () => {
    const userId = await withAccount();
    await startTradingAgent(
      userId,
      { policy: POLICY, interval: "1h" },
      { client, now: T0, feed: sampleFeed },
    );
    const run = await runPaperDay(userId, { client, now: hours(10), prices: dailyPrices });
    expect(run.signals).toBe(0);
    expect(await client.paperSignal.count({ where: { userId, status: "open" } })).toBe(0);
    // Its trades can't be taken back while it runs.
    const last = (await agentTrades(userId)).at(-1);
    if (last)
      expect(await revertTrade(userId, last.id, { client, now: hours(10) })).toEqual({
        ok: false,
        error: "The 24-hour agent's trades can't be taken back while it runs.",
      });
    await stopTradingAgent(userId, { client });
    expect(await loadAgentView(userId, { client })).toBeNull();
    expect(await tickTradingAgent(userId, { client, now: hours(20), feed: sampleFeed })).toEqual({
      ran: false,
      bars: 0,
      trades: 0,
    });
  });

  it("never runs for a real account", async () => {
    const userId = await person("real");
    await expect(
      startTradingAgent(
        userId,
        { policy: POLICY, interval: "1h" },
        { client, now: T0, feed: sampleFeed },
      ),
    ).rejects.toThrow(AgentError);
    expect(await tickTradingAgent(userId, { client, now: T0, feed: sampleFeed })).toMatchObject({
      ran: false,
    });
  });

  it("keeps fetched bars, and asks the source only for newer ones", async () => {
    const ticker = `TEST${Math.floor(Math.random() * 1e6)}`;
    const fetchRange = vi.fn(async (t: string, from: string, to: string) => ({
      source: "yahoo" as const,
      bars: sampleAgentBars("SPY", from, to, "1h").map((b) => ({ ...b })),
    }));
    const feed = liveFeed(client, {}, fetchRange as never);
    const a = await feed.bars(ticker, "2026-10-19T00:00:00.000Z", "2026-10-20T00:00:00.000Z", "1h");
    expect(a.length).toBeGreaterThan(0);
    // Asked again, only the tail after the newest kept bar goes to the source.
    const again = await feed.bars(
      ticker,
      "2026-10-19T00:00:00.000Z",
      "2026-10-20T00:00:00.000Z",
      "1h",
    );
    expect(again).toEqual(a);
    expect(fetchRange).toHaveBeenCalledTimes(2);
    expect(fetchRange.mock.calls[1][1]).toBe(a.at(-1)!.t);
    const more = await feed.bars(
      ticker,
      "2026-10-19T00:00:00.000Z",
      "2026-10-21T00:00:00.000Z",
      "1h",
    );
    expect(more.length).toBeGreaterThan(a.length);
    expect(fetchRange.mock.calls[2][1]).toBe(a.at(-1)!.t);
    await client.marketBar.deleteMany({ where: { ticker } });
    await client.marketBarRange.deleteMany({ where: { ticker } });
  });
});
