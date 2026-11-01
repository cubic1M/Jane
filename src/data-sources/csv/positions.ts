import { parseCsv, type CsvRecord } from "./parse-csv";
import { normalizeHeader } from "./formats";

// Positions (holdings) downloads from brokerages: what each account holds today, not its
// transactions. Pure: a file's text in, its accounts and positions out. The layouts are the
// brokers' published columns:
// - Fidelity: Positions > Download ("Portfolio_Positions_Oct-28-2026.csv"), every account in
//   one file, with a disclaimer and "Date downloaded" under the rows.
// - Schwab: Positions > Export ("Individual-Positions-2026-10-28-102345.csv"), a title line
//   ("Positions for account Individual ...123 as of …"), or one block per account in the
//   all-accounts export, each ending in an "Account Total" row.
// - Vanguard: Download center > "Most recent 18 months" as CSV ("ofxdownload.csv"), the
//   holdings first and then the transactions, under their own header.
// - Robinhood has no holdings download, so its account activity report (Reports and statements
//   > Reports) is read instead: shares are counted from the trades and the cash from every
//   row's amount, which is only right when the report starts when the account opened.

export type PositionsLayoutId = "fidelity" | "schwab" | "vanguard" | "robinhood";

export const POSITIONS_LAYOUTS: Readonly<Record<PositionsLayoutId, string>> = {
  fidelity: "Fidelity positions",
  schwab: "Schwab positions",
  vanguard: "Vanguard holdings",
  robinhood: "Robinhood account activity",
};

export type ParsedPosition = {
  ticker: string | null;
  name: string;
  quantity: number;
  priceCents: number;
  valueCents: number;
  costBasisCents: number | null;
  // Cash or a money market fund the account keeps its cash in (Fidelity's core position,
  // Schwab's "Cash & Cash Investments", Vanguard's settlement fund).
  isCash: boolean;
  // Plaid's security types where the file says: "mutual fund", "etf", "equity", "cash".
  type: string | null;
};

export type ParsedPositionsAccount = {
  // What the file calls the account, stable from one download to the next.
  ref: string;
  // "Fidelity ROTH IRA …5678".
  name: string;
  mask: string | null;
  // Plaid's investment subtype, guessed from the account's name ("brokerage" otherwise).
  subtype: string;
  positions: ParsedPosition[];
  valueCents: number;
  cashCents: number;
};

export type PositionsFile = {
  layout: PositionsLayoutId;
  // The day the positions are from, when the file says (else the caller's today).
  asOf: string | null;
  accounts: ParsedPositionsAccount[];
  // Rows read but left out (pending activity, options), counted for the preview.
  skipped: number;
  // Anything the person should know about how it was read.
  notes: string[];
};

// How far down a file its header row can be (Schwab's title and an account line come first).
const HEADER_SEARCH_ROWS = 10;

const BROKERS: Record<PositionsLayoutId, string> = {
  fidelity: "Fidelity",
  schwab: "Schwab",
  vanguard: "Vanguard",
  robinhood: "Robinhood",
};

// Each layout's tell-tale headers (normalized), all of which must be present.
const SIGNATURES: readonly { id: PositionsLayoutId; headers: readonly string[] }[] = [
  {
    id: "fidelity",
    headers: [
      "account number",
      "account name",
      "symbol",
      "description",
      "quantity",
      "current value",
    ],
  },
  {
    id: "vanguard",
    headers: ["account number", "investment name", "symbol", "shares", "total value"],
  },
  {
    id: "robinhood",
    headers: ["activity date", "instrument", "trans code", "quantity", "price", "amount"],
  },
  { id: "schwab", headers: ["symbol", "description", "price"] },
];

// Schwab's headers carry the long name in brackets: "Qty (Quantity)", "Mkt Val (Market Value)".
const header = (h: string) => normalizeHeader(h.replace(/\s*\([^)]*\)\s*$/, ""));
const headerWords = (h: string) => [normalizeHeader(h), header(h)];

function findColumn(headers: string[], names: readonly string[]): number | null {
  const i = headers.findIndex((h) => headerWords(h).some((w) => names.includes(w)));
  return i === -1 ? null : i;
}

function signatureOf(fields: string[]): PositionsLayoutId | null {
  const present = new Set(fields.flatMap(headerWords));
  const match = SIGNATURES.find((s) => s.headers.every((h) => present.has(h)));
  if (match?.id !== "schwab") return match?.id ?? null;
  // Schwab's own columns, so a bank statement with "Description" and "Price" isn't one.
  const qty = ["qty", "quantity"].some((h) => present.has(h));
  const value = ["mkt val", "market value"].some((h) => present.has(h));
  return qty && value ? "schwab" : null;
}

// Which positions layout a file is, from its header row near the top. Null for anything else
// (a bank statement, an unknown broker).
export function detectPositionsLayout(text: string): PositionsLayoutId | null {
  return findHeader(parseCsv(text))?.layout ?? null;
}

function findHeader(records: CsvRecord[]) {
  for (const [index, record] of records.slice(0, HEADER_SEARCH_ROWS).entries()) {
    const layout = signatureOf(record.fields);
    if (layout) return { layout, index };
  }
  return null;
}

// "$1,234.56", "+$1.00", "-12.5", "(3.00)", "1,234.567 S": a number, or null for "--", "n/a"
// and blanks.
export function parseNumber(text: string | undefined): number | null {
  if (text === undefined) return null;
  let t = text.trim().replace(/\s*[A-Z]$/, "");
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/[$,%\s]/g, "");
  if (t.startsWith("+")) t = t.slice(1);
  if (t.startsWith("-")) {
    negative = !negative;
    t = t.slice(1);
  }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return negative ? -n : n;
}

const cents = (text: string | undefined) => {
  const n = parseNumber(text);
  return n === null ? null : Math.round(n * 100);
};

// What a holding is when the file doesn't say (Fidelity, Vanguard, Robinhood), in Plaid's
// words: a mutual fund by its ticker (five letters ending in X), an ETF by its name, a company's
// stock by its name's ending ("APPLE INC", "MICROSOFT CORP", "... INC CL B"). Null when the words
// don't tell, so the fund-cost note still says it doesn't know (debugger 11-01: a Fidelity file's
// Apple was "a fund whose yearly cost Jane doesn't know" and counted as "other").
const FUND_WORDS = /\b(?:FUNDS?|FDS|INDEX|TRUST|PORTFOLIO|ISHARES|SPDR)\b/i;

export function typeFromName(ticker: string | null, name: string): string | null {
  const n = name.toUpperCase();
  if (ticker && /^[A-Z]{4}X$/.test(ticker)) return "mutual fund";
  if (/\b(?:ETF|ETN)\b/.test(n)) return "etf";
  if (FUND_WORDS.test(n)) return null;
  if (
    /\b(?:INC|CORP|CORPORATION|CO|COMPANY|LTD|PLC|HOLDINGS|GROUP|N\.?V|AG|SA|SE)\.?(?:\s+(?:CL|CLASS)\s+[A-C]|\s+COM)?\s*$/.test(
      n,
    )
  )
    return "equity";
  return null;
}

// Plaid's investment subtypes from an account's name ("ROTH IRA", "Health Savings Account").
export function subtypeFromName(name: string): string {
  const n = name.toLowerCase();
  if (/\broth\b.*\b401\s*\(?k\)?/.test(n)) return "roth 401k";
  if (/\b401\s*\(?k\)?/.test(n)) return "401k";
  if (/\b403\s*\(?b\)?/.test(n)) return "403b";
  if (/\b457\s*\(?b\)?/.test(n)) return "457b";
  if (/\bsep\b/.test(n)) return "sep ira";
  if (/\bsimple\b/.test(n)) return "simple ira";
  if (/\broth\b/.test(n)) return "roth";
  if (/\bira\b|rollover|traditional/.test(n)) return "ira";
  if (/\bhsa\b|health savings/.test(n)) return "hsa";
  if (/\b529\b/.test(n)) return "529";
  if (/custodial|utma|ugma/.test(n)) return "custodial";
  return "brokerage";
}

const lastFour = (number: string) => {
  const chars = number.replace(/[^0-9a-z]/gi, "");
  return chars.length >= 2 ? chars.slice(-4) : null;
};

const titleCase = (s: string) =>
  s.length > 3 && s === s.toUpperCase()
    ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
    : s;

function accountOf(
  layout: PositionsLayoutId,
  ref: string,
  label: string,
  mask: string | null,
): ParsedPositionsAccount {
  const words = label.trim() || "Account";
  return {
    ref,
    name: `${BROKERS[layout]} ${words}${mask ? ` …${mask}` : ""}`,
    mask,
    subtype: subtypeFromName(label),
    positions: [],
    valueCents: 0,
    cashCents: 0,
  };
}

function add(account: ParsedPositionsAccount, position: ParsedPosition) {
  account.positions.push(position);
  account.valueCents += position.valueCents;
  if (position.isCash) account.cashCents += position.valueCents;
}

// Money market funds and sweeps that hold an account's cash.
const CASH_TICKERS = new Set([
  "SPAXX",
  "FDRXX",
  "FZFXX",
  "SPRXX",
  "FCASH",
  "CORE",
  "VMFXX",
  "VMRXX",
  "VUSXX",
  "VMSXX",
  "SWVXX",
  "SNVXX",
  "SNSXX",
]);
const CASH_WORDS = /money market|cash|sweep|settlement fund|fdic-insured deposit/i;

const isCashPosition = (ticker: string | null, name: string) =>
  (ticker !== null && CASH_TICKERS.has(ticker)) || CASH_WORDS.test(name);

// Cash that isn't a fund: Fidelity's FCASH and CORE stand-ins and a bank deposit sweep. Kept with
// no ticker, like Schwab's "Cash & Cash Investments", so the investing checks can tell it from a
// money market fund (which pays a fund's rate).
const PLAIN_CASH_TICKERS = new Set(["FCASH", "CORE"]);
const isPlainCash = (ticker: string | null, name: string) =>
  (ticker !== null && PLAIN_CASH_TICKERS.has(ticker)) || /deposit sweep|fdic/i.test(name);

// Fidelity marks its core (cash) position with "**" after the symbol: "SPAXX**".
const cleanTicker = (symbol: string | undefined) => {
  const t = (symbol ?? "").trim().replace(/\*+$/, "").toUpperCase();
  return /^[A-Z0-9.\-/]{1,12}$/.test(t) ? t : null;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// "Oct-28-2026", "2026/10/28", "10/28/2026" as an ISO day.
export function parseFileDate(text: string): string | null {
  const named = /\b([A-Za-z]{3})[a-z]*[-\s](\d{1,2}),?[-\s](\d{4})\b/.exec(text);
  if (named) {
    const m = MONTHS.indexOf(named[1].toLowerCase());
    if (m !== -1) return iso(Number(named[3]), m + 1, Number(named[2]));
  }
  const ymd = /\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/.exec(text);
  if (ymd) return iso(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  const mdy = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(text);
  if (mdy) return iso(Number(mdy[3]), Number(mdy[1]), Number(mdy[2]));
  return null;
}

function iso(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

type Reader = (records: CsvRecord[], headerIndex: number) => Omit<PositionsFile, "layout">;

const readFidelity: Reader = (records, at) => {
  const h = records[at].fields;
  const col = (...names: string[]) => findColumn(h, names);
  const number = col("account number")!;
  const label = col("account name")!;
  const symbol = col("symbol")!;
  const description = col("description")!;
  const quantity = col("quantity")!;
  const price = col("last price", "price");
  const value = col("current value")!;
  const basis = col("cost basis total", "cost basis");
  const accounts = new Map<string, ParsedPositionsAccount>();
  let skipped = 0;
  let asOf: string | null = null;
  for (const { fields } of records.slice(at + 1)) {
    const downloaded = fields.find((f) => /date downloaded/i.test(f));
    if (downloaded) asOf = parseFileDate(downloaded) ?? asOf;
    // The disclaimer under the rows is one quoted field per line.
    if (fields.length < h.length - 2) continue;
    const valueCents = cents(fields[value]);
    const name = (fields[description] ?? "").trim();
    const raw = (fields[symbol] ?? "").trim();
    if (valueCents === null || (!raw && !name)) continue;
    if (/pending activity/i.test(raw) || /pending activity/i.test(name)) {
      skipped++;
      continue;
    }
    const accountNumber = (fields[number] ?? "").trim();
    let account = accounts.get(accountNumber);
    if (!account) {
      account = accountOf("fidelity", accountNumber, fields[label] ?? "", lastFour(accountNumber));
      accounts.set(accountNumber, account);
    }
    const symbolTicker = cleanTicker(raw);
    const isCash = raw.endsWith("**") || isCashPosition(symbolTicker, name);
    const plain = isCash && isPlainCash(symbolTicker, name);
    const ticker = plain ? null : symbolTicker;
    const qty = parseNumber(fields[quantity]);
    const priceCents = cents(price === null ? undefined : fields[price]);
    add(account, {
      ticker,
      name: plain ? "Cash" : titleCase(name || ticker || "Cash"),
      // Fidelity leaves the core position's quantity and price blank: it is dollars at $1.
      quantity: qty ?? (isCash ? valueCents / 100 : 0),
      priceCents: priceCents ?? (isCash ? 100 : 0),
      valueCents,
      costBasisCents: isCash ? null : cents(basis === null ? undefined : fields[basis]),
      isCash,
      type: isCash ? "cash" : typeFromName(ticker, name),
    });
  }
  return { asOf, accounts: [...accounts.values()], skipped, notes: [] };
};

// Schwab's "Security Type" in Plaid's words.
const SCHWAB_TYPES: Record<string, string> = {
  "mutual fund": "mutual fund",
  "etfs & closed end funds": "etf",
  etf: "etf",
  equity: "equity",
  "fixed income": "fixed income",
  option: "derivative",
  "cash and money market": "cash",
};

const readSchwab: Reader = (records, at) => {
  const accounts: ParsedPositionsAccount[] = [];
  let skipped = 0;
  let asOf: string | null = null;
  // The title names the account in a one-account file; each block's own line in the
  // all-accounts file.
  let pendingLabel: string | null = null;
  for (const { fields } of records.slice(0, at)) {
    const text = fields.join(" ").trim();
    asOf = parseFileDate(text) ?? asOf;
    const title = /positions for (?:account )?(.+?) as of/i.exec(text);
    if (title) pendingLabel = title[1];
    else if (text) pendingLabel = text;
  }
  let h = records[at].fields;
  let account: ParsedPositionsAccount | null = null;
  const open = () => {
    const label = (pendingLabel ?? "Account").trim();
    const masked = /^(.*?)\s*(?:\.{3}|…|XXXX-?)(\w{2,4})$/.exec(label);
    const words = masked ? masked[1] : label;
    const mask = masked ? masked[2] : null;
    account = accountOf("schwab", label, /all-accounts/i.test(words) ? "Account" : words, mask);
    accounts.push(account);
    pendingLabel = null;
  };
  for (const { fields } of records.slice(at)) {
    if (signatureOf(fields) === "schwab") {
      h = fields;
      account = null;
      continue;
    }
    const col = (...names: string[]) => findColumn(h, names);
    const symbol = col("symbol")!;
    const description = col("description")!;
    const raw = (fields[symbol] ?? "").trim();
    // A line between blocks naming the next account ("Roth Contributory IRA ...456").
    if (fields.filter((f) => f.trim()).length === 1 && raw) {
      pendingLabel = raw;
      account = null;
      continue;
    }
    if (/^account total$/i.test(raw)) {
      account = null;
      continue;
    }
    const value = cents(fields[col("mkt val", "market value")!]);
    if (value === null && !/cash/i.test(raw)) {
      if (raw) skipped++;
      continue;
    }
    if (!account) open();
    const type =
      SCHWAB_TYPES[normalizeHeader(fields[col("security type", "asset type") ?? -1] ?? "")];
    if (type === "derivative") {
      skipped++;
      continue;
    }
    const name = (fields[description] ?? "").trim();
    const isCash =
      /^cash\b/i.test(raw) || type === "cash" || isCashPosition(cleanTicker(raw), name);
    const valueCents = value ?? 0;
    const ticker = /^cash\b/i.test(raw) ? null : cleanTicker(raw);
    const qty = parseNumber(fields[col("qty", "quantity")!]);
    const price = cents(fields[col("price")!]);
    add(account!, {
      ticker,
      name: ticker === null && isCash ? "Cash" : titleCase(name || raw),
      quantity: qty ?? (isCash ? valueCents / 100 : 0),
      priceCents: price ?? (isCash ? 100 : 0),
      valueCents,
      costBasisCents: isCash ? null : cents(fields[col("cost basis") ?? -1]),
      isCash,
      type: isCash ? "cash" : (type ?? null),
    });
  }
  return { asOf, accounts: accounts.filter((a) => a.positions.length > 0), skipped, notes: [] };
};

const readVanguard: Reader = (records, at) => {
  const h = records[at].fields;
  const col = (name: string) => findColumn(h, [name])!;
  const accounts = new Map<string, ParsedPositionsAccount>();
  for (const { fields } of records.slice(at + 1)) {
    // The transactions follow under their own header: the holdings end there.
    if (fields.some((f) => normalizeHeader(f) === "trade date")) break;
    const valueCents = cents(fields[col("total value")]);
    const number = (fields[col("account number")] ?? "").trim();
    if (valueCents === null || !number) continue;
    let account = accounts.get(number);
    if (!account) {
      account = accountOf("vanguard", number, "Account", lastFour(number));
      accounts.set(number, account);
    }
    const name = (fields[col("investment name")] ?? "").trim();
    const ticker = cleanTicker(fields[col("symbol")]);
    const isCash = isCashPosition(ticker, name);
    add(account, {
      ticker,
      name: titleCase(name || ticker || "Fund"),
      quantity: parseNumber(fields[col("shares")]) ?? 0,
      priceCents: cents(fields[col("share price")]) ?? 0,
      valueCents,
      costBasisCents: null,
      isCash,
      type: isCash ? "cash" : typeFromName(ticker, name),
    });
  }
  return {
    asOf: null,
    accounts: [...accounts.values()],
    skipped: 0,
    notes: [
      "Vanguard's download doesn't say what kind of account each is or what you paid, so check the account type below.",
    ],
  };
};

// Robinhood's trade codes that change a share count; the rest move cash only (deposits,
// dividends, interest, fees) or are options and futures, which are left out.
const SHARES_IN = new Set(["buy", "rec", "spl", "acati", "sxch", "mrgs", "conv"]);
const SHARES_OUT = new Set(["sell", "spr", "acato"]);
const OPTION_CODES = new Set(["bto", "btc", "sto", "stc", "oexp", "oasgn", "oexcs", "futswp"]);

const readRobinhood: Reader = (records, at) => {
  const h = records[at].fields;
  const col = (name: string) => findColumn(h, [name])!;
  const shares = new Map<
    string,
    { name: string; quantity: number; priceCents: number; costCents: number }
  >();
  let cash = 0;
  let skipped = 0;
  let last: string | null = null;
  let first: string | null = null;
  let short = false;
  const rows = records
    .slice(at + 1)
    .filter(({ fields }) => fields.length >= h.length - 1)
    .map(({ fields }) => ({ fields, date: parseFileDate(fields[col("activity date")] ?? "") }))
    .filter((r): r is { fields: string[]; date: string } => r.date !== null);
  // The report is newest first: the trades are counted oldest first.
  if (rows.length > 1 && rows[0].date > rows[rows.length - 1].date) rows.reverse();
  for (const { fields, date } of rows) {
    const amount = cents(fields[col("amount")]);
    if (!last || date > last) last = date;
    if (!first || date < first) first = date;
    const code = (fields[col("trans code")] ?? "").trim().toLowerCase();
    // Every row's amount is cash in or out, options' premiums too.
    cash += amount ?? 0;
    if (OPTION_CODES.has(code)) {
      skipped++;
      continue;
    }
    const ticker = cleanTicker(fields[col("instrument")]);
    const qty = Math.abs(parseNumber(fields[col("quantity")]) ?? 0);
    if (!ticker || qty === 0 || !(SHARES_IN.has(code) || SHARES_OUT.has(code))) continue;
    const held = shares.get(ticker) ?? {
      name: (fields[col("description")] ?? "").split(/\r?\n/)[0].trim() || ticker,
      quantity: 0,
      priceCents: 0,
      costCents: 0,
    };
    const price = cents(fields[col("price")]);
    if (SHARES_IN.has(code)) {
      held.quantity += qty;
      // Bought shares add what was paid; shares from a split or transfer cost nothing new.
      if (code === "buy") held.costCents += Math.abs(amount ?? 0);
    } else {
      // Sold shares take their average cost out.
      const average = held.quantity > 0 ? held.costCents / held.quantity : 0;
      held.quantity -= qty;
      held.costCents = Math.max(0, held.costCents - Math.round(average * qty));
      if (held.quantity < -1e-6) short = true;
    }
    if (price !== null && (code === "buy" || code === "sell")) held.priceCents = price;
    shares.set(ticker, held);
  }
  const account = accountOf("robinhood", "robinhood", "Individual", null);
  for (const [ticker, held] of [...shares].sort(([a], [b]) => a.localeCompare(b))) {
    const quantity = Math.round(held.quantity * 1e6) / 1e6;
    if (quantity <= 0) continue;
    add(account, {
      ticker,
      name: titleCase(held.name),
      quantity,
      priceCents: held.priceCents,
      valueCents: Math.round(quantity * held.priceCents),
      costBasisCents: held.costCents > 0 ? held.costCents : null,
      isCash: false,
      // Robinhood trades stocks and ETFs (options are left out above): a stock unless named a fund.
      type: typeFromName(ticker, held.name) ?? (FUND_WORDS.test(held.name) ? null : "equity"),
    });
  }
  const notes = [
    "Robinhood has no holdings download, so Jane counted your shares from the trades in this report and priced each at your last trade in it. Download the report from the day you opened the account.",
  ];
  if (short) {
    notes.push(
      "This report starts after some of your trades (it sells shares it never bought), so the counts may be off. Download it again from the day you opened the account.",
    );
  }
  if (cash > 0) {
    add(account, {
      ticker: null,
      name: "Cash",
      quantity: cash / 100,
      priceCents: 100,
      valueCents: cash,
      costBasisCents: null,
      isCash: true,
      type: "cash",
    });
  }
  return {
    asOf: last,
    accounts: account.positions.length > 0 ? [account] : [],
    skipped,
    notes,
  };
};

const READERS: Record<PositionsLayoutId, Reader> = {
  fidelity: readFidelity,
  schwab: readSchwab,
  vanguard: readVanguard,
  robinhood: readRobinhood,
};

export const NOT_POSITIONS =
  "Jane doesn't know this layout. Upload the positions download from Fidelity, Schwab or Vanguard, or Robinhood's account activity report.";
export const NO_POSITIONS = "There are no holdings in it. Download it again from your brokerage.";

// A positions file read whole, or why it can't be.
export function readPositionsFile(text: string): PositionsFile | { error: string } {
  const records = parseCsv(text);
  const found = findHeader(records);
  if (!found) return { error: NOT_POSITIONS };
  const read = READERS[found.layout](records, found.index);
  if (read.accounts.length === 0) return { error: NO_POSITIONS };
  return { layout: found.layout, ...read };
}
