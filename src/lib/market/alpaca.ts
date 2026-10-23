import type { Bar, Headline, MarketData } from "./types";
import { MarketDataError, MarketDataNotConfigured, type Filing } from "./types";

// Alpaca market data and news (spec step 289). A stub for Stage B: the request URLs and the
// parsing of its responses are written and tested against recorded responses, and nothing calls
// out unless ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY are set. Jane never creates an Alpaca account:
// the founder does, and the keys go in the environment, never in code.

export const ALPACA_DATA_URL = "https://data.alpaca.markets";

type AlpacaBars = {
  bars?: Record<string, { t: string; c: number }[]> | null;
  next_page_token?: string | null;
};
type AlpacaNews = {
  news?: {
    id: number;
    headline: string;
    created_at: string;
    source?: string;
    url?: string | null;
    symbols?: string[];
  }[];
};

// The feed: the free IEX feed unless ALPACA_DATA_FEED says otherwise (spec step 289).
export const DEFAULT_FEED = "iex";

export const barsUrl = (
  tickers: readonly string[],
  from: string,
  to: string,
  feed = DEFAULT_FEED,
  pageToken?: string | null,
) =>
  `${ALPACA_DATA_URL}/v2/stocks/bars?symbols=${encodeURIComponent(tickers.join(","))}&timeframe=1Day&start=${from}&end=${to}&adjustment=all&feed=${feed}&limit=10000${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`;
export const newsUrl = (tickers: readonly string[], from: string, to: string) =>
  `${ALPACA_DATA_URL}/v1beta1/news?symbols=${encodeURIComponent(tickers.join(","))}&start=${from}&end=${to}&limit=50`;

export function parseBars(json: AlpacaBars, ticker: string): Bar[] {
  return (json.bars?.[ticker] ?? []).map((b) => ({
    date: b.t.slice(0, 10),
    closeCents: Math.round(b.c * 100),
  }));
}

export const nextPage = (json: AlpacaBars): string | null => json.next_page_token ?? null;

export function parseNews(json: AlpacaNews): Headline[] {
  return (json.news ?? []).map((n) => ({
    id: `alpaca-${n.id}`,
    ticker: n.symbols?.[0] ?? null,
    date: n.created_at.slice(0, 10),
    title: n.headline,
    source: n.source ?? "Alpaca",
    url: n.url ?? null,
  }));
}

type Fetcher = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ ok?: boolean; status?: number; json(): Promise<unknown> }>;

// The body of an answer, or an error with Alpaca's reason when it refused (a 403 for a feed the
// plan doesn't cover, a 401 for a bad key): never read as an empty answer.
async function bodyOf(res: Awaited<ReturnType<Fetcher>>): Promise<unknown> {
  const json = await res.json().catch(() => null);
  if (res.ok === false) {
    const reason =
      json && typeof json === "object" && "message" in json ? String(json.message) : "";
    throw new MarketDataError(
      `Alpaca answered ${res.status ?? "an error"}${reason ? `: ${reason}` : ""}.`,
    );
  }
  return json;
}

export class AlpacaMarketData implements MarketData {
  readonly name = "alpaca";
  readonly simulated = false;
  constructor(
    private readonly keys: { id: string; secret: string } | null,
    private readonly fetcher: Fetcher = fetch as unknown as Fetcher,
    private readonly filingsFrom?: MarketData,
    private readonly feed: string = DEFAULT_FEED,
  ) {}

  private headers() {
    if (!this.keys) throw new MarketDataNotConfigured("Alpaca keys are not set.");
    return { "APCA-API-KEY-ID": this.keys.id, "APCA-API-SECRET-KEY": this.keys.secret };
  }

  // History comes in pages of up to 10,000 bars; follow the page tokens (a hard stop at 50
  // pages so a bad response can't loop).
  async prices(ticker: string, from: string, to: string): Promise<Bar[]> {
    const out: Bar[] = [];
    let token: string | null = null;
    for (let page = 0; page < 50; page += 1) {
      const res = await this.fetcher(barsUrl([ticker], from, to, this.feed, token), {
        headers: this.headers(),
      });
      const json = (await bodyOf(res)) as AlpacaBars;
      out.push(...parseBars(json, ticker));
      token = nextPage(json);
      if (!token) break;
    }
    return out;
  }

  async latest(ticker: string, on: string): Promise<Bar | null> {
    const start = new Date(Date.parse(`${on}T00:00:00Z`) - 10 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const bars = await this.prices(ticker, start, on);
    return bars[bars.length - 1] ?? null;
  }

  async news(tickers: readonly string[], from: string, to: string): Promise<Headline[]> {
    const res = await this.fetcher(newsUrl(tickers, from, to), { headers: this.headers() });
    return parseNews((await bodyOf(res)) as AlpacaNews);
  }

  async filings(ticker: string, from: string, to: string): Promise<Filing[]> {
    return this.filingsFrom ? this.filingsFrom.filings(ticker, from, to) : [];
  }
}
