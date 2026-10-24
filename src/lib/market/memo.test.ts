import { describe, expect, it } from "vitest";
import { marketData, withMarketData } from "./index";
import { MemoMarketData } from "./memo";
import { SampleMarketData } from "./sample";
import type { MarketData } from "./types";

// A replay's market data: one request per ticker for the whole window, the same answers as the
// feed, and anything outside the window still goes to the feed.

function counted(feed: MarketData) {
  const calls: string[] = [];
  const wrap: MarketData = {
    name: feed.name,
    simulated: feed.simulated,
    prices: (t, f, to) => (calls.push(`prices:${t}`), feed.prices(t, f, to)),
    latest: (t, on) => (calls.push(`latest:${t}`), feed.latest(t, on)),
    news: (ts, f, to) => (calls.push("news"), feed.news(ts, f, to)),
    filings: (t, f, to) => (calls.push(`filings:${t}`), feed.filings(t, f, to)),
  };
  return { wrap, calls };
}

describe("MemoMarketData", () => {
  const sample = new SampleMarketData();

  it("answers as the feed does, asking it once for the window", async () => {
    const { wrap, calls } = counted(sample);
    const memo = new MemoMarketData(wrap, "2026-06-01", "2026-10-22");
    for (const on of ["2026-09-01", "2026-09-02", "2026-10-03", "2026-10-22"]) {
      expect(await memo.latest("VTI", on)).toEqual(await sample.latest("VTI", on));
      expect(await memo.prices("BND", "2026-07-01", on)).toEqual(
        await sample.prices("BND", "2026-07-01", on),
      );
      expect(await memo.news(["AAPL"], "2026-08-01", on)).toEqual(
        await sample.news(["AAPL"], "2026-08-01", on),
      );
    }
    expect(calls.sort()).toEqual(["news", "prices:BND", "prices:VTI"]);
  });

  it("sends anything outside the window to the feed", async () => {
    const { wrap, calls } = counted(sample);
    const memo = new MemoMarketData(wrap, "2026-06-01", "2026-10-22");
    expect(await memo.latest("VTI", "2026-10-23")).toEqual(
      await sample.latest("VTI", "2026-10-23"),
    );
    await memo.prices("VTI", "2026-01-02", "2026-02-02");
    expect(calls).toEqual(["latest:VTI", "prices:VTI"]);
  });

  it("is what marketData() gives inside withMarketData, and only there", async () => {
    const memo = new MemoMarketData(sample, "2026-06-01", "2026-10-22");
    expect(await withMarketData(memo, async () => marketData())).toBe(memo);
    expect(marketData({})).not.toBe(memo);
  });
});
