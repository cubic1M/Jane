import { afterEach, describe, expect, it, vi } from "vitest";
import { NEWS_BATCH_SIZE } from "@/config/news";
import type { MarketData } from "@/lib/market";
import { runNews } from "./store";
import type { Summarizer } from "./summarize";

// A news run with a budget asks Claude about no batch it starts after the budget is spent.

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/system-db", () => ({
  systemDb: () => ({
    marketNews: { createMany: async () => ({ count: 1 }), findMany: async () => [] },
    newsSummaryCall: {
      aggregate: async () => ({ _sum: { costHundredths: 0 } }),
      count: async () => 0,
      create: async () => ({ id: "call" }),
      update: async () => ({}),
    },
  }),
}));

const feed: MarketData = {
  name: "news-test",
  simulated: false,
  prices: vi.fn(),
  latest: vi.fn(),
  news: async () =>
    Array.from({ length: NEWS_BATCH_SIZE * 2 }, (_, i) => ({
      id: `n${i}`,
      ticker: "VTI",
      date: "2026-10-15",
      title: `Headline number ${i}`,
      source: "Test wire",
      url: null,
    })),
  filings: async () => [],
};

describe("the news run's time budget", () => {
  afterEach(() => vi.useRealTimers());

  const run = (budgetMs?: number) => {
    vi.useFakeTimers();
    const summarizer = vi.fn<Summarizer>(async () => {
      vi.advanceTimersByTime(20_000);
      return { summaries: new Map(), usage: { inputTokens: 1, outputTokens: 1 } };
    });
    return runNews({
      now: new Date("2026-10-16T15:00:00Z"),
      env: { ANTHROPIC_API_KEY: "test-key", ANTHROPIC_MODEL_NEWS: "claude-haiku-5-5" },
      market: feed,
      summarizer,
      budgetMs,
    }).then((result) => ({ result, asked: summarizer.mock.calls.length }));
  };

  it("stops between batches once the budget is spent, and leaves the rest unstored", async () => {
    const { result, asked } = await run(10_000);
    expect(asked).toBe(1);
    expect(result).toMatchObject({ skipped: "time", stored: NEWS_BATCH_SIZE });
  });

  it("asks about everything inside it, or with none given", async () => {
    for (const budget of [60_000, undefined]) {
      const { result, asked } = await run(budget);
      expect(asked).toBe(2);
      expect(result).toMatchObject({ skipped: null, stored: NEWS_BATCH_SIZE * 2 });
    }
  });
});
