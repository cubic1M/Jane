import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NEWS_BATCH_SIZE, NEWS_CALLS_PER_DAY } from "@/config/news";
import { PrismaClient } from "@/generated/prisma/client";
import { AlpacaMarketData } from "@/lib/market/alpaca";
import { EdgarMarketData } from "@/lib/market/edgar";
import { SampleMarketData } from "@/lib/market/sample";
import type { Headline, MarketData } from "@/lib/market";
import { loadNews } from "./read";
import { runNews, worstCaseHundredths } from "./store";
import type { Summarizer } from "./summarize";

// Spec step 293 against a real, migrated Postgres: the daily job stores each headline once with
// a summary and each filing as a fact with a link; Claude (a fake here) is asked only with the
// key and the news model, in batches, at most a few times a day and never past the monthly cap;
// a summary that predicts a price is replaced by the rules; and the chat's reader makes no call.
// The real adapters run only on recorded responses.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-16T15:00:00Z");
const KEYS = { ANTHROPIC_API_KEY: "test-key", ANTHROPIC_MODEL_NEWS: "claude-haiku-5-5" };

// Echoes each headline as a fact, except one it turns into a forecast.
function fakeSummarizer(): Summarizer & { batches: number[] } {
  const batches: number[] = [];
  const fn = (async (batch: readonly Headline[]) => {
    batches.push(batch.length);
    return {
      summaries: new Map(
        batch.map((h, i) => [
          `h${i + 1}`,
          h.title.startsWith("Tesla recalls")
            ? "TSLA: shares could rebound once the recall is done."
            : `${h.ticker ?? "Markets"}: (by Claude) ${h.title}.`,
        ]),
      ),
      usage: { inputTokens: 500, outputTokens: 300 },
    };
  }) as unknown as Summarizer & { batches: number[] };
  fn.batches = batches;
  return fn;
}

// A feed with `count` headlines this week and nothing else.
function manyHeadlines(count: number): MarketData {
  return {
    name: "news-test",
    simulated: false,
    prices: vi.fn(),
    latest: vi.fn(),
    news: async () =>
      Array.from({ length: count }, (_, i) => ({
        id: `n${i}`,
        ticker: "VTI",
        date: "2026-10-15",
        title: `Headline number ${i}`,
        source: "Test wire",
        url: null,
      })),
    filings: async () => [],
  };
}

describe.runIf(url)("the news job", () => {
  let client: PrismaClient;
  const clear = async () => {
    await client.marketNews.deleteMany({});
    await client.newsSummaryCall.deleteMany({});
  };
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  beforeEach(clear);
  afterAll(async () => {
    await clear();
    await client.$disconnect();
  });

  it("makes no call without the key: the rules summarise every headline, filings are stored with a link", async () => {
    const summarizer = fakeSummarizer();
    const run = await runNews({
      client,
      now: NOW,
      env: {},
      market: new SampleMarketData(),
      summarizer,
    });
    expect(summarizer.batches).toEqual([]);
    expect(await client.newsSummaryCall.count()).toBe(0);
    expect(run).toMatchObject({ feed: "sample", calls: 0, byClaude: 0, skipped: "off" });
    expect(run.byRules).toBe(run.stored);
    expect(run.stored).toBeGreaterThan(3);
    // Sample filings in the last 90 days: TSLA and MSFT 8-Ks, NVDA and AAPL 10-Qs.
    expect(run.filings).toBe(4);
    const rows = await client.marketNews.findMany({ where: { kind: "headline" } });
    expect(rows.every((r) => r.summaryBy === "rules" && r.summary)).toBe(true);
  });

  it("makes no call with the key but no news model", async () => {
    const summarizer = fakeSummarizer();
    await runNews({
      client,
      now: NOW,
      env: { ANTHROPIC_API_KEY: "test-key" },
      market: new SampleMarketData(),
      summarizer,
    });
    expect(summarizer.batches).toEqual([]);
  });

  it("with both set, asks Claude once per batch, records the cost, and replaces a forecast with the rules", async () => {
    const summarizer = fakeSummarizer();
    const run = await runNews({
      client,
      now: NOW,
      env: KEYS,
      market: new SampleMarketData(),
      summarizer,
    });
    expect(summarizer.batches).toHaveLength(1);
    expect(run.calls).toBe(1);
    const calls = await client.newsSummaryCall.findMany();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ ok: true, model: "claude-haiku-5-5", inputTokens: 500 });
    expect(calls[0].costHundredths).toBeLessThan(worstCaseHundredths("claude-haiku-5-5", 20));
    const tesla = await client.marketNews.findFirstOrThrow({
      where: { kind: "headline", title: { startsWith: "Tesla recalls" } },
    });
    expect(tesla.summaryBy).toBe("rules");
    expect(tesla.summary).toBe(
      "TSLA: Tesla recalls vehicles over a software fault, and shares slip.",
    );
    expect(run.byClaude).toBe(run.stored - 1);

    // A second run the same day: everything is stored already, so no call.
    const again = await runNews({
      client,
      now: NOW,
      env: KEYS,
      market: new SampleMarketData(),
      summarizer,
    });
    expect(again).toMatchObject({ stored: 0, calls: 0, filings: 0 });
    expect(summarizer.batches).toHaveLength(1);
  });

  it("keeps to a few calls a day: past them the rules summarise the rest", async () => {
    const summarizer = fakeSummarizer();
    const count = NEWS_BATCH_SIZE * (NEWS_CALLS_PER_DAY + 1) + 3;
    const run = await runNews({
      client,
      now: NOW,
      env: KEYS,
      market: manyHeadlines(count),
      summarizer,
    });
    expect(summarizer.batches).toHaveLength(NEWS_CALLS_PER_DAY);
    expect(summarizer.batches.every((n) => n <= NEWS_BATCH_SIZE)).toBe(true);
    expect(run).toMatchObject({ stored: count, skipped: "daily_calls" });
    expect(run.byClaude).toBe(NEWS_CALLS_PER_DAY * NEWS_BATCH_SIZE);
  });

  it("makes no call past the monthly cap, and calls again in the next month", async () => {
    // 99.9 cents spent this month: a call could cost more than the 0.1 cent left.
    await client.newsSummaryCall.create({
      data: {
        calledAt: new Date("2026-10-02T10:00:00Z"),
        model: "claude-haiku-5-5",
        headlines: 20,
        costHundredths: 9_990,
        ok: true,
      },
    });
    const summarizer = fakeSummarizer();
    const run = await runNews({
      client,
      now: NOW,
      env: KEYS,
      market: new SampleMarketData(),
      summarizer,
    });
    expect(summarizer.batches).toEqual([]);
    expect(run).toMatchObject({ calls: 0, skipped: "monthly_cap" });
    expect(run.byRules).toBe(run.stored);

    // A higher cap set in the environment lets it through.
    await client.marketNews.deleteMany({});
    await runNews({
      client,
      now: NOW,
      env: { ...KEYS, NEWS_MONTHLY_CAP_CENTS: "200" },
      market: new SampleMarketData(),
      summarizer,
    });
    expect(summarizer.batches).toHaveLength(1);

    // November starts a new month.
    await client.marketNews.deleteMany({});
    await runNews({
      client,
      now: new Date("2026-11-03T15:00:00Z"),
      env: KEYS,
      market: manyHeadlines(2),
      summarizer,
    });
    expect(summarizer.batches).toHaveLength(2);
  });

  it("counts a call that failed against the cap, and stores the rules summaries", async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const failing = (async () => {
      throw new Anthropic.APIError(529, undefined, "overloaded", new Headers());
    }) as Summarizer;
    const run = await runNews({
      client,
      now: NOW,
      env: KEYS,
      market: manyHeadlines(3),
      summarizer: failing,
    });
    expect(run).toMatchObject({ calls: 1, stored: 3, byRules: 3 });
    const call = await client.newsSummaryCall.findFirstOrThrow();
    expect(call.ok).toBe(false);
    expect(call.costHundredths).toBe(worstCaseHundredths("claude-haiku-5-5", 3));
  });

  it("stores Alpaca headlines and EDGAR filings read from recorded responses", async () => {
    const recordedNews = {
      news: [
        {
          id: 41200001,
          headline: "Microsoft announces a large new data-center investment",
          created_at: "2026-10-16T13:05:00Z",
          source: "benzinga",
          url: "https://example.com/msft",
          symbols: ["MSFT"],
        },
      ],
    };
    const recordedSubmissions = {
      filings: {
        recent: {
          accessionNumber: ["0000789019-26-000123", "0000789019-26-000099"],
          filingDate: ["2026-10-16", "2026-07-30"],
          form: ["8-K", "10-K"],
          primaryDocument: ["msft-8k.htm", "msft-10k.htm"],
          primaryDocDescription: ["Current report", "Annual report"],
        },
      },
    };
    const fetcher = vi.fn(async (u: string) => ({
      json: async () =>
        u.includes("/news")
          ? recordedNews
          : u.includes("CIK0000789019")
            ? recordedSubmissions
            : { filings: {} },
    }));
    const edgar = new EdgarMarketData(
      "Jane test test@example.com",
      { MSFT: "0000789019" },
      fetcher,
    );
    const alpaca = new AlpacaMarketData({ id: "id", secret: "secret" }, fetcher, edgar);
    const run = await runNews({ client, now: NOW, env: {}, market: alpaca });
    expect(run).toMatchObject({ feed: "alpaca", stored: 1, filings: 1 });
    const filing = await client.marketNews.findFirstOrThrow({ where: { kind: "filing" } });
    expect(filing).toMatchObject({
      ticker: "MSFT",
      form: "8-K",
      url: "https://www.sec.gov/Archives/edgar/data/789019/000078901926000123/msft-8k.htm",
    });

    // The reader shows what is stored and asks the feed for nothing.
    fetcher.mockClear();
    const view = await loadNews({ client, now: NOW, market: alpaca });
    expect(fetcher).not.toHaveBeenCalled();
    expect(view.simulated).toBe(false);
    expect(view.headlines).toEqual([
      expect.objectContaining({
        ticker: "MSFT",
        summary: "MSFT: Microsoft announces a large new data-center investment.",
        url: "https://example.com/msft",
      }),
    ]);
    expect(view.filings).toEqual([expect.objectContaining({ form: "8-K", ticker: "MSFT" })]);
  });

  it("on the sample market, the reader fills in what the job hasn't stored, newest first, with no call", async () => {
    const summarizer = fakeSummarizer();
    const view = await loadNews({ client, now: NOW, market: new SampleMarketData() });
    expect(summarizer.batches).toEqual([]);
    expect(view.simulated).toBe(true);
    expect(view.headlines.length).toBeGreaterThan(3);
    expect(view.headlines.every((h) => h.summaryBy === "rules")).toBe(true);
    const dates = view.headlines.map((h) => h.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(view.filings.map((f) => f.form).sort()).toEqual(["10-Q", "10-Q", "8-K", "8-K"]);

    // Once stored, the same items aren't listed twice, and Claude's summary is the one shown.
    await runNews({ client, now: NOW, env: KEYS, market: new SampleMarketData(), summarizer });
    const after = await loadNews({ client, now: NOW, market: new SampleMarketData() });
    expect(after.headlines.length).toBe(view.headlines.length);
    expect(after.filings.length).toBe(view.filings.length);
    expect(after.headlines.some((h) => h.summaryBy === "claude")).toBe(true);
  });
});
