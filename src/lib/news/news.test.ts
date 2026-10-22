import type Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@/lib/anthropic", async (original) => ({
  ...(await original<typeof import("@/lib/anthropic")>()),
  anthropic: () => ({ messages: { create } }),
}));

import { NEWS_MAX_OUTPUT_TOKENS, NEWS_SUMMARY_MAX_CHARS } from "@/config/news";
import { checkGuardrails, predictsAPrice } from "@/lib/guardrails";
import { SampleMarketData } from "@/lib/market/sample";
import {
  NEWS_SCHEMA,
  claudeSummarizer,
  newsLlmEnabled,
  newsModel,
  parseBatch,
  rulesSummary,
  summaryOk,
} from "./summarize";
import { worstCaseHundredths } from "./store";

// Spec step 293: summaries are facts from the headline, never a price forecast; Claude is used
// only with both the key and the news model; its answer is read on a recorded response.

const headline = (title: string, ticker: string | null = "NVDA") => ({
  id: "x",
  ticker,
  date: "2026-10-08",
  title,
  source: "Sample newswire",
  url: null,
});

// A recorded Messages API response for a batch of two headlines (the shape of a real
// claude-haiku-5-5 answer with structured output).
const RECORDED: Anthropic.Message = {
  id: "msg_01Recorded",
  type: "message",
  role: "assistant",
  model: "claude-haiku-5-5",
  content: [
    {
      type: "text",
      text: JSON.stringify({
        summaries: [
          {
            id: "h1",
            summary: "NVDA: Nvidia says demand for its newest chips is ahead of supply.",
          },
          { id: "h2", summary: "TSLA: Tesla is recalling vehicles over a software fault." },
          { id: "h9", summary: "Not asked about." },
        ],
      }),
      citations: null,
    },
  ],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: {
    input_tokens: 412,
    output_tokens: 96,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
} as unknown as Anthropic.Message;

describe("price predictions", () => {
  it("are caught in the forms a summary might use", () => {
    for (const text of [
      "NVDA: shares could rise after the earnings report.",
      "TSLA: the stock is likely to rebound next week.",
      "Markets: stocks may fall further as growth slows.",
      "AAPL: analysts set a price target of $250.",
      "MSFT: shares are heading higher.",
      "VTI: the market has further to fall.",
      "Markets: experts expect prices to recover by spring.",
      "NVDA: now is a good time to buy.",
    ]) {
      expect(predictsAPrice(text), text).toBe(true);
    }
  });

  it("let facts about what happened through", () => {
    for (const text of [
      "TSLA: Tesla recalls vehicles over a software fault, and shares slip.",
      "Markets: Stocks fall for a third day as investors weigh slower growth.",
      "NVDA: Nvidia shares jump after a better-than-expected earnings report.",
      "TSLA: Tesla delivers fewer cars than analysts expected.",
      "AAPL: Apple's supplier cuts its outlook for the next quarter.",
    ]) {
      expect(predictsAPrice(text), text).toBe(false);
    }
  });

  it("make a summary fail, even one the demo_advice guardrail alone would pass", () => {
    const text = "NVDA: shares could rise after the earnings report.";
    expect(checkGuardrails(text, [], undefined, "demo_advice").ok).toBe(true);
    expect(summaryOk(text, headline("Nvidia reports earnings"))).toBe(false);
  });
});

describe("the rules summary", () => {
  it("summarises every sample headline from its own words, and each one passes the checks", async () => {
    const news = await new SampleMarketData().news(
      ["VTI", "VXUS", "BND", "BIL", "AAPL", "MSFT", "NVDA", "TSLA"],
      "2018-01-01",
      "2028-12-31",
    );
    expect(news.length).toBeGreaterThan(5);
    for (const h of news) {
      const s = rulesSummary(h);
      expect(summaryOk(s, h), s).toBe(true);
      expect(s.startsWith(`${h.ticker ?? "Markets"}: `)).toBe(true);
    }
    expect(
      rulesSummary(headline("Tesla recalls vehicles over a software fault; shares slip", "TSLA")),
    ).toBe("TSLA: Tesla recalls vehicles over a software fault, and shares slip.");
  });

  it("never repeats a headline's forecast: it says only that there was news", () => {
    const s = rulesSummary(headline("Analysts say Nvidia shares could double next year"));
    expect(predictsAPrice(s)).toBe(false);
    expect(s).toBe("NVDA: a news item from Sample newswire on 2026-10-08; see the headline.");
  });

  it("keeps a long headline to one short line", () => {
    const s = rulesSummary(
      headline(`Nvidia ${"announces a very long list of things ".repeat(12)}`),
    );
    expect(s.length).toBeLessThanOrEqual(NEWS_SUMMARY_MAX_CHARS);
    expect(summaryOk(s, headline("x"))).toBe(true);
  });
});

describe("a summary's checks", () => {
  it("allow only the headline's own dollar figures and no promises", () => {
    const h = headline("Nvidia sells a $40 chip");
    expect(summaryOk("NVDA: Nvidia sells a $40 chip.", h)).toBe(true);
    expect(summaryOk("NVDA: Nvidia sells a $45 chip.", h)).toBe(false);
    expect(summaryOk("NVDA: a guaranteed winner.", h)).toBe(false);
    expect(summaryOk("", h)).toBe(false);
    expect(summaryOk("x".repeat(NEWS_SUMMARY_MAX_CHARS + 1), h)).toBe(false);
  });
});

describe("when Claude may be asked", () => {
  it("needs both the key and the news model", () => {
    expect(newsLlmEnabled({})).toBe(false);
    expect(newsLlmEnabled({ ANTHROPIC_API_KEY: "k" })).toBe(false);
    expect(newsLlmEnabled({ ANTHROPIC_MODEL_NEWS: "claude-haiku-5-5" })).toBe(false);
    expect(newsLlmEnabled({ ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL_NEWS: " " })).toBe(false);
    expect(
      newsLlmEnabled({ ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL_NEWS: "claude-haiku-5-5" }),
    ).toBe(true);
    expect(newsModel({ ANTHROPIC_MODEL_NEWS: "claude-haiku-5-5" })).toBe("claude-haiku-5-5");
  });

  it("assumes the worst for an unlisted model, so the cap never undercounts", () => {
    expect(worstCaseHundredths("some-new-model", 20)).toBeGreaterThan(
      worstCaseHundredths("claude-haiku-5-5", 20),
    );
  });
});

describe("Claude's answer, on a recorded response", () => {
  beforeEach(() => create.mockReset());

  it("is read for the ids asked about, with the tokens it used", () => {
    const { summaries, usage } = parseBatch(RECORDED, ["h1", "h2"]);
    expect([...summaries.keys()]).toEqual(["h1", "h2"]);
    expect(summaries.get("h2")).toBe("TSLA: Tesla is recalling vehicles over a software fault.");
    expect(usage).toEqual({ inputTokens: 412, outputTokens: 96 });
  });

  it("gives nothing when Claude stopped early, refused or wrote something unreadable", () => {
    expect(parseBatch({ ...RECORDED, stop_reason: "max_tokens" }, ["h1"]).summaries.size).toBe(0);
    expect(parseBatch({ ...RECORDED, stop_reason: "refusal" }, ["h1"]).summaries.size).toBe(0);
    const garbled = {
      ...RECORDED,
      content: [{ type: "text", text: "not json", citations: null }],
    } as Anthropic.Message;
    expect(parseBatch(garbled, ["h1"]).summaries.size).toBe(0);
  });

  it("is asked for in one call per batch, with the news model, a schema and a small cap", async () => {
    create.mockResolvedValueOnce(RECORDED);
    const batch = [
      headline("Nvidia says demand for its newest chips is running ahead of supply"),
      headline("Tesla recalls vehicles over a software fault; shares slip", "TSLA"),
    ];
    const result = await claudeSummarizer(batch, "claude-haiku-5-5");
    expect(create).toHaveBeenCalledTimes(1);
    const params = create.mock.calls[0][0];
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.max_tokens).toBe(NEWS_MAX_OUTPUT_TOKENS);
    expect(params.output_config.format).toEqual({ type: "json_schema", schema: NEWS_SCHEMA });
    expect(params.system).toMatch(/never predict/i);
    const sent = JSON.parse(params.messages[0].content);
    expect(sent.headlines.map((h: { id: string }) => h.id)).toEqual(["h1", "h2"]);
    expect(result.summaries.size).toBe(2);
  });
});
