import type { Bar, Filing, Headline, MarketData } from "./types";
import { MarketDataNotConfigured } from "./types";

// SEC EDGAR filings (spec step 289). No key is needed, but the SEC asks every caller for a
// descriptive User-Agent with a contact (EDGAR_USER_AGENT), and Jane makes no call without it.
// A stub for Stage B: the URL and the parsing of a submissions response are tested against a
// recorded response.

export const EDGAR_DATA_URL = "https://data.sec.gov";
export const submissionsUrl = (cik: string) =>
  `${EDGAR_DATA_URL}/submissions/CIK${cik.padStart(10, "0")}.json`;

type Submissions = {
  filings?: {
    recent?: {
      accessionNumber: string[];
      filingDate: string[];
      form: string[];
      primaryDocument: string[];
      primaryDocDescription?: string[];
    };
  };
};

const FORMS = new Set(["8-K", "10-Q", "10-K"]);

export function parseSubmissions(json: Submissions, ticker: string, cik: string): Filing[] {
  const r = json.filings?.recent;
  if (!r) return [];
  return r.accessionNumber.flatMap((accession, i): Filing[] => {
    const form = r.form[i];
    if (!FORMS.has(form)) return [];
    return [
      {
        id: `edgar-${accession}`,
        ticker,
        date: r.filingDate[i],
        form: form as Filing["form"],
        title: r.primaryDocDescription?.[i] || form,
        url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll("-", "")}/${r.primaryDocument[i]}`,
      },
    ];
  });
}

type Fetcher = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ json(): Promise<unknown> }>;

export class EdgarMarketData implements MarketData {
  readonly name = "edgar";
  readonly simulated = false;
  constructor(
    private readonly userAgent: string | null,
    private readonly ciks: Readonly<Record<string, string>>,
    private readonly fetcher: Fetcher = fetch as unknown as Fetcher,
  ) {}

  async prices(): Promise<Bar[]> {
    return [];
  }
  async latest(): Promise<Bar | null> {
    return null;
  }
  async news(): Promise<Headline[]> {
    return [];
  }

  async filings(ticker: string, from: string, to: string): Promise<Filing[]> {
    if (!this.userAgent) throw new MarketDataNotConfigured("EDGAR_USER_AGENT is not set.");
    const cik = this.ciks[ticker.toUpperCase()];
    if (!cik) return [];
    const res = await this.fetcher(submissionsUrl(cik), {
      headers: { "User-Agent": this.userAgent },
    });
    return parseSubmissions((await res.json()) as Submissions, ticker.toUpperCase(), cik).filter(
      (f) => f.date >= from && f.date <= to,
    );
  }
}
