import { parseCsv } from "@/data-sources/csv/parse-csv";
import { parseMoneyToCents } from "@/lib/money";

// A brokerage's positions export read into holdings (read-only beta): Fidelity, Schwab, Vanguard
// and Robinhood-style files, read in memory and never stored. One tolerant reader finds the
// header row by the words every layout shares (a symbol column and a quantity column), maps each
// bank's column names, and keeps the money as cents. Fixtures in the tests follow the published
// layouts with invented numbers. Pure.

export type Position = {
  ticker: string;
  name: string;
  quantity: number;
  // Cents per share, when the file said it or it follows from the value.
  priceCents: number | null;
  valueCents: number;
  // The total paid for it, when the file said (a loss or gain is only shown then).
  costBasisCents: number | null;
  isCash: boolean;
};

export type PositionAccount = { label: string; positions: Position[] };
export type ParsedPositions = {
  broker: "Fidelity" | "Schwab" | "Vanguard" | "Robinhood" | null;
  accounts: PositionAccount[];
  // Lines that were not holdings (totals, notes, pending activity).
  skipped: number;
};

export const MAX_POSITIONS = 500;

const SYMBOL = ["symbol", "ticker", "instrument"];
const QUANTITY = ["quantity", "shares", "qty"];
const PRICE = ["last price", "price", "share price"];
const VALUE = ["current value", "market value", "total value", "equity", "value"];
const COST_TOTAL = ["cost basis total", "cost basis"];
const COST_AVERAGE = ["average cost basis", "average cost"];
const NAME = ["description", "investment name", "name", "security name"];
const ACCOUNT = ["account name", "account number", "account"];

const CASH_FUNDS = new Set([
  "SPAXX",
  "FDRXX",
  "FZFXX",
  "VMFXX",
  "VMMXX",
  "SWVXX",
  "SNVXX",
  "FCASH",
  "CASH",
]);

const clean = (s: string) =>
  s
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
const norm = (s: string) => clean(s).toLowerCase();

function cents(text: string | undefined): number | null {
  if (text === undefined) return null;
  const t = text.trim().replace(/^\+/, "");
  if (t === "" || /^(--|n\/a|-)$/i.test(t)) return null;
  return parseMoneyToCents(t.replace(/^\$/, "$"));
}
function number(text: string | undefined): number | null {
  if (text === undefined) return null;
  const t = text.trim().replace(/,/g, "");
  if (t === "" || /^(--|n\/a)$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function brokerOf(header: string[]): ParsedPositions["broker"] {
  const has = (w: string) => header.includes(w);
  if (has("account name") && (has("cost basis total") || has("average cost basis")))
    return "Fidelity";
  if (has("security type") || has("gain/loss $") || has("price change $")) return "Schwab";
  if (has("investment name")) return "Vanguard";
  if (has("instrument") || has("average cost")) return "Robinhood";
  return null;
}

export function parsePositionsCsv(text: string): ParsedPositions | null {
  const records = parseCsv(text);
  const at = records.findIndex((r) => {
    const f = r.fields.map(norm);
    return f.some((c) => SYMBOL.includes(c)) && f.some((c) => QUANTITY.includes(c));
  });
  if (at < 0) return null;
  const header = records[at].fields.map(norm);
  const col = (names: readonly string[]) => header.findIndex((h) => names.includes(h));
  const iSymbol = col(SYMBOL);
  const iQty = col(QUANTITY);
  const iPrice = col(PRICE);
  const iValue = col(VALUE);
  const iTotal = col(COST_TOTAL);
  const iAverage = col(COST_AVERAGE);
  const iName = col(NAME);
  const iAccount = col(ACCOUNT);
  const iAccountName = header.indexOf("account name");
  if (iValue < 0 && iPrice < 0) return null;
  const broker = brokerOf(header);

  // Schwab's first line says which account: "Positions for account Individual ...123 as of ...".
  const lead = records
    .slice(0, at)
    .map((r) => r.fields[0])
    .find((f) => /positions for account/i.test(f));
  const leadLabel = lead
    ? clean(lead)
        .replace(/^positions for account\s*/i, "")
        .replace(/\s+as of.*$/i, "")
    : null;

  const byAccount = new Map<string, Position[]>();
  let skipped = 0;
  for (const rec of records.slice(at + 1)) {
    const f = rec.fields;
    // A second header (Vanguard's transactions section) ends the holdings.
    if (
      f.map(norm).some((c) => SYMBOL.includes(c)) &&
      f.map(norm).some((c) => QUANTITY.includes(c))
    )
      break;
    const raw = clean(f[iSymbol] ?? "");
    const ticker = raw.replace(/\*+$/, "").toUpperCase();
    const name = clean(f[iName] ?? "") || ticker;
    const isTotalLine = /^(account total|cash & cash investments|pending activity)$/i.test(raw);
    if (isTotalLine && /cash & cash investments/i.test(raw)) {
      const v = cents(f[iValue >= 0 ? iValue : iPrice]);
      if (v !== null && v > 0) {
        const label = leadLabel ?? "Brokerage";
        byAccount.set(label, [
          ...(byAccount.get(label) ?? []),
          {
            ticker: "CASH",
            name: "Cash",
            quantity: v / 100,
            priceCents: 100,
            valueCents: v,
            costBasisCents: v,
            isCash: true,
          },
        ]);
      }
      continue;
    }
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker) || isTotalLine) {
      skipped += 1;
      continue;
    }
    const isCash = /\*\*$/.test(raw) || CASH_FUNDS.has(ticker) || /money market/i.test(name);
    let quantity = number(f[iQty]);
    let priceCents = iPrice >= 0 ? cents(f[iPrice]) : null;
    let valueCents = iValue >= 0 ? cents(f[iValue]) : null;
    // A money market line often has only a value: a dollar a share.
    if ((quantity === null || quantity <= 0) && isCash && valueCents !== null && valueCents > 0) {
      quantity = valueCents / 100;
      priceCents = 100;
    }
    if (quantity === null || quantity <= 0) {
      skipped += 1;
      continue;
    }
    if (valueCents === null && priceCents !== null) valueCents = Math.round(quantity * priceCents);
    if (valueCents === null) {
      skipped += 1;
      continue;
    }
    if (priceCents === null) priceCents = Math.round(valueCents / quantity);
    let costBasisCents: number | null = null;
    if (iTotal >= 0) costBasisCents = cents(f[iTotal]);
    if (costBasisCents === null && iAverage >= 0) {
      const avg = cents(f[iAverage]);
      costBasisCents = avg === null ? null : Math.round(avg * quantity);
    }
    const accountCell = iAccount >= 0 ? clean(f[iAccount] ?? "") : "";
    const accountName = iAccountName >= 0 ? clean(f[iAccountName] ?? "") : "";
    const tail =
      accountCell && /\d/.test(accountCell)
        ? ` ···${accountCell.replace(/\D/g, "").slice(-4)}`
        : "";
    const label =
      leadLabel ?? ((accountName && accountName !== accountCell ? accountName : "") + tail).trim();
    const key = label || "Brokerage";
    byAccount.set(key, [
      ...(byAccount.get(key) ?? []),
      {
        ticker,
        name,
        quantity,
        priceCents,
        valueCents,
        costBasisCents: isCash ? valueCents : costBasisCents,
        isCash,
      },
    ]);
  }
  const accounts = [...byAccount].map(([label, positions]) => ({ label, positions }));
  if (accounts.every((a) => a.positions.length === 0)) return null;
  return { broker, accounts, skipped };
}
