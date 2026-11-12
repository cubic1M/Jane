import { createHash } from "node:crypto";

// The offers catalog's readers, one per source (src/config/offers.ts): each turns what a source
// sent into figures, in basis points (rates) or cents a month (prices), keyed by offer. Pure. A
// figure a reader can't find is left out, never guessed: the catalog then tries Claude, or lets
// the old reading run out.

export type Readings = Record<string, number>;

// A page's words, without its markup, scripts or styles.
export function pageText(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// What a page says, for "has it changed?": its words, so a new tracking id doesn't count.
export const fingerprintOf = (html: string): string =>
  createHash("sha256").update(pageText(html)).digest("hex").slice(0, 32);

const percentToBps = (value: string): number => Math.round(Number(value) * 100);
const dollarsToCents = (value: string): number => Math.round(Number(value) * 100);

// Treasury's bill auctions (fiscaldata.treasury.gov): the latest held auction of each term. One
// announced but not yet held has "null" for its rate and is passed over.
export function readTreasuryBills(body: unknown): Readings {
  const rows = (body as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return {};
  const terms: Readonly<Record<string, string>> = {
    "4-Week": "tbill.4w",
    "13-Week": "tbill.13w",
    "26-Week": "tbill.26w",
    "52-Week": "tbill.52w",
  };
  const out: Readings = {};
  const sorted = [...rows].sort((a, b) =>
    String((b as { auction_date?: unknown }).auction_date).localeCompare(
      String((a as { auction_date?: unknown }).auction_date),
    ),
  );
  for (const row of sorted) {
    const r = row as { security_term?: unknown; high_investment_rate?: unknown };
    const key = terms[String(r.security_term)];
    const rate = String(r.high_investment_rate);
    if (!key || key in out || !/^\d+(\.\d+)?$/.test(rate)) continue;
    out[key] = percentToBps(rate);
  }
  return out;
}

// The FDIC's national rates page: the national deposit rate of each product, the first number
// after its name in the table.
export function readFdicNational(html: string): Readings {
  const text = pageText(html);
  const table = text.slice(Math.max(0, text.search(/Monthly Rate Cap Information/i)));
  const rows: Readonly<Record<string, RegExp>> = {
    "fdic.savings": /\bSavings (\d{1,2}\.\d{2})\b/,
    "fdic.checking": /\bInterest Checking (\d{1,2}\.\d{2})\b/,
    "fdic.money_market": /\bMoney Market (\d{1,2}\.\d{2})\b/,
    "fdic.cd_12m": /\b12 month CD (\d{1,2}\.\d{2})\b/,
  };
  const out: Readings = {};
  for (const [key, pattern] of Object.entries(rows)) {
    const value = pattern.exec(table)?.[1];
    if (value) out[key] = percentToBps(value);
  }
  return out;
}

// One FRED series' observations (api.stlouisfed.org): the newest that has a value ("." is none).
export function readFredSeries(body: unknown): number | null {
  const rows = (body as { observations?: unknown })?.observations;
  if (!Array.isArray(rows)) return null;
  for (const row of [...rows].reverse()) {
    const value = String((row as { value?: unknown }).value);
    if (/^\d+(\.\d+)?$/.test(value)) return percentToBps(value);
  }
  return null;
}

// A bank's own savings page: its APY, the highest "x.xx% APY" it states (a tiered account's lower
// tiers and the national average it compares itself to are lower). Each page is checked against
// its plausible range by the catalog.
export function readSavingsApy(html: string, key: string): Readings {
  const rates = [
    ...pageText(html).matchAll(/(\d{1,2}\.\d{2}) ?% ?(?:APY|Annual Percentage Yield)/gi),
  ]
    .map((m) => percentToBps(m[1] as string))
    .filter((bps) => bps > 0);
  return rates.length > 0 ? { [key]: Math.max(...rates) } : {};
}

// A streaming service's plans page: the monthly price after "Individual" and after "Student",
// skipping a free first month ("$0 for 1 month, then $12.99").
export function readPlanPrices(html: string, merchantKey: string): Readings {
  // What the page shows wins; what it carries for a script to draw fills in what it doesn't show.
  return {
    ...planPricesIn(embeddedText(html), merchantKey),
    ...planPricesIn(pageText(html), merchantKey),
  };
}

function planPricesIn(text: string, merchantKey: string): Readings {
  const out: Readings = {};
  for (const [plan, word] of [
    ["individual", "Individual"],
    ["student", "Student"],
  ] as const) {
    for (const at of text.matchAll(new RegExp(`\\b${word}\\b`, "g"))) {
      const after = text.slice((at.index ?? 0) + word.length, (at.index ?? 0) + word.length + 160);
      const price = [...after.matchAll(/\$(\d{1,3}\.\d{2}) ?(?:\/ ?|per )month/g)]
        .map((m) => dollarsToCents(m[1] as string))
        .find((cents) => cents > 0);
      if (price) {
        out[`plan.${merchantKey}.${plan}`] = price;
        break;
      }
    }
  }
  return out;
}

// The words a page carries in its own JSON for a script to draw, in order: each "content" string.
// YouTube's plans and prices are only there. Zero-width joiners between "$8.99" and "/month" go.
function embeddedText(html: string): string {
  const parts: string[] = [];
  for (const m of html.matchAll(/"content":"((?:[^"\\]|\\.){1,300})"/g)) {
    try {
      parts.push(JSON.parse(`"${m[1]}"`) as string);
    } catch {
      // Not a JSON string after all: left out.
    }
  }
  return parts
    .join(" ")
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
