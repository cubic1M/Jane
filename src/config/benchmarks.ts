// Public average rates a refinance estimate is measured against when there's no lender's offer
// (connectors roadmap round 15, loans section 8). A checked-in snapshot with its date until the
// founders get a FRED API key and read FRED's terms; a reader that fetches them replaces the
// values, never the shape. A benchmark older than its limit gives no estimate at all: a stale
// rate can mislead.

export type BenchmarkSeries = "MORTGAGE30US" | "MORTGAGE15US" | "RIFLPBCIANM60NM" | "TERMCBPER24NS";

export type Benchmark = {
  series: BenchmarkSeries;
  // What it is, in the words a card shows.
  name: string;
  rateBps: number;
  // The observation's date (YYYY-MM-DD): the week's Thursday, or the month's first day.
  asOf: string;
  frequency: "weekly" | "monthly";
  source: string;
};

// Weekly data goes stale in two weeks; monthly data comes out about two months late, so it has
// four.
export const BENCHMARK_MAX_AGE_DAYS = { weekly: 14, monthly: 120 } as const;

// Null: not looked up yet, so nothing is estimated against it (the 15-year rate wasn't in round
// 15's research; a mortgage with 15 years or less left gets no estimate until it is).
export const BENCHMARK_SNAPSHOT: Readonly<Record<BenchmarkSeries, Benchmark | null>> = {
  MORTGAGE30US: {
    series: "MORTGAGE30US",
    name: "Freddie Mac's 30-year fixed mortgage average",
    rateBps: 718,
    asOf: "2026-11-05",
    frequency: "weekly",
    source: "https://fred.stlouisfed.org/series/MORTGAGE30US",
  },
  MORTGAGE15US: null,
  RIFLPBCIANM60NM: {
    series: "RIFLPBCIANM60NM",
    name: "the Federal Reserve's average bank rate on 60-month new-car loans",
    rateBps: 754,
    asOf: "2026-08-01",
    frequency: "monthly",
    source: "https://fred.stlouisfed.org/series/RIFLPBCIANM60NM",
  },
  TERMCBPER24NS: {
    series: "TERMCBPER24NS",
    name: "the Federal Reserve's average bank rate on 24-month personal loans",
    rateBps: 1190,
    asOf: "2026-08-01",
    frequency: "monthly",
    source: "https://fred.stlouisfed.org/series/TERMCBPER24NS",
  },
};
