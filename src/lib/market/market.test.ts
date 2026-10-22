import { describe, expect, it, vi } from "vitest";
import { AlpacaMarketData, barsUrl, newsUrl, parseBars, parseNews } from "./alpaca";
import { EdgarMarketData, parseSubmissions, submissionsUrl } from "./edgar";
import { marketData, WATCH_CIKS } from "./index";
import { PRACTICE_TICKERS, SampleMarketData } from "./sample";
import { MarketDataNotConfigured } from "./types";

// Spec step 289: the sample market is the same for the same date, has its planted events, and
// swapping in the real adapters needs only keys; the adapters are checked on recorded responses
// and make no call without them.

const sample = new SampleMarketData();

describe("the sample market", () => {
  it("gives the same prices for the same dates, every time", async () => {
    const a = await sample.prices("VTI", "2024-01-02", "2024-03-29");
    const b = await new SampleMarketData().prices("VTI", "2024-01-02", "2024-03-29");
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(55);
    expect(a.every((x) => x.closeCents > 0)).toBe(true);
    expect(a.map((x) => x.date)).toEqual([...a.map((x) => x.date)].sort());
  });

  it("covers every practice ETF and answers 'the last close on or before'", async () => {
    for (const t of PRACTICE_TICKERS) {
      const bar = await sample.latest(t, "2026-10-17");
      expect(bar, t).not.toBeNull();
      expect(bar!.date <= "2026-10-17").toBe(true);
    }
    // A Saturday gives Friday's close.
    expect((await sample.latest("VTI", "2026-10-17"))!.date).toBe("2026-10-16");
    expect(await sample.latest("NOPE", "2026-10-17")).toBeNull();
  });

  it("has the planted crash: stocks fall far more than bonds, and cash barely moves", async () => {
    const drawdown = async (t: string) => {
      const bars = await sample.prices(t, "2022-01-03", "2022-10-12");
      return 1 - Math.min(...bars.map((b) => b.closeCents)) / bars[0].closeCents;
    };
    const stocks = await drawdown("VTI");
    const bonds = await drawdown("BND");
    const bills = await drawdown("BIL");
    expect(stocks).toBeGreaterThan(0.1);
    expect(bonds).toBeLessThan(stocks);
    expect(bills).toBeLessThan(0.01);
  });

  it("has this autumn's dip for the scan to find", async () => {
    const before = (await sample.latest("VTI", "2026-10-08"))!.closeCents;
    const low = (await sample.latest("VTI", "2026-10-14"))!.closeCents;
    expect(low).toBeLessThan(before * 0.97);
  });

  it("returns recorded headlines and filings for the watchlist", async () => {
    const news = await sample.news(["NVDA", "TSLA"], "2026-10-01", "2026-10-31");
    expect(news.map((n) => n.ticker)).toContain("TSLA");
    expect(news.some((n) => n.ticker === "AAPL")).toBe(false);
    expect(news.every((n) => n.id && n.source)).toBe(true);
    const filings = await sample.filings("tsla", "2026-10-01", "2026-10-31");
    expect(filings).toHaveLength(1);
    expect(filings[0].form).toBe("8-K");
  });
});

describe("choosing the market data", () => {
  it("is the sample unless both Alpaca keys are set", () => {
    expect(marketData({}).name).toBe("sample");
    expect(marketData({ ALPACA_API_KEY_ID: "x" }).name).toBe("sample");
    expect(marketData({ ALPACA_API_KEY_ID: "x", ALPACA_API_SECRET_KEY: "y" }).name).toBe("alpaca");
    expect(marketData({}).simulated).toBe(true);
  });
});

describe("the Alpaca adapter, on recorded responses", () => {
  const bars = {
    bars: {
      VTI: [
        { t: "2026-10-14T04:00:00Z", c: 301.25 },
        { t: "2026-10-15T04:00:00Z", c: 304.1 },
      ],
    },
  };
  const news = {
    news: [
      {
        id: 42,
        headline: "Tesla recalls vehicles",
        created_at: "2026-10-09T13:00:00Z",
        source: "Benzinga",
        url: "https://x.test/1",
        symbols: ["TSLA"],
      },
    ],
  };
  it("builds its request URLs and parses its responses", () => {
    expect(barsUrl(["VTI"], "2026-10-01", "2026-10-15")).toContain(
      "/v2/stocks/bars?symbols=VTI&timeframe=1Day",
    );
    expect(newsUrl(["TSLA", "AAPL"], "2026-10-01", "2026-10-15")).toContain("symbols=TSLA%2CAAPL");
    expect(parseBars(bars, "VTI")).toEqual([
      { date: "2026-10-14", closeCents: 30125 },
      { date: "2026-10-15", closeCents: 30410 },
    ]);
    expect(parseNews(news)[0]).toMatchObject({
      id: "alpaca-42",
      ticker: "TSLA",
      date: "2026-10-09",
      source: "Benzinga",
    });
  });
  it("makes no call without keys", async () => {
    const fetcher = vi.fn();
    const a = new AlpacaMarketData(null, fetcher);
    await expect(a.prices("VTI", "2026-10-01", "2026-10-15")).rejects.toThrow(
      MarketDataNotConfigured,
    );
    await expect(a.news(["TSLA"], "2026-10-01", "2026-10-15")).rejects.toThrow(
      MarketDataNotConfigured,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("asks with its keys when it has them", async () => {
    const fetcher = vi.fn(async (_url: string, _init: { headers: Record<string, string> }) => ({
      json: async () => bars,
    }));
    const a = new AlpacaMarketData({ id: "k", secret: "s" }, fetcher);
    expect((await a.latest("VTI", "2026-10-15"))!.closeCents).toBe(30410);
    expect(fetcher.mock.calls[0][1].headers).toEqual({
      "APCA-API-KEY-ID": "k",
      "APCA-API-SECRET-KEY": "s",
    });
  });
});

describe("the Alpaca adapter's history, page by page", () => {
  it("follows the page tokens and joins the pages, oldest first", async () => {
    const pages = [
      { bars: { VTI: [{ t: "2016-01-04T05:00:00Z", c: 100.1 }] }, next_page_token: "p2" },
      { bars: { VTI: [{ t: "2016-01-05T05:00:00Z", c: 100.9 }] }, next_page_token: null },
    ];
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: string, _init: { headers: Record<string, string> }) => {
      urls.push(url);
      return { json: async () => pages[urls.length - 1] };
    });
    const a = new AlpacaMarketData({ id: "k", secret: "s" }, fetcher, undefined, "iex");
    const bars = await a.prices("VTI", "2016-01-04", "2016-01-05");
    expect(bars.map((b) => b.date)).toEqual(["2016-01-04", "2016-01-05"]);
    expect(urls[1]).toContain("page_token=p2");
  });
  it("uses the feed it is given", async () => {
    const fetcher = vi.fn(async (_u: string, _i: { headers: Record<string, string> }) => ({
      json: async () => ({ bars: {} }),
    }));
    await new AlpacaMarketData({ id: "k", secret: "s" }, fetcher, undefined, "sip").prices(
      "VTI",
      "2026-10-01",
      "2026-10-02",
    );
    expect(fetcher.mock.calls[0][0]).toContain("feed=sip");
  });
});

describe("the EDGAR adapter, on a recorded response", () => {
  const submissions = {
    filings: {
      recent: {
        accessionNumber: ["0001318605-26-000100", "0001318605-26-000101"],
        filingDate: ["2026-10-09", "2026-10-10"],
        form: ["8-K", "4"],
        primaryDocument: ["tsla-8k.htm", "form4.xml"],
        primaryDocDescription: ["Current report", "Statement of changes"],
      },
    },
  };
  it("keeps only 8-K, 10-Q and 10-K, with a link", () => {
    const f = parseSubmissions(submissions, "TSLA", WATCH_CIKS.TSLA);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ form: "8-K", date: "2026-10-09", ticker: "TSLA" });
    expect(f[0].url).toBe(
      "https://www.sec.gov/Archives/edgar/data/1318605/000131860526000100/tsla-8k.htm",
    );
    expect(submissionsUrl("1318605")).toBe("https://data.sec.gov/submissions/CIK0001318605.json");
  });
  it("makes no call without a User-Agent, and asks with one", async () => {
    const fetcher = vi.fn(async (_url: string, _init: { headers: Record<string, string> }) => ({
      json: async () => submissions,
    }));
    await expect(
      new EdgarMarketData(null, WATCH_CIKS, fetcher).filings("TSLA", "2026-10-01", "2026-10-31"),
    ).rejects.toThrow(MarketDataNotConfigured);
    expect(fetcher).not.toHaveBeenCalled();
    const e = new EdgarMarketData("Jane test@example.com", WATCH_CIKS, fetcher);
    expect(await e.filings("TSLA", "2026-10-01", "2026-10-31")).toHaveLength(1);
    expect(fetcher.mock.calls[0][1].headers["User-Agent"]).toBe("Jane test@example.com");
  });
});
