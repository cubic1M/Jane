import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { HistoryError, historyLabel, loadHistory, storedHistory } from "./history";
import { SampleMarketData } from "./sample";
import type { Bar, MarketData } from "./types";

// Spec step 289 against a real, migrated Postgres, with a recorded (fake) feed and no live calls:
// the one-time history load stores closes with their source, fills only what is missing, refuses
// the sample market, and backtests can ask for what is stored.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-17T15:00:00Z");

const weekdays = (from: string, to: string): Bar[] => {
  const out: Bar[] = [];
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`);
    t += 86_400_000
  ) {
    const d = new Date(t);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    out.push({ date: d.toISOString().slice(0, 10), closeCents: 10_000 + out.length });
  }
  return out;
};

function fakeFeed(): MarketData & { calls: [string, string, string][] } {
  const calls: [string, string, string][] = [];
  return {
    name: "alpaca-test",
    simulated: false,
    calls,
    async prices(ticker: string, from: string, to: string) {
      calls.push([ticker, from, to]);
      return weekdays(from, to);
    },
    latest: vi.fn(),
    news: vi.fn(),
    filings: vi.fn(),
  } as never;
}

describe.runIf(url)("the history load", () => {
  let client: PrismaClient;
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  beforeEach(async () => {
    await client.marketPrice.deleteMany({ where: { source: "alpaca-test" } });
    await client.marketHistoryLoad.deleteMany({ where: { source: "alpaca-test" } });
  });
  afterAll(async () => {
    await client.marketPrice.deleteMany({ where: { source: "alpaca-test" } });
    await client.marketHistoryLoad.deleteMany({ where: { source: "alpaca-test" } });
    await client.$disconnect();
  });

  it("refuses the sample market", async () => {
    await expect(loadHistory(new SampleMarketData(), { client, now: NOW })).rejects.toThrow(
      HistoryError,
    );
  });

  it("stores closes with their source and the range, and a second run adds only the new days", async () => {
    const feed = fakeFeed();
    const first = await loadHistory(
      feed,
      { client, now: new Date("2016-02-10T12:00:00Z") },
      { from: "2016-01-04", tickers: ["VTI"] },
    );
    expect(first[0]).toMatchObject({ ticker: "VTI", from: "2016-01-04", to: "2016-02-10" });
    expect(first[0].added).toBeGreaterThan(25);
    const again = await loadHistory(
      feed,
      { client, now: new Date("2016-02-10T12:00:00Z") },
      { from: "2016-01-04", tickers: ["VTI"] },
    );
    expect(again[0].added).toBe(0);
    const later = await loadHistory(
      feed,
      { client, now: new Date("2016-02-17T12:00:00Z") },
      { from: "2016-01-04", tickers: ["VTI"] },
    );
    expect(later[0]).toMatchObject({ to: "2016-02-17" });
    expect(later[0].added).toBe(5);
    expect(feed.calls[feed.calls.length - 1]).toEqual(["VTI", "2016-02-11", "2016-02-17"]);
    const load = await client.marketHistoryLoad.findUniqueOrThrow({
      where: { ticker_source: { ticker: "VTI", source: "alpaca-test" } },
    });
    expect(load.rows).toBe(first[0].added + later[0].added);
  });

  it("gives backtests what is stored, labelled with when it starts, or null when nothing is", async () => {
    const feed = fakeFeed();
    await loadHistory(
      feed,
      { client, now: new Date("2016-01-29T12:00:00Z") },
      { from: "2016-01-04", tickers: ["VTI", "BND"] },
    );
    const h = await storedHistory(["VTI", "BND"], "2016-01-01", "2016-12-31", { client });
    expect(h).not.toBeNull();
    expect(historyLabel(h!)).toBe("real history since 2016-01-04");
    expect(h!.bars.VTI[0].date).toBe("2016-01-04");
    expect(await storedHistory(["VTI", "VXUS"], "2016-01-01", "2016-12-31", { client })).toBeNull();
  });
});
