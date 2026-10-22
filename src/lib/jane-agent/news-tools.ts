import type Anthropic from "@anthropic-ai/sdk";
import { DEMO_ADVICE_LABEL } from "@/config/advice";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import type { ToolOutput } from "@/lib/ask/tools";
import { dollarFigures } from "@/lib/guardrails";
import type { MarketData } from "@/lib/market";
import { loadNews } from "@/lib/news/read";

// Claude's tool for market news in Jane's chat (spec step 293, Phase AW): the stored headline
// summaries and filings for the practice portfolio's watchlist. It reads what the daily job
// stored and never calls Claude or a live feed itself. Every dollar figure in it is recorded for
// the guardrails. Practice investing is demo advice only, so outside demo advice mode it says so
// and returns no news.

export const NEWS_TOOLS: Anthropic.Tool[] = [
  {
    name: "market_news",
    description:
      "Recent news for the practice (paper money) portfolio's watchlist: its index ETFs and a few large companies. Each headline comes with a one-sentence summary that has already been checked, its date and source; plus recent SEC filings (8-K current reports, 10-Q quarterly reports) as facts with a link. Sample data in this version: say so. Say what happened only: never predict where a price is going, and never suggest buying or selling because of a headline. Optionally filter to one ticker.",
    input_schema: {
      type: "object" as const,
      properties: {
        ticker: { type: "string", description: "A ticker to filter to, like NVDA or VTI." },
      },
      additionalProperties: false,
    },
  },
];

export const isNewsTool = (name: string) => NEWS_TOOLS.some((t) => t.name === name);

export const NEWS_NOT_IN_ADVICE =
  "Market news is part of the practice portfolio, which runs on sample data for demo accounts only. This person's accounts are real, so there is no news to show.";

type Options = { client: PrismaClient; now: Date; market?: MarketData };

export async function runNewsTool(
  userId: string,
  name: string,
  input: unknown,
  { client, now, market }: Options,
): Promise<ToolOutput> {
  if (name !== "market_news")
    return { content: JSON.stringify({ error: "unknown tool" }), cents: [] };
  if (!(await adviceMode(userId, { client }))) {
    return { content: JSON.stringify({ note: NEWS_NOT_IN_ADVICE }), cents: [] };
  }
  const raw = (input ?? {}) as { ticker?: unknown };
  const ticker = typeof raw.ticker === "string" ? raw.ticker.trim().toUpperCase() : "";
  const news = await loadNews({ client, now, ...(market ? { market } : {}) });
  const headlines = ticker
    ? news.headlines.filter((h) => h.ticker === ticker || h.ticker === null)
    : news.headlines;
  const filings = ticker ? news.filings.filter((f) => f.ticker === ticker) : news.filings;
  const cents = headlines.flatMap((h) =>
    [...dollarFigures(h.title), ...dollarFigures(h.summary)].map((f) => f.cents),
  );
  return {
    content: JSON.stringify({
      label: DEMO_ADVICE_LABEL,
      sample: news.simulated,
      note: news.simulated
        ? "Sample headlines and filings for the practice portfolio, not real news."
        : undefined,
      headlines: headlines.map((h) => ({
        ticker: h.ticker ?? "market",
        date: h.date,
        summary: h.summary,
        headline: h.title,
        source: h.source,
        link: h.url,
      })),
      filings: filings.map((f) => ({
        ticker: f.ticker,
        date: f.date,
        form: f.form,
        what: f.title,
        link: f.url,
      })),
      none:
        headlines.length === 0 && filings.length === 0 ? "No news in the last week." : undefined,
    }),
    cents,
  };
}
