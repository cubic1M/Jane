import { describe, expect, it } from "vitest";
import { fetchIntraday, intradayUrl, parseIntraday } from "./alpaca-intraday";
import { MarketDataError, MarketDataNotConfigured } from "./types";

// Alpaca's intraday bars: paged, in cents, refusals as errors, keys only in headers. No live calls.

const keys = { id: "k", secret: "s" };
const bar = (t: string, c: number) => ({ t, o: c, h: c, l: c, c, v: 10 });

describe("fetchIntraday", () => {
  it("follows every page and keeps the keys out of the URL", async () => {
    const urls: string[] = [];
    const pages = [
      { bars: { SPY: [bar("2024-01-10T14:30:00Z", 470.12)] }, next_page_token: "p2" },
      { bars: { SPY: [bar("2024-01-10T14:35:00Z", 470.5)] }, next_page_token: null },
    ];
    const fetcher = async (url: string, init: { headers: Record<string, string> }) => {
      urls.push(url);
      expect(init.headers["APCA-API-KEY-ID"]).toBe("k");
      return { ok: true, json: async () => pages[urls.length - 1] };
    };
    const out = await fetchIntraday(keys, "SPY", "2024-01-10", "2024-01-11", { fetcher });
    expect(out.map((b) => b.c)).toEqual([47_012, 47_050]);
    expect(urls[1]).toContain("page_token=p2");
    expect(urls.join()).not.toContain("secret");
  });

  it("throws on a refusal and without keys", async () => {
    const fetcher = async () => ({ ok: false, status: 403, json: async () => ({ message: "no" }) });
    await expect(fetchIntraday(keys, "SPY", "a", "b", { fetcher })).rejects.toThrow(
      MarketDataError,
    );
    await expect(fetchIntraday(null, "SPY", "a", "b")).rejects.toThrow(MarketDataNotConfigured);
  });

  it("asks for adjusted bars of the timeframe and feed", () => {
    const url = intradayUrl("SPY", "2024-01-01", "2024-02-01", "5Min", "sip");
    expect(url).toContain("timeframe=5Min");
    expect(url).toContain("adjustment=all");
    expect(url).toContain("feed=sip");
    expect(parseIntraday({ bars: null }, "SPY")).toEqual([]);
  });
});
