import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn() }));

import { BACKTEST_MIN_REAL_DAYS } from "@/config/backtest";
import { PRACTICE_ETFS } from "@/config/portfolios";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { SampleMarketData } from "@/lib/market/sample";
import { backtestsFor, loadBacktests } from "./backtest";

// Spec step 295: the five replays. Stored real history wins when there is enough of it; else
// the sample market, said so; never a forecast; never a live call; demo advice only.

const NOW = new Date("2026-10-21T15:00:00Z");
const TICKERS = Object.values(PRACTICE_ETFS).map((e) => e.ticker);

type Row = { ticker: string; date: Date; closeCents: number; source: string };

// A stand-in for the market_prices table, answering storedHistory()'s one query.
function fakeClient(rows: Row[]) {
  const findMany = vi.fn(
    async ({ where }: { where: { ticker: string; date: { gte: Date; lte: Date } } }) =>
      rows
        .filter(
          (r) => r.ticker === where.ticker && r.date >= where.date.gte && r.date <= where.date.lte,
        )
        .sort((a, b) => a.date.getTime() - b.date.getTime()),
  );
  return { client: { marketPrice: { findMany } } as unknown as PrismaClient, findMany };
}

// "Real" stored closes: the sample's own prices from a date, relabelled as Alpaca's.
async function storedRows(from: string, days: number): Promise<Row[]> {
  const sample = new SampleMarketData();
  const out: Row[] = [];
  for (const ticker of TICKERS) {
    const bars = (await sample.prices(ticker, from, "2026-10-21")).slice(0, days);
    for (const b of bars)
      out.push({
        ticker,
        date: new Date(`${b.date}T00:00:00Z`),
        closeCents: b.closeCents,
        source: "alpaca",
      });
  }
  return out;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("loadBacktests on the sample market", () => {
  it("gives higher levels larger worst drops", async () => {
    const { client } = fakeClient([]);
    const b = await loadBacktests({ client, now: NOW });
    expect(b.levels.map((l) => l.level)).toEqual([1, 2, 3, 4, 5]);
    const drops = b.levels.map((l) => l.result.worstDrop.fraction);
    for (let i = 1; i < drops.length; i += 1) expect(drops[i]).toBeLessThan(drops[i - 1]);
    // The planted shocks are in it: every level falls, the boldest by more than a quarter.
    expect(drops[0]).toBeLessThan(0);
    expect(drops[4]).toBeLessThan(-0.25);
  });

  it("is labelled as a replay of sample history, never a forecast", async () => {
    const { client } = fakeClient([]);
    const b = await loadBacktests({ client, now: NOW });
    expect(b.source).toBe("sample");
    expect(b.label).toBe("Replay of sample history since Jan 2, 2018");
    expect(b.note).toMatch(/made-up prices, with a planted crash and recovery/);
    expect(b.notAForecast).toBe(
      "A replay of the past, not a forecast: future results will be different.",
    );
    // "Forecast" only ever appears as "not a forecast".
    const words = [b.label, b.note, b.notAForecast].join(" ");
    expect(words.replaceAll("not a forecast", "")).not.toMatch(/forecast|projection|expected/i);
  });

  it("stops at today though the sample market runs on", async () => {
    const { client } = fakeClient([]);
    const b = await loadBacktests({ client, now: NOW });
    expect(b.to).toBe("2026-10-21");
    for (const l of b.levels) expect(l.result.path.at(-1)!.date <= "2026-10-21").toBe(true);
    // 2026 is a part year: shown, but never the best or worst year.
    const r = b.levels[4].result;
    expect(r.years.find((y) => y.year === 2026)?.whole).toBe(false);
    expect([r.bestYear?.year, r.worstYear?.year]).not.toContain(2026);
  });

  it("states the assumptions: fund costs, the band, no taxes", async () => {
    const { client } = fakeClient([]);
    const b = await loadBacktests({ client, now: NOW });
    expect(b.assumptions).toEqual({
      startCents: 1_000_000,
      feeBps: { us_stocks: 3, intl_stocks: 5, bonds: 3, cash: 13.59 },
      rebalanceBandPoints: 5,
      tradeCostBps: 0,
      taxes: "none",
      moneyAddedOrTaken: "none",
    });
    // Very low: 0.2×3 + 0.1×5 + 0.6×3 + 0.1×13.59 = 4.259 basis points a year.
    expect(b.levels[0].yearlyFeeBps).toBeCloseTo(4.259, 6);
    expect(b.levels.every((l) => l.result.feesCents > 0)).toBe(true);
  });
});

describe("loadBacktests with stored history", () => {
  it("uses stored real history over the sample when it is there", async () => {
    const { client } = fakeClient(await storedRows("2020-01-02", 600));
    const b = await loadBacktests({ client, now: NOW });
    expect(b.source).toBe("real");
    expect(b.label).toBe("Replay of real history since Jan 2, 2020");
    expect(b.note).toMatch(/adjusted for splits and dividends/);
    expect(b.from).toBe("2020-01-02");
    expect(b.levels[0].result.path).toHaveLength(600);
  });

  it("falls back to the sample when the stored history is too short to replay", async () => {
    const { client } = fakeClient(await storedRows("2026-01-02", BACKTEST_MIN_REAL_DAYS - 1));
    const b = await loadBacktests({ client, now: NOW });
    expect(b.source).toBe("sample");
  });

  it("falls back to the sample when a fund has no stored history", async () => {
    const rows = (await storedRows("2020-01-02", 600)).filter((r) => r.ticker !== "BIL");
    const { client } = fakeClient(rows);
    expect((await loadBacktests({ client, now: NOW })).source).toBe("sample");
  });
});

describe("no live calls", () => {
  it("never calls out, even with the Alpaca keys set", async () => {
    vi.stubEnv("ALPACA_API_KEY_ID", "test-id");
    vi.stubEnv("ALPACA_API_SECRET_KEY", "test-secret");
    const fetch = vi.fn(async () => {
      throw new Error("no network in a backtest");
    });
    vi.stubGlobal("fetch", fetch);
    const { client } = fakeClient([]);
    const b = await loadBacktests({ client, now: NOW });
    expect(b.source).toBe("sample");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("backtestsFor", () => {
  it("is demo advice: nothing for a real account", async () => {
    vi.mocked(adviceMode).mockResolvedValue(false);
    const { client, findMany } = fakeClient([]);
    expect(await backtestsFor("user-1", { client, now: NOW })).toEqual({ advice: false });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("gives the replays in demo advice mode", async () => {
    vi.mocked(adviceMode).mockResolvedValue(true);
    const { client } = fakeClient([]);
    const out = await backtestsFor("user-1", { client, now: NOW });
    expect(out.advice && out.backtests.levels).toHaveLength(5);
  });
});
