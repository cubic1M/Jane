import { ALPACA_DATA_URL, DEFAULT_FEED } from "./alpaca";
import { MarketDataError, MarketDataNotConfigured, type IntradayBar } from "./types";

// Alpaca's intraday bars (Phase AW, Stage A), for the Very high day-trading research
// (src/lib/investments/strategy-research.cli.test.ts): split- and dividend-adjusted bars of a
// timeframe ("5Min"), paged. Called only with the keys from the environment, and only from the
// research run; nothing in the app trades on them yet. Keys are never logged.

type AlpacaIntraday = {
  bars?: Record<
    string,
    { t: string; o: number; h: number; l: number; c: number; v: number }[]
  > | null;
  next_page_token?: string | null;
};
type Fetcher = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ ok?: boolean; status?: number; json(): Promise<unknown> }>;

export const intradayUrl = (
  ticker: string,
  from: string,
  to: string,
  timeframe = "5Min",
  feed = DEFAULT_FEED,
  pageToken?: string | null,
) =>
  `${ALPACA_DATA_URL}/v2/stocks/bars?symbols=${encodeURIComponent(ticker)}&timeframe=${timeframe}&start=${from}&end=${to}&adjustment=all&feed=${feed}&limit=10000${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`;

export function parseIntraday(json: AlpacaIntraday, ticker: string): IntradayBar[] {
  return (json.bars?.[ticker] ?? []).map((b) => ({
    t: b.t,
    o: Math.round(b.o * 100),
    h: Math.round(b.h * 100),
    l: Math.round(b.l * 100),
    c: Math.round(b.c * 100),
    v: b.v,
  }));
}

export async function fetchIntraday(
  keys: { id: string; secret: string } | null,
  ticker: string,
  from: string,
  to: string,
  { timeframe = "5Min", feed = DEFAULT_FEED, fetcher = fetch as unknown as Fetcher } = {},
): Promise<IntradayBar[]> {
  if (!keys) throw new MarketDataNotConfigured("Alpaca keys are not set.");
  const headers = { "APCA-API-KEY-ID": keys.id, "APCA-API-SECRET-KEY": keys.secret };
  const out: IntradayBar[] = [];
  let token: string | null = null;
  // At most 400 pages of 10,000 bars: years of 5-minute bars, and a stop for a bad response.
  for (let page = 0; page < 400; page += 1) {
    const res = await fetcher(intradayUrl(ticker, from, to, timeframe, feed, token), { headers });
    const json = (await res.json().catch(() => null)) as AlpacaIntraday | null;
    if (res.ok === false || !json) {
      const reason =
        json && typeof json === "object" && "message" in json
          ? String((json as { message: unknown }).message)
          : "";
      throw new MarketDataError(
        `Alpaca answered ${res.status ?? "an error"}${reason ? `: ${reason}` : ""}.`,
      );
    }
    out.push(...parseIntraday(json, ticker));
    token = json.next_page_token ?? null;
    if (!token) break;
  }
  return out;
}
