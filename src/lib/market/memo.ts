import type { Bar, Filing, Headline, MarketData } from "./types";

// Market data for a replay over a window of days (Phase AW, Stage A): each ticker's closes, the
// news and the filings are asked of the real feed once for the whole window and then served
// from memory, so replaying a few weeks of practice days costs a handful of requests instead of
// several a day. Anything outside the window goes to the feed as usual.

export class MemoMarketData implements MarketData {
  readonly name: string;
  readonly simulated: boolean;
  private readonly bars = new Map<string, Promise<Bar[]>>();
  private readonly filingsOf = new Map<string, Promise<Filing[]>>();
  private headlines: { key: string; all: Promise<Headline[]> } | null = null;

  constructor(
    private readonly feed: MarketData,
    private readonly from: string,
    private readonly to: string,
  ) {
    this.name = feed.name;
    this.simulated = feed.simulated;
  }

  private window(ticker: string): Promise<Bar[]> {
    let bars = this.bars.get(ticker);
    if (!bars) {
      bars = this.feed.prices(ticker, this.from, this.to);
      this.bars.set(ticker, bars);
    }
    return bars;
  }

  private inside(from: string, to: string) {
    return from >= this.from && to <= this.to;
  }

  async prices(ticker: string, from: string, to: string): Promise<Bar[]> {
    if (!this.inside(from, to)) return this.feed.prices(ticker, from, to);
    return (await this.window(ticker)).filter((b) => b.date >= from && b.date <= to);
  }

  async latest(ticker: string, on: string): Promise<Bar | null> {
    if (on < this.from || on > this.to) return this.feed.latest(ticker, on);
    const bars = await this.window(ticker);
    for (let i = bars.length - 1; i >= 0; i--) if (bars[i].date <= on) return bars[i];
    return this.feed.latest(ticker, on);
  }

  async news(tickers: readonly string[], from: string, to: string): Promise<Headline[]> {
    if (!this.inside(from, to)) return this.feed.news(tickers, from, to);
    const key = [...tickers].sort().join(",");
    if (this.headlines?.key !== key)
      this.headlines = { key, all: this.feed.news(tickers, this.from, this.to) };
    return (await this.headlines.all).filter((h) => h.date >= from && h.date <= to);
  }

  async filings(ticker: string, from: string, to: string): Promise<Filing[]> {
    if (!this.inside(from, to)) return this.feed.filings(ticker, from, to);
    let all = this.filingsOf.get(ticker);
    if (!all) {
      all = this.feed.filings(ticker, this.from, this.to);
      this.filingsOf.set(ticker, all);
    }
    return (await all).filter((f) => f.date >= from && f.date <= to);
  }
}
