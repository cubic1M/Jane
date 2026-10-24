import { describe, expect, it } from "vitest";
import { fetchYahooDaily, parseYahoo, yahooBars, yahooUrl } from "./yahoo";
import { MarketDataError } from "./types";

// Yahoo's keyless daily chart, on a recorded response: adjusted closes by New York day, days
// without a close skipped, errors as errors. No live calls.

const recorded = {
  chart: {
    result: [
      {
        // 2008-10-09 and 2008-10-10, 09:30 New York (13:30 UTC), and a day with no close.
        timestamp: [1223559000, 1223645400, 1223904600],
        indicators: {
          quote: [
            {
              open: [100, 90.5, 88],
              high: [101, 92, 89],
              low: [95, 85.25, 87],
              close: [96, 90, null],
            },
          ],
          adjclose: [{ adjclose: [70.1234, 65.75, null] }],
        },
      },
    ],
    error: null,
  },
};

describe("Yahoo's daily chart", () => {
  it("reads adjusted closes and the day's bar by New York date", () => {
    const days = parseYahoo(recorded);
    expect(days.map((d) => d.date)).toEqual(["2008-10-09", "2008-10-10"]);
    expect(days[1]).toEqual({ date: "2008-10-10", o: 9050, h: 9200, l: 8525, c: 9000, adj: 6575 });
    expect(yahooBars(days)[0]).toEqual({ date: "2008-10-09", closeCents: 7012 });
  });

  it("asks for the range, and turns refusals into errors", async () => {
    expect(yahooUrl("SPY", "2007-01-01", "2007-01-31")).toContain(
      "/v8/finance/chart/SPY?period1=1167609600",
    );
    const urls: string[] = [];
    const ok = await fetchYahooDaily("SPY", "2008-10-01", "2008-10-31", async (u) => {
      urls.push(u);
      return { json: async () => recorded };
    });
    expect(ok).toHaveLength(2);
    await expect(
      fetchYahooDaily("NOPE", "2008-10-01", "2008-10-31", async () => ({
        json: async () => ({ chart: { result: null, error: { description: "No data found" } } }),
      })),
    ).rejects.toThrow(MarketDataError);
  });
});
