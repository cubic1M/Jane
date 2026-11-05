import { ROBINHOOD_LIMITS, ROBINHOOD_NAME } from "@/config/robinhood";
import { scrub } from "@/lib/scrub";
import { oneLine } from "@/lib/untrusted-text";
import { accountRef } from "./secrets";

// The door: everything Robinhood's server answers comes through here, and only the fields below get
// past it. Nothing else is kept, so a field Jane doesn't know, whatever it holds, goes no further.
//
// Robinhood publishes tool names but not their answers, so the field names here are assumptions until
// the founder's first real connection (docs/setup/robinhood.md). An answer they don't fit fails the
// read and changes nothing; shapeOf logs its field names, never its values, to fix them from.
//
// All of it is untrusted text (src/lib/untrusted-text.ts). Account names are never kept: Jane writes
// its own from the account's type. Security names are cleaned and capped, and symbols must look like
// symbols. A full account number is never kept anywhere: it stays in an AccountHandle, for asking
// about that account during one refresh, and can't be read out of one.

export class RobinhoodShapeError extends Error {
  constructor(
    readonly tool: string,
    readonly shape: unknown,
  ) {
    super(`Robinhood's answer from ${tool} wasn't the expected shape`);
    this.name = "RobinhoodShapeError";
  }
}

const NUMBER_FIELDS = ["account_number", "accountNumber", "number"] as const;
const MAX_NAME = 120;
const SYMBOL = /^[A-Z][A-Z0-9.-]{0,11}$/;
// Past what the cents columns hold.
const MAX_CENTS = 2_147_483_647;
const MAX_QUANTITY = 1e12;
const DECIMAL = /^-?\d{1,15}(\.\d{1,12})?$/;
// Invisible characters and ones that flip text direction, which can make a name read as another.
const INVISIBLE = new RegExp("[\\u00ad\\u200b-\\u200f\\u2028-\\u202f\\u2060-\\u206f\\ufeff]", "g");

type Obj = Record<string, unknown>;

const isObject = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Field names and types only, for a log line. A name with a digit in it is left out: a map keyed by
// account number mustn't reach the logs that way.
export function shapeOf(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    return value.length === 0 ? [] : [shapeOf(value[0], depth + 1)];
  }
  if (isObject(value)) {
    if (depth >= 3) return "object";
    const known = Object.entries(value)
      .filter(([key]) => /^[A-Za-z_]{1,40}$/.test(key))
      .slice(0, 40);
    return Object.fromEntries(known.map(([key, v]) => [key, shapeOf(v, depth + 1)]));
  }
  return value === null ? "null" : typeof value;
}

// The list in an answer: the answer itself, or under one of these names.
function listIn(tool: string, value: unknown, keys: readonly string[]): unknown[] {
  if (Array.isArray(value)) return value;
  if (isObject(value)) {
    for (const key of [...keys, "results", "data", "items"]) {
      if (Array.isArray(value[key])) return value[key];
    }
  }
  throw new RobinhoodShapeError(tool, shapeOf(value));
}

function firstOf(row: Obj, keys: readonly string[]): unknown {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) return row[key];
  return undefined;
}

// A number, or a plain decimal in a string. "1e400", "$5" and Infinity aren't.
function decimal(value: unknown): number | null {
  const inner = isObject(value) ? value.amount : value;
  const n =
    typeof inner === "number"
      ? inner
      : typeof inner === "string" && DECIMAL.test(inner.trim())
        ? Number(inner)
        : NaN;
  return Number.isFinite(n) ? n : null;
}

function cents(value: number | null): number | null {
  if (value === null) return null;
  const c = Math.round(value * 100);
  return Math.abs(c) > MAX_CENTS ? null : c;
}

// An account: what to call it, and its number sealed inside.
export class AccountHandle {
  readonly #number: string;
  constructor(
    number: string,
    readonly subtype: string | null,
    readonly name: string,
  ) {
    this.#number = number;
  }
  // The arguments for asking Robinhood about this account. Only for the request.
  args(): Record<string, string> {
    return { account_number: this.#number };
  }
  ref(accountKey: string): string {
    return accountRef(accountKey, this.#number);
  }
  mentionedIn(text: string): boolean {
    return text.toUpperCase().includes(this.#number.toUpperCase());
  }
  toJSON(): string {
    return "[account]";
  }
}

// Jane's own words for the account, from its type. Unknown types have no subtype, so no tax is
// worked out on an account that may be a retirement one.
function kindOf(row: Obj): { subtype: string | null; label: string | null } {
  const words = ["type", "account_type", "brokerage_account_type", "agentic", "nickname"]
    .map((key) => (typeof row[key] === "string" ? (row[key] as string) : ""))
    .join(" ")
    .toLowerCase();
  if (/roth/.test(words)) return { subtype: "roth", label: "Roth IRA" };
  if (/\bira\b|traditional/.test(words)) return { subtype: "ira", label: "IRA" };
  if (/agent|\bmcp\b/.test(words) || row.agentic === true) {
    return { subtype: "brokerage", label: "agent account" };
  }
  if (/individual|margin|cash|brokerage|joint/.test(words)) {
    return { subtype: "brokerage", label: null };
  }
  return { subtype: null, label: null };
}

export function parseAccounts(answer: unknown): AccountHandle[] {
  const rows = listIn("get_accounts", answer, ["accounts"]);
  const seen = new Map<string, number>();
  const handles = rows.slice(0, ROBINHOOD_LIMITS.accounts).map((row) => {
    if (!isObject(row)) throw new RobinhoodShapeError("get_accounts", shapeOf(answer));
    const number = firstOf(row, NUMBER_FIELDS);
    if (typeof number !== "string" || !number.trim()) {
      throw new RobinhoodShapeError("get_accounts", shapeOf(answer));
    }
    const { subtype, label } = kindOf(row);
    const base = label ? `${ROBINHOOD_NAME} ${label}` : ROBINHOOD_NAME;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return new AccountHandle(number.trim(), subtype, count === 1 ? base : `${base} ${count}`);
  });
  // Nobody has a Robinhood connection with no account, so this isn't "they closed everything".
  if (handles.length === 0) throw new RobinhoodShapeError("get_accounts", shapeOf(answer));
  return handles;
}

export type Portfolio = { totalCents: number; cashCents: number | null };

export function parsePortfolio(answer: unknown): Portfolio {
  const fail = () => new RobinhoodShapeError("get_portfolio", shapeOf(answer));
  if (!isObject(answer)) throw fail();
  const row = isObject(answer.portfolio) ? answer.portfolio : answer;
  const totalCents = cents(
    decimal(firstOf(row, ["total_value", "total_equity", "equity", "portfolio_value"])),
  );
  if (totalCents === null || totalCents < 0) throw fail();
  const cash = firstOf(row, ["cash", "cash_balance", "uninvested_cash"]);
  const cashCents = cents(decimal(cash));
  // Buying power is left out on purpose: it can include money borrowed on margin.
  if (cash !== undefined && (cashCents === null || cashCents < 0)) throw fail();
  return { totalCents, cashCents };
}

// A security's name, or null when it isn't usable and the symbol has to do.
function cleanName(value: unknown, accounts: readonly AccountHandle[]): string | null {
  if (typeof value !== "string") return null;
  const name = oneLine(scrub(value).replace(INVISIBLE, "")).slice(0, MAX_NAME).trim();
  if (!name || accounts.some((a) => a.mentionedIn(value))) return null;
  return name;
}

function cleanSymbol(value: unknown, accounts: readonly AccountHandle[]): string | null {
  if (typeof value !== "string") return null;
  const symbol = value.trim().toUpperCase();
  return SYMBOL.test(symbol) && !accounts.some((a) => a.mentionedIn(symbol)) ? symbol : null;
}

export type Position = {
  symbol: string;
  name: string;
  type: "equity" | "etf";
  quantity: number;
  priceCents: number;
  valueCents: number;
  costBasisCents: number | null;
};

const typeOf = (row: Obj): Position["type"] => {
  const type = firstOf(row, ["type", "instrument_type", "security_type"]);
  return typeof type === "string" && /etf/i.test(type) ? "etf" : "equity";
};

const PRICE_FIELDS = ["price", "last_trade_price", "current_price", "mark_price"] as const;
const VALUE_FIELDS = ["market_value", "equity", "value"] as const;

// The symbols a positions answer gives no price or value for. Robinhood describes that tool as
// "quantity and cost basis", so its price may have to come from get_equity_quotes.
export function symbolsWithoutPrice(answer: unknown, accounts: readonly AccountHandle[]): string[] {
  const rows = listIn("get_equity_positions", answer, ["positions"]);
  const symbols = rows.slice(0, ROBINHOOD_LIMITS.positions).flatMap((row) => {
    if (!isObject(row)) return [];
    const symbol = cleanSymbol(firstOf(row, ["symbol", "ticker"]), accounts);
    const priced =
      decimal(firstOf(row, PRICE_FIELDS)) !== null || decimal(firstOf(row, VALUE_FIELDS)) !== null;
    return symbol && !priced ? [symbol] : [];
  });
  return [...new Set(symbols)];
}

export function parseQuotes(
  answer: unknown,
  accounts: readonly AccountHandle[],
): Map<string, number> {
  const rows = listIn("get_equity_quotes", answer, ["quotes"]);
  const quotes = new Map<string, number>();
  for (const row of rows.slice(0, ROBINHOOD_LIMITS.positions)) {
    if (!isObject(row)) continue;
    const symbol = cleanSymbol(firstOf(row, ["symbol", "ticker"]), accounts);
    const price = decimal(firstOf(row, PRICE_FIELDS));
    if (symbol && price !== null && price >= 0) quotes.set(symbol, price);
  }
  return quotes;
}

// Rows with a bad symbol or a nonsense amount are left out and counted; an answer with no way to
// tell what a position is worth fails the read.
export function parsePositions(
  answer: unknown,
  accounts: readonly AccountHandle[],
  quotes: ReadonlyMap<string, number> = new Map(),
): { positions: Position[]; dropped: number } {
  const rows = listIn("get_equity_positions", answer, ["positions"]);
  const positions: Position[] = [];
  let dropped = 0;
  for (const row of rows.slice(0, ROBINHOOD_LIMITS.positions)) {
    if (!isObject(row)) throw new RobinhoodShapeError("get_equity_positions", shapeOf(answer));
    const symbol = cleanSymbol(firstOf(row, ["symbol", "ticker"]), accounts);
    const quantity = decimal(firstOf(row, ["quantity", "shares"]));
    if (!symbol || quantity === null || quantity < 0 || quantity > MAX_QUANTITY) {
      dropped += 1;
      continue;
    }
    if (quantity === 0) continue;
    const price = decimal(firstOf(row, PRICE_FIELDS)) ?? quotes.get(symbol) ?? null;
    const value = decimal(firstOf(row, VALUE_FIELDS));
    if (price === null && value === null) {
      throw new RobinhoodShapeError("get_equity_positions", shapeOf(answer));
    }
    const valueCents = cents(value ?? (price as number) * quantity);
    const priceCents = cents(price ?? (value as number) / quantity);
    if (valueCents === null || priceCents === null || valueCents < 0 || priceCents < 0) {
      dropped += 1;
      continue;
    }
    const averageCost = decimal(firstOf(row, ["average_buy_price", "average_cost"]));
    const totalCost = decimal(firstOf(row, ["cost_basis", "total_cost"]));
    const costBasisCents = cents(
      totalCost ?? (averageCost === null ? null : averageCost * quantity),
    );
    positions.push({
      symbol,
      name: cleanName(firstOf(row, ["name", "instrument_name", "simple_name"]), accounts) ?? symbol,
      type: typeOf(row),
      quantity,
      priceCents,
      valueCents,
      costBasisCents: costBasisCents !== null && costBasisCents >= 0 ? costBasisCents : null,
    });
  }
  return { positions, dropped };
}

export type FilledOrder = {
  id: string;
  side: "buy" | "sell";
  symbol: string;
  quantity: number;
  priceCents: number;
  totalCents: number;
  feesCents: number | null;
  date: string;
};

function dayOf(value: unknown, now: Date): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const day = value.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return null;
  return parsed.getTime() > now.getTime() ? null : day;
}

// Filled orders only: they are what the tax figures work gains out from (src/lib/investment-taxes.ts).
export function parseOrders(
  answer: unknown,
  accounts: readonly AccountHandle[],
  now: Date,
): { orders: FilledOrder[]; dropped: number } {
  const rows = listIn("get_equity_orders", answer, ["orders"]);
  const orders: FilledOrder[] = [];
  let dropped = 0;
  for (const row of rows.slice(0, ROBINHOOD_LIMITS.orders)) {
    if (!isObject(row)) throw new RobinhoodShapeError("get_equity_orders", shapeOf(answer));
    if (String(firstOf(row, ["state", "status"]) ?? "").toLowerCase() !== "filled") continue;
    const id = firstOf(row, ["id", "order_id"]);
    const side = String(row.side ?? "").toLowerCase();
    const symbol = cleanSymbol(firstOf(row, ["symbol", "ticker"]), accounts);
    const quantity = decimal(firstOf(row, ["filled_quantity", "cumulative_quantity", "quantity"]));
    const price = decimal(firstOf(row, ["average_price", "price"]));
    const date = dayOf(firstOf(row, ["last_transaction_at", "updated_at", "created_at"]), now);
    const stated = decimal(firstOf(row, ["executed_notional", "total", "amount"]));
    const totalCents = cents(stated ?? (price ?? NaN) * (quantity ?? NaN));
    const priceCents = cents(price);
    if (
      typeof id !== "string" ||
      !id ||
      (side !== "buy" && side !== "sell") ||
      !symbol ||
      quantity === null ||
      quantity <= 0 ||
      quantity > MAX_QUANTITY ||
      priceCents === null ||
      priceCents < 0 ||
      totalCents === null ||
      totalCents < 0 ||
      !date
    ) {
      dropped += 1;
      continue;
    }
    const fees = cents(decimal(firstOf(row, ["fees", "fee"])));
    orders.push({
      id,
      side,
      symbol,
      quantity,
      priceCents,
      totalCents,
      feesCents: fees !== null && fees >= 0 ? fees : null,
      date,
    });
  }
  return { orders, dropped };
}
