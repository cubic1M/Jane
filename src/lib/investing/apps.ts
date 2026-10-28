// Investing apps and brokerages that show up in a person's transfers (read-only beta). Money sent
// to one is moved, not spent (src/categorize/rules.ts, TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_
// FUNDS). Jane asks what is in each today, since an upload shows the money going in and not what
// it grew to. Pure.

export type InvestingApp = { name: string; words: readonly string[] };

// The names are the ones people use; the words are what bank statements print.
export const INVESTING_APPS: readonly InvestingApp[] = [
  { name: "Robinhood", words: ["ROBINHOOD"] },
  { name: "Fidelity", words: ["FIDELITY", "FID BKG SVC"] },
  { name: "Vanguard", words: ["VANGUARD"] },
  { name: "Schwab", words: ["SCHWAB"] },
  { name: "Acorns", words: ["ACORNS"] },
  { name: "Stash", words: ["STASH INVEST", "STASH*"] },
  { name: "Betterment", words: ["BETTERMENT"] },
  { name: "Wealthfront", words: ["WEALTHFRONT"] },
  { name: "E*Trade", words: ["E*TRADE", "ETRADE"] },
  { name: "M1", words: ["M1 FINANCE"] },
  { name: "Public", words: ["PUBLIC.COM"] },
  { name: "TD Ameritrade", words: ["TD AMERITRADE", "TDAMERITRADE"] },
  { name: "Merrill Edge", words: ["MERRILL EDGE"] },
  { name: "Coinbase", words: ["COINBASE"] },
  { name: "Webull", words: ["WEBULL"] },
  { name: "SoFi Invest", words: ["SOFI INVEST"] },
];

export const isInvestingApp = (name: string) => INVESTING_APPS.some((a) => a.name === name);

// Which app a transaction's description names, or null.
export function appOf(description: string): string | null {
  const text = description.toUpperCase();
  return INVESTING_APPS.find((a) => a.words.some((w) => text.includes(w)))?.name ?? null;
}

export type Transfer = { date: string; amountCents: number; description: string };
export type AppSummary = {
  app: string;
  // Money sent in the window, in cents (positive).
  inCents: number;
  count: number;
  lastDate: string;
};

// Money sent to each app between `from` and `to` (YYYY-MM-DD), biggest first. A refund coming
// back (negative amount) isn't counted as money sent.
export function summarize(rows: readonly Transfer[], from: string, to: string): AppSummary[] {
  const by = new Map<string, AppSummary>();
  for (const r of rows) {
    if (r.date < from || r.date > to || r.amountCents <= 0) continue;
    const app = appOf(r.description);
    if (!app) continue;
    const s = by.get(app) ?? { app, inCents: 0, count: 0, lastDate: r.date };
    s.inCents += r.amountCents;
    s.count += 1;
    if (r.date > s.lastDate) s.lastDate = r.date;
    by.set(app, s);
  }
  return [...by.values()].sort((a, b) => b.inCents - a.inCents || a.app.localeCompare(b.app));
}

export const askQuestion = (app: string) => `What's in your ${app} account today?`;
