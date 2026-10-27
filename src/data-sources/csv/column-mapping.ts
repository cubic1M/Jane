import { debitCreditCents, normalizeHeader, parseAnyDate, type Layout } from "./formats";
import type { CsvRecord } from "./parse-csv";
import { parseMoneyToCents } from "@/lib/money";

// A CSV that matches no bank's layout (formats.ts): the person says which column is the date,
// the description and the amount (or money out and money in), on /import. Columns are by
// position, 0-based.

export type ColumnMapping = {
  // Whether the first row is column names rather than a transaction.
  hasHeader: boolean;
  date: number;
  description: number;
  amount:
    | { kind: "signed"; column: number; moneyOut: "negative" | "positive" }
    | { kind: "split"; debit: number; credit: number };
};

// What the picker shows for a file: each column with a sample value, and a first guess.
export type MappingChoices = {
  columns: string[];
  hasHeader: boolean;
  guess: {
    date: number | null;
    description: number | null;
    amount: number | null;
    debit: number | null;
    credit: number | null;
  };
};

export const CUSTOM_FORMAT = { id: "custom", label: "Columns you picked" } as const;

const SAMPLE_CHARS = 24;

const find = (headers: string[], pattern: RegExp) => {
  const i = headers.findIndex((h) => pattern.test(h));
  return i === -1 ? null : i;
};

export function mappingChoices(records: CsvRecord[]): MappingChoices {
  const first = records[0]?.fields ?? [];
  // A first row with a date in it is a transaction, not column names.
  const hasHeader = !first.some((value) => parseAnyDate(value) !== null);
  const sampleRow = (hasHeader ? records[1] : records[0])?.fields ?? [];
  const width = Math.max(first.length, sampleRow.length);
  const columns = Array.from({ length: width }, (_, i) => {
    const name = hasHeader && first[i]?.trim() ? first[i].trim() : `Column ${i + 1}`;
    const sample = sampleRow[i]?.trim().slice(0, SAMPLE_CHARS);
    return sample ? `${name} (${sample})` : name;
  });

  // From the values: the first date, the first number after it, the longest text.
  const byValue = guessFromValues(sampleRow);
  if (!hasHeader) return { columns, hasHeader, guess: { ...byValue, debit: null, credit: null } };

  // From the column names, falling back on the values.
  const headers = first.map(normalizeHeader);
  const debit = find(headers, /debit|withdrawal|money out|paid out/);
  const credit = find(headers, /credit|deposit|money in|paid in/);
  const amount = find(headers, /amount/);
  return {
    columns,
    hasHeader,
    guess: {
      date: find(headers, /date/) ?? byValue.date,
      description:
        find(headers, /description|payee|merchant|memo|details|name/) ?? byValue.description,
      amount: amount ?? (debit !== null && credit !== null ? null : byValue.amount),
      debit,
      credit,
    },
  };
}

function guessFromValues(row: string[]) {
  const at = (i: number) => (i === -1 ? null : i);
  const date = at(row.findIndex((v) => parseAnyDate(v) !== null));
  const amount = at(row.findIndex((v, i) => i !== date && parseMoneyToCents(v) !== null));
  let description: number | null = null;
  for (const [i, v] of row.entries()) {
    if (i === date || i === amount || !v.trim()) continue;
    if (description === null || v.trim().length > row[description].trim().length) description = i;
  }
  return { date, description, amount };
}

// The rows read with the person's choices, in the same shape as a bank's layout.
export function mappedLayout(records: CsvRecord[], mapping: ColumnMapping): Layout {
  const width = Math.max(0, ...records.map((r) => r.fields.length));
  const columns = Array.from({ length: width }, (_, i) => `c${i}`);
  const at = (get: (column: string) => string, i: number) => get(`c${i}`);
  return {
    format: {
      ...CUSTOM_FORMAT,
      parseRow(get) {
        const dateText = at(get, mapping.date);
        const date = parseAnyDate(dateText);
        if (!date) return { ok: false, reason: `Unreadable date "${dateText}"` };
        const description = at(get, mapping.description).trim();
        if (!description) return { ok: false, reason: "Missing description" };
        let amountCents: number;
        if (mapping.amount.kind === "split") {
          const cents = debitCreditCents(
            at(get, mapping.amount.debit),
            at(get, mapping.amount.credit),
          );
          if (typeof cents === "string") return { ok: false, reason: cents };
          amountCents = cents;
        } else {
          const text = at(get, mapping.amount.column);
          const cents = parseMoneyToCents(text);
          if (cents === null) return { ok: false, reason: `Unreadable amount "${text}"` };
          // Positive is money out (Plaid's convention).
          amountCents = mapping.amount.moneyOut === "negative" ? -cents || 0 : cents;
        }
        return { ok: true, row: { date, amountCents, description, hints: {} } };
      },
    },
    columns,
    rows: mapping.hasHeader ? records.slice(1) : records,
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
  const amount = column("amount");
  if (amount !== null) {
    const moneyOut = value("out") === "positive" ? "positive" : "negative";
    return { hasHeader, date, description, amount: { kind: "signed", column: amount, moneyOut } };
  }
  const debit = column("debit");
  const credit = column("credit");
  if (debit === null || credit === null) {
    return "Pick the amount column, or both the money out and money in columns.";
  }
  return { hasHeader, date, description, amount: { kind: "split", debit, credit } };
}
