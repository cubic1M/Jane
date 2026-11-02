import { categorizeByRules } from "@/categorize/rules";
import type { PfcPrimary } from "@/categorize/taxonomy";
import { detectDateOrder, looksLikeDate, parseDate, type DateOrder } from "./dates";
import { debitCreditCents, HEADER_SEARCH_ROWS, normalizeHeader, type Layout } from "./formats";
import type { CsvRecord } from "./parse-csv";
import { parseMoneyToCents } from "@/lib/money";

// A CSV that matches no bank's layout (formats.ts): the person says which column is the date,
// the description and the amount (or money out and money in), on /import. Columns are by
// position, 0-based. Where the file can't tell (day or month first, which sign is spending),
// Jane guesses from the rows and shows the guess, or asks; it never guesses silently.

export type MoneyOut = "negative" | "positive";

export type ColumnMapping = {
  // Whether the first row is column names rather than a transaction.
  hasHeader: boolean;
  date: number;
  // How numeric dates are written, when the person said (else worked out from the column).
  dateOrder?: DateOrder;
  description: number;
  amount:
    | { kind: "signed"; column: number; moneyOut: MoneyOut }
    | { kind: "split"; debit: number; credit: number }
    // The amount without a sign, and the way it went in a column of its own: "Debit"/"Credit",
    // "DR"/"CR", "-"/"+" (Navy Federal, many credit unions). `out` is that column's value for
    // money out, as written (any case); every other value there is money in.
    | { kind: "marked"; column: number; marker: number; out: string };
  // A running balance, when the file has one: the account's balance after each row, for net
  // worth over time and today's balance.
  balance?: number;
};

// Jane's guess at which sign is spending in a column, and why, or null to ask.
export type SignGuess = { moneyOut: MoneyOut | null; why: string };

// A column that could say which way each amount went: its few values, and the one for money
// out when Jane recognizes it (null: the person picks).
export type MarkerColumn = { values: string[]; out: string | null };

// What the picker shows for a file: each column with a sample value, and first guesses.
export type MappingChoices = {
  columns: string[];
  hasHeader: boolean;
  guess: {
    date: number | null;
    description: number | null;
    amount: number | null;
    debit: number | null;
    credit: number | null;
    balance: number | null;
    // The column saying which way each amount went, when the amounts carry no sign.
    marker: number | null;
  };
  // Columns with numeric dates: the order they're written in, or "unknown" (ask).
  dateOrders: Record<number, DateOrder | "unknown">;
  // Columns with numbers: which sign is spending.
  signs: Record<number, SignGuess>;
  // Columns with two or three values that could say which way each amount went.
  markers: Record<number, MarkerColumn>;
};

export const CUSTOM_FORMAT = { id: "custom", label: "Columns you picked" } as const;
// A first upload in a layout Jane doesn't know: a checking account until the person says.
const CUSTOM_ACCOUNT = { name: "Uploaded account", kind: "checking" } as const;

const SAMPLE_CHARS = 24;
// Of the rows with an amount, the share on one side that settles which sign is spending.
const SIGN_MAJORITY = 0.6;

// The words banks put in a column of its own for which way an amount went, lowercased.
const OUT_MARKS = ["debit", "dr", "d", "db", "withdrawal", "out", "-"];
const IN_MARKS = ["credit", "cr", "c", "deposit", "in", "+"];
// A marker column has this many different values at most (some banks add a third, like "Hold").
const MARKER_MAX_VALUES = 3;
const markOf = (value: string) => value.trim().toLowerCase();

// The columns that could say which way each amount went: two or three values, at least one of
// them recognized as money out and one as money in, or any two values under a name like "Type"
// or "Indicator" (the person then picks which is money out).
export function markerColumns(headers: string[], rows: string[][]): MappingChoices["markers"] {
  const markers: MappingChoices["markers"] = {};
  const width = Math.max(headers.length, ...rows.map((r) => r.length));
  for (let i = 0; i < width; i++) {
    const values = [...new Set(rows.map((r) => (r[i] ?? "").trim()).filter(Boolean))];
    if (values.length < 2 || values.length > MARKER_MAX_VALUES) continue;
    if (values.some((v) => parseAmount(v) !== null && !/^[+-]$/.test(v))) continue;
    const out = values.find((v) => OUT_MARKS.includes(markOf(v))) ?? null;
    const inn = values.find((v) => IN_MARKS.includes(markOf(v))) ?? null;
    const named = /indicator|cr\/dr|dr\/cr|debit\/credit|sign|direction|\btype\b/.test(
      normalizeHeader(headers[i] ?? ""),
    );
    if ((out !== null && inn !== null) || (named && values.length === 2)) {
      markers[i] = { values, out: out !== null && inn !== null ? out : null };
    }
  }
  return markers;
}

const find = (headers: string[], pattern: RegExp) => {
  const i = headers.findIndex((h) => pattern.test(h));
  return i === -1 ? null : i;
};

// An amount as banks outside the US write it too: "€12,50", "1.234,56", "12.50 USD".
export function parseAmount(text: string): number | null {
  const plain = text.replace(/[€£¥]|\b(?:USD|EUR|GBP|CAD)\b/gi, "").trim();
  const us = parseMoneyToCents(plain);
  if (us !== null) return us;
  const comma = /^(-)?(\d{1,3}(?:\.\d{3})+|\d+),(\d{1,2})$/.exec(plain.replace(/\s/g, ""));
  if (!comma) return null;
  return parseMoneyToCents(`${comma[1] ?? ""}${comma[2].replaceAll(".", "")}.${comma[3]}`);
}

// Spending categories: a row in one of these is money going out.
const SPENDING: readonly PfcPrimary[] = [
  "FOOD_AND_DRINK",
  "GENERAL_MERCHANDISE",
  "RENT_AND_UTILITIES",
  "ENTERTAINMENT",
  "TRANSPORTATION",
  "TRAVEL",
  "PERSONAL_CARE",
  "GENERAL_SERVICES",
  "MEDICAL",
  "HOME_IMPROVEMENT",
  "BANK_FEES",
];

// Whether the description says money in (pay, a deposit) or out (groceries, rent), by the
// same rules that categorize transactions. Null when it says neither.
function directionOf(description: string): "in" | "out" | null {
  const asIn = categorizeByRules({ description, amountCents: -1, hints: {} });
  if (asIn?.primary === "INCOME") return "in";
  const asOut = categorizeByRules({ description, amountCents: 1, hints: {} });
  return asOut && SPENDING.includes(asOut.primary) ? "out" : null;
}

// Which sign is spending: known merchants and pay first, then most rows (spending is
// usually most of a statement).
export function guessSign(rows: string[][], amount: number, description: number | null): SignGuess {
  let negative = 0;
  let positive = 0;
  const votes = { negative: [] as string[], positive: [] as string[] };
  for (const row of rows) {
    const cents = parseAmount(row[amount] ?? "");
    if (!cents) continue;
    if (cents < 0) negative++;
    else positive++;
    const text = description === null ? "" : (row[description] ?? "").trim();
    const direction = text ? directionOf(text) : null;
    if (!direction) continue;
    const spendingSign = cents < 0 === (direction === "out") ? "negative" : "positive";
    votes[spendingSign].push(text);
  }
  if (votes.negative.length !== votes.positive.length) {
    const moneyOut = votes.negative.length > votes.positive.length ? "negative" : "positive";
    const example = votes[moneyOut][0].slice(0, SAMPLE_CHARS);
    return { moneyOut, why: `From rows like "${example}"` };
  }
  const total = negative + positive;
  if (total > 0 && negative / total >= SIGN_MAJORITY) {
    return { moneyOut: "negative", why: "Most rows are negative" };
  }
  if (total > 0 && positive / total >= SIGN_MAJORITY) {
    return { moneyOut: "positive", why: "Most rows are positive" };
  }
  return { moneyOut: null, why: "The rows don't say which" };
}

// A table has at least a date, a description and an amount; a file narrower than that has no
// lines above it to drop.
const PREAMBLE_MIN_TABLE_WIDTH = 3;

// Lines above the table (Barclays: the bank's name, the account number and the balance, then the
// column names; debugger 11-01): at the top, narrower than most of the file's rows. The picker
// and the read both start where the table does, so their column numbers agree.
export function withoutPreamble(records: CsvRecord[]): CsvRecord[] {
  const counts = new Map<number, number>();
  for (const r of records) counts.set(r.fields.length, (counts.get(r.fields.length) ?? 0) + 1);
  const width = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
  if (width < PREAMBLE_MIN_TABLE_WIDTH) return records;
  const start = records.slice(0, HEADER_SEARCH_ROWS).findIndex((r) => r.fields.length >= width);
  return start > 0 ? records.slice(start) : records;
}

export function mappingChoices(all: CsvRecord[]): MappingChoices {
  const records = withoutPreamble(all);
  const first = records[0]?.fields ?? [];
  // A first row with a date in it is a transaction, not column names.
  const hasHeader = !first.some(looksLikeDate);
  const rows = (hasHeader ? records.slice(1) : records).map((r) => r.fields);
  const sampleRow = rows[0] ?? [];
  const width = Math.max(first.length, sampleRow.length);
  const columns = Array.from({ length: width }, (_, i) => {
    const name = hasHeader && first[i]?.trim() ? first[i].trim() : `Column ${i + 1}`;
    const sample = sampleRow[i]?.trim().slice(0, SAMPLE_CHARS);
    return sample ? `${name} (${sample})` : name;
  });

  // From the values: the first date, the first number after it, the longest text.
  const byValue = guessFromValues(sampleRow);
  let guess: MappingChoices["guess"] = {
    ...byValue,
    debit: null,
    credit: null,
    balance: null,
    marker: null,
  };
  if (hasHeader) {
    // From the column names, falling back on the values.
    const headers = first.map(normalizeHeader);
    const debit = find(headers, /debit|withdrawal|money out|paid out/);
    const credit = find(headers, /credit|deposit|money in|paid in/);
    const amount = find(headers, /amount|value|betrag|montant|importe/);
    guess = {
      date: find(headers, /date|booked|posted/) ?? byValue.date,
      description:
        find(headers, /description|payee|merchant|memo|details|name|narrative/) ??
        byValue.description,
      amount: amount ?? (debit !== null && credit !== null ? null : byValue.amount),
      debit,
      credit,
      // "Running Total" too, as some credit unions write it (round 2).
      balance: find(headers, /balance|running bal|running total/),
      marker: null,
    };
  }
  const markers = markerColumns(hasHeader ? first : [], rows);
  // A "Debit/Credit" column of words is the sign, not money out and money in amounts.
  if (guess.debit !== null && guess.debit in markers) guess.debit = null;
  if (guess.credit !== null && guess.credit in markers) guess.credit = null;

  const dateOrders: MappingChoices["dateOrders"] = {};
  const signs: MappingChoices["signs"] = {};
  for (let i = 0; i < width; i++) {
    const values = rows.map((r) => r[i] ?? "").filter((v) => v.trim() !== "");
    const order = detectDateOrder(values);
    if (order) dateOrders[i] = order;
    else if (values.some((v) => parseAmount(v) !== null)) {
      signs[i] = guessSign(rows, i, guess.description);
    }
  }
  // Amounts that are never negative, beside a column that says which way they went: that column
  // is the sign (Jane's guess, shown to check).
  if (guess.amount !== null) {
    const amounts = rows.map((r) => parseAmount(r[guess.amount!] ?? "")).filter((c) => c !== null);
    const unsigned = amounts.length > 0 && amounts.every((c) => c >= 0);
    const known = Object.entries(markers).find(([, m]) => m.out !== null);
    if (unsigned && known) guess.marker = Number(known[0]);
  }
  return { columns, hasHeader, guess, dateOrders, signs, markers };
}

function guessFromValues(row: string[]) {
  const at = (i: number) => (i === -1 ? null : i);
  const date = at(row.findIndex(looksLikeDate));
  const amount = at(row.findIndex((v, i) => i !== date && parseAmount(v) !== null));
  let description: number | null = null;
  for (const [i, v] of row.entries()) {
    if (i === date || i === amount || !v.trim()) continue;
    if (description === null || v.trim().length > row[description].trim().length) description = i;
  }
  return { date, description, amount };
}

// The rows read with the person's choices, in the same shape as a bank's layout. A string
// when the dates can't be read without asking which comes first, the day or the month.
export function mappedLayout(all: CsvRecord[], mapping: ColumnMapping): Layout | string {
  const records = withoutPreamble(all);
  const rows = mapping.hasHeader ? records.slice(1) : records;
  const detected = detectDateOrder(rows.map((r) => r.fields[mapping.date] ?? ""));
  const order = mapping.dateOrder ?? (detected === "unknown" ? null : detected);
  if (detected === "unknown" && !order) {
    const example = rows.map((r) => r.fields[mapping.date]).find((v) => v && /\d/.test(v));
    return `Jane can't tell from this file whether ${example ?? "a date like 05/09/2026"} is month first or day first. Say how the dates are written.`;
  }
  const width = Math.max(0, ...records.map((r) => r.fields.length));
  const columns = Array.from({ length: width }, (_, i) => `c${i}`);
  const at = (get: (column: string) => string, i: number) => get(`c${i}`);
  return {
    format: {
      ...CUSTOM_FORMAT,
      account: CUSTOM_ACCOUNT,
      parseRow(get) {
        const dateText = at(get, mapping.date);
        const date = parseDate(dateText, order);
        if (!date) {
          return {
            ok: false,
            reason: `"${dateText}" in the date column isn't a date Jane can read`,
          };
        }
        const description = at(get, mapping.description).trim();
        if (!description) return { ok: false, reason: "The description column is empty" };
        let amountCents: number;
        if (mapping.amount.kind === "split") {
          const cents = debitCreditCents(
            at(get, mapping.amount.debit),
            at(get, mapping.amount.credit),
            parseAmount,
          );
          if (typeof cents === "string") return { ok: false, reason: cents };
          amountCents = cents;
        } else if (mapping.amount.kind === "marked") {
          const text = at(get, mapping.amount.column);
          const cents = parseAmount(text);
          if (cents === null) {
            return { ok: false, reason: `"${text}" in the amount column isn't an amount` };
          }
          const mark = at(get, mapping.amount.marker).trim();
          if (!mark) return { ok: false, reason: "The column saying which way it went is empty" };
          // Positive is money out (Plaid's convention); the marker says which way, not the sign.
          amountCents =
            markOf(mark) === markOf(mapping.amount.out) ? Math.abs(cents) : -Math.abs(cents) || 0;
        } else {
          const text = at(get, mapping.amount.column);
          const cents = parseAmount(text);
          if (cents === null) {
            return { ok: false, reason: `"${text}" in the amount column isn't an amount` };
          }
          // Positive is money out (Plaid's convention).
          amountCents = mapping.amount.moneyOut === "negative" ? -cents || 0 : cents;
        }
        // A running balance that doesn't read is left out; the row still counts.
        const balanceCents =
          mapping.balance === undefined ? null : parseAmount(at(get, mapping.balance));
        return {
          ok: true,
          row: {
            date,
            amountCents,
            description,
            hints: {},
            ...(balanceCents === null ? {} : { balanceCents }),
          },
        };
      },
    },
    columns,
    rows,
  };
}

// The picker's answers for file number `index`, from the form. Null when it wasn't shown;
// a string says what's missing.
export function mappingFromForm(
  form: { get(name: string): unknown },
  index: number,
): ColumnMapping | string | null {
  const value = (field: string) => {
    const raw = form.get(`map.${index}.${field}`);
    return typeof raw === "string" ? raw : null;
  };
  const column = (field: string) => {
    const raw = value(field);
    if (raw === null || raw === "") return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };
  if (value("date") === null) return null;

  const date = column("date");
  const description = column("description");
  if (date === null) return "Pick the date column.";
  if (description === null) return "Pick the description column.";
  const hasHeader = value("header") === "1";
  const dates = value("dates");
  const dateOrder: { dateOrder?: DateOrder } =
    dates === "mdy" || dates === "dmy" ? { dateOrder: dates } : {};
  const balanceColumn = column("balance");
  const balance = balanceColumn === null ? {} : { balance: balanceColumn };
  const amount = column("amount");
  if (amount !== null) {
    const out = value("out");
    if (out === "marked") {
      const marker = column("marker");
      const markOut = value("markout");
      if (marker === null) return "Pick the column that says which way each amount went.";
      if (!markOut?.trim()) return "Say which value in that column means money out.";
      return {
        hasHeader,
        date,
        ...dateOrder,
        description,
        amount: { kind: "marked", column: amount, marker, out: markOut.trim() },
        ...balance,
      };
    }
    if (out !== "negative" && out !== "positive") {
      return "Say whether money you spent shows as a negative or a positive number.";
    }
    return {
      hasHeader,
      date,
      ...dateOrder,
      description,
      amount: { kind: "signed", column: amount, moneyOut: out },
      ...balance,
    };
  }
  const debit = column("debit");
  const credit = column("credit");
  if (debit === null || credit === null) {
    return "Pick the amount column, or both the money out and money in columns.";
  }
  return {
    hasHeader,
    date,
    ...dateOrder,
    description,
    amount: { kind: "split", debit, credit },
    ...balance,
  };
}
