import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/advice-mode", () => ({ adviceMode: vi.fn(async () => true) }));
vi.mock("@/lib/news/read", () => ({ loadNews: vi.fn() }));

import { DEMO_ADVICE_LABEL } from "@/config/advice";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { loadNews, type NewsView } from "@/lib/news/read";
import { CHAT_TOOLS, runChatTool } from "./claude-tools";
import { NEWS_NOT_IN_ADVICE } from "./news-tools";
import { toolsFor } from "./tool-select";

// Spec step 293: Jane's chat reads the stored news through a Claude tool. Demo advice people get
// the summaries and filings (labelled, sample), with every dollar figure recorded for the
// guardrails; real accounts get a plain note and no news.

const NOW = new Date("2026-10-16T15:00:00Z");
const client = {} as PrismaClient;

const VIEW: NewsView = {
  feed: "sample",
  simulated: true,
  headlines: [
    {
      ticker: "MSFT",
      date: "2026-10-16",
      title: "Microsoft announces a $5 billion data-center investment",
      source: "Sample newswire",
      url: null,
      summary: "MSFT: Microsoft announces a $5 billion data-center investment.",
      summaryBy: "rules",
    },
    {
      ticker: null,
      date: "2026-10-12",
      title: "Stocks fall for a third day as investors weigh slower growth",
      source: "Sample newswire",
      url: null,
      summary: "Markets: Stocks fall for a third day as investors weigh slower growth.",
      summaryBy: "claude",
    },
    {
      ticker: "TSLA",
      date: "2026-10-09",
      title: "Tesla recalls vehicles over a software fault; shares slip",
      source: "Sample newswire",
      url: null,
      summary: "TSLA: Tesla recalls vehicles over a software fault, and shares slip.",
      summaryBy: "rules",
    },
  ],
  filings: [
    {
      ticker: "TSLA",
      date: "2026-10-09",
      form: "8-K",
      title: "Current report: recall of vehicles",
      url: "https://www.sec.gov/x",
    },
    { ticker: "NVDA", date: "2026-08-27", form: "10-Q", title: "Quarterly report", url: null },
  ],
};

describe("the market_news tool", () => {
  beforeEach(() => {
    vi.mocked(adviceMode).mockResolvedValue(true);
    vi.mocked(loadNews).mockResolvedValue(VIEW);
  });

  it("is one of Claude's tools and goes with investing and news questions", () => {
    expect(CHAT_TOOLS.map((t) => t.name)).toContain("market_news");
    const names = (q: string) =>
      toolsFor(CHAT_TOOLS, q, null, null, "2026-10-16").map((t) => t.name);
    expect(names("any news on nvidia this week?")).toContain("market_news");
    expect(names("what filings did tesla make")).toContain("market_news");
    expect(names("how are my stocks doing")).toContain("market_news");
    expect(names("how much did I spend on groceries")).not.toContain("market_news");
  });

  it("gives demo advice people the summaries and filings, labelled as sample, with figures recorded", async () => {
    const out = await runChatTool("u1", "market_news", {}, { client, now: NOW });
    const body = JSON.parse(out.content);
    expect(body.label).toBe(DEMO_ADVICE_LABEL);
    expect(body.sample).toBe(true);
    expect(body.headlines).toHaveLength(3);
    expect(body.headlines[0]).toMatchObject({ ticker: "MSFT", summary: VIEW.headlines[0].summary });
    expect(body.headlines[1].ticker).toBe("market");
    expect(body.filings[0]).toMatchObject({ form: "8-K", link: "https://www.sec.gov/x" });
    // "$5 billion": a scaled figure, recorded as $5 so a sentence quoting the headline isn't blocked.
    expect(out.cents).toContain(500);
    expect(loadNews).toHaveBeenCalledWith(expect.objectContaining({ client, now: NOW }));
  });

  it("filters to one ticker, keeping market-wide news", async () => {
    const body = JSON.parse(
      (await runChatTool("u1", "market_news", { ticker: "tsla" }, { client, now: NOW })).content,
    );
    expect(body.headlines.map((h: { ticker: string }) => h.ticker)).toEqual(["market", "TSLA"]);
    expect(body.filings.map((f: { ticker: string }) => f.ticker)).toEqual(["TSLA"]);
  });

  it("gives real accounts a note and no news", async () => {
    vi.mocked(adviceMode).mockResolvedValue(false);
    const out = await runChatTool("u2", "market_news", {}, { client, now: NOW });
    expect(JSON.parse(out.content)).toEqual({ note: NEWS_NOT_IN_ADVICE });
    expect(out.cents).toEqual([]);
    expect(loadNews).not.toHaveBeenCalled();
  });
});
