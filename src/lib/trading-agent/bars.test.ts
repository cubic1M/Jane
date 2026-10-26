import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cachedBars, mergeBars } from "./bar-cache";
import {
  cryptoIntradayUrl,
  fetchAgentBars,
  fetchCryptoBars,
  parseYahooIntraday,
  sessionBars,
  sourceFor,
  yahooIntradayUrl,
} from "./bars";

// The agent's bars: recorded answers parsed, pages followed, hours built from the 9:30 open,
// the source chosen by the keys, and the research cache asking only for what it lacks. No live
// call: every fetch here is a recorded answer.

const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });

describe("Alpaca's crypto bars", () => {
  it("reads every page, in cents, with no key", async () => {
    const pages = [
      {
        bars: { "BTC/USD": [{ t: "2026-10-26T00:00:00Z", o: 1, h: 2, l: 0.5, c: 1.5, v: 3 }] },
        next_page_token: "p2",
      },
      {
        bars: { "BTC/USD": [{ t: "2026-10-26T01:00:00Z", o: 1.5, h: 1.6, l: 1.4, c: 1.55, v: 1 }] },
        next_page_token: null,
      },
    ];
    const fetcher = vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
      expect(init?.headers ?? {}).toEqual({});
      return ok(pages.shift());
    });
    const bars = await fetchCryptoBars(
      "BTC/USD",
      "2026-10-26T00:00:00Z",
      "2026-10-26T02:00:00Z",
      "1h",
      fetcher,
    );
    expect(bars).toEqual([
      { t: "2026-10-26T00:00:00.000Z", o: 100, h: 200, l: 50, c: 150, v: 3 },
      { t: "2026-10-26T01:00:00.000Z", o: 150, h: 160, l: 140, c: 155, v: 1 },
    ]);
    expect(fetcher.mock.calls[1][0]).toContain("page_token=p2");
    expect(cryptoIntradayUrl("ETH/USD", "a", "b", "15m")).toContain(
      "symbols=ETH%2FUSD&timeframe=15Min",
    );
  });
});

describe("rate limits", () => {
  it("asks again after a 429, waiting longer each time", async () => {
    const answers = [
      { ok: false, status: 429, json: async () => ({}) },
      { ok: false, status: 429, json: async () => ({}) },
      ok({ bars: { "BTC/USD": [] }, next_page_token: null }),
    ];
    const waits: number[] = [];
    const bars = await fetchCryptoBars(
      "BTC/USD",
      "a",
      "b",
      "1h",
      async () => answers.shift()!,
      async (ms) => waits.push(ms),
    );
    expect(bars).toEqual([]);
    expect(waits).toEqual([1_000, 2_000]);
  });
});

describe("Yahoo's intraday chart", () => {
  it("parses a recorded answer and skips empty bars", () => {
    const bars = parseYahooIntraday({
      chart: {
        result: [
          {
            timestamp: [1_792_853_400, 1_792_857_000],
            indicators: {
              quote: [
                {
                  open: [500, null],
                  high: [501, null],
                  low: [499, null],
                  close: [500.5, null],
                  volume: [10, null],
                },
              ],
            },
          },
        ],
      },
    });
    expect(bars).toEqual([
      {
        t: new Date(1_792_853_400_000).toISOString(),
        o: 50_000,
        h: 50_100,
        l: 49_900,
        c: 50_050,
        v: 10,
      },
    ]);
    expect(yahooIntradayUrl("SPY", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z", "1h")).toContain(
      "interval=60m&includePrePost=false",
    );
  });
});

describe("sessionBars", () => {
  it("joins 15-minute bars into hours from the 9:30 open and drops the pre-market", () => {
    // Wednesday, October 21, 2026 (New York summer time: 9:30 is 13:30 UTC).
    const q = (t: string, o: number, h: number, l: number, c: number) => ({ t, o, h, l, c, v: 1 });
    const hours = sessionBars(
      [
        q("2026-10-21T13:15:00Z", 1, 1, 1, 1), // 9:15, before the open
        q("2026-10-21T13:30:00Z", 10, 12, 9, 11),
        q("2026-10-21T13:45:00Z", 11, 13, 10, 12),
        q("2026-10-21T14:00:00Z", 12, 12, 8, 9),
        q("2026-10-21T14:15:00Z", 9, 10, 9, 10),
        q("2026-10-21T14:30:00Z", 10, 10, 10, 10), // 10:30: the next hour
      ],
      60,
    );
    expect(hours).toEqual([
      { t: "2026-10-21T13:30:00.000Z", o: 10, h: 13, l: 8, c: 10, v: 4 },
      { t: "2026-10-21T14:30:00.000Z", o: 10, h: 10, l: 10, c: 10, v: 1 },
    ]);
  });
});

describe("the source", () => {
  it("is Alpaca for crypto always, and for funds only with both keys; else Yahoo", () => {
    expect(sourceFor("BTC/USD", {})).toBe("alpaca-crypto");
    expect(sourceFor("SPY", {})).toBe("yahoo");
    expect(sourceFor("SPY", { ALPACA_API_KEY_ID: "x" })).toBe("yahoo");
    expect(sourceFor("SPY", { ALPACA_API_KEY_ID: "x", ALPACA_API_SECRET_KEY: "y" })).toBe("alpaca");
  });

  it("sends the keys only in headers, never in the address", async () => {
    const fetcher = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      expect(url).not.toContain("test-secret");
      expect(url).not.toContain("test-id");
      expect(url).toContain("/v2/stocks/bars");
      expect(url).not.toMatch(/orders|positions|account/);
      expect(init?.headers?.["APCA-API-SECRET-KEY"]).toBe("test-secret");
      return ok({ bars: { SPY: [] }, next_page_token: null });
    });
    const out = await fetchAgentBars("SPY", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z", "1h", {
      env: { ALPACA_API_KEY_ID: "test-id", ALPACA_API_SECRET_KEY: "test-secret" },
      fetcher,
    });
    expect(out).toEqual({ source: "alpaca", bars: [] });
  });
});

describe("the research cache", () => {
  it("fetches once, then only what is newer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-bars-"));
    const bar = (t: string) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1 });
    const fetchRange = vi.fn(async (from: string, to: string) =>
      [
        bar("2026-10-01T00:00:00.000Z"),
        bar("2026-10-02T00:00:00.000Z"),
        bar("2026-10-03T00:00:00.000Z"),
      ].filter((b) => b.t >= from && b.t <= to),
    );
    const first = await cachedBars(
      dir,
      "x",
      "BTC/USD",
      "1h",
      "2026-10-01T00:00:00.000Z",
      "2026-10-02T00:00:00.000Z",
      fetchRange,
    );
    expect(first.bars).toHaveLength(2);
    const again = await cachedBars(
      dir,
      "x",
      "BTC/USD",
      "1h",
      "2026-10-01T00:00:00.000Z",
      "2026-10-02T00:00:00.000Z",
      fetchRange,
    );
    expect(again).toEqual({ bars: first.bars, fetched: 0 });
    const more = await cachedBars(
      dir,
      "x",
      "BTC/USD",
      "1h",
      "2026-10-01T00:00:00.000Z",
      "2026-10-03T00:00:00.000Z",
      fetchRange,
    );
    expect(more.bars).toHaveLength(3);
    expect(fetchRange).toHaveBeenLastCalledWith(
      "2026-10-02T00:00:00.000Z",
      "2026-10-03T00:00:00.000Z",
    );
    expect(mergeBars([bar("b")], [bar("a"), { ...bar("b"), c: 2 }])).toEqual([
      bar("a"),
      { ...bar("b"), c: 2 },
    ]);
  });
});
