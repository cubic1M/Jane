// News, summarised cheaply (spec step 293, Phase AW, Stage A). The watchlist's headlines are
// summarised by a small Claude model (ANTHROPIC_MODEL_NEWS, e.g. claude-haiku-5-5) in a few
// batched calls a day, behind a monthly cap. Off unless ANTHROPIC_API_KEY and
// ANTHROPIC_MODEL_NEWS are both set: otherwise (and in every test) each headline gets a rules
// summary from its own text. Filings are shown as facts with a link, never summarised.

// The most Claude may cost for news in a calendar month (UTC), in cents. NEWS_MONTHLY_CAP_CENTS
// may set a different positive number.
export const NEWS_MONTHLY_CAP_CENTS_DEFAULT = 100;

// Claude calls a day (UTC) for news, at most. Each call summarises one batch.
export const NEWS_CALLS_PER_DAY = 3;
// Headlines per call.
export const NEWS_BATCH_SIZE = 20;
// The longest answer a call may write, in tokens. Also what the cap check assumes a call writes,
// so a call is only made when even the longest answer fits under the cap.
export const NEWS_MAX_OUTPUT_TOKENS = 3_000;
// What the cap check assumes a call reads, per headline and for the instructions, in tokens
// (generous: a headline is about 20 tokens).
export const NEWS_INPUT_TOKENS_PER_HEADLINE = 80;
export const NEWS_INPUT_TOKENS_FIXED = 600;

// How far back the job looks for headlines and filings, in days.
export const NEWS_LOOKBACK_DAYS = 7;
export const FILINGS_LOOKBACK_DAYS = 90;
// The filings shown: current reports and quarterly reports.
export const NEWS_FILING_FORMS = ["8-K", "10-Q"] as const;

// A summary is one short sentence.
export const NEWS_SUMMARY_MAX_CHARS = 200;
// Items the chat tool returns, newest first.
export const NEWS_TOOL_MAX_HEADLINES = 12;
export const NEWS_TOOL_MAX_FILINGS = 8;
