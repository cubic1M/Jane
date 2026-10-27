import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  guessSign,
  mappingChoices,
  mappingFromForm,
  parseAmount,
  type ColumnMapping,
} from "./column-mapping";
import { readCsvFile } from "./csv-source";
import { parseCsv } from "./parse-csv";

function fixture(name: string) {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}

const form = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });

const signed = (
  moneyOut: "negative" | "positive",
  over: Partial<ColumnMapping> = {},
): ColumnMapping => ({
  hasHeader: true,
  date: 0,
  description: 1,
  amount: { kind: "signed", column: 2, moneyOut },
  ...over,
});

const read = (name: string, mapping?: ColumnMapping) =>
  readCsvFile({ name, text: fixture(name), ...(mapping ? { mapping } : {}) });

const rows = (result: ReturnType<typeof readCsvFile>) =>
  result.ok ? result.transactions.map((t) => [t.date, t.amountCents]) : result.error;

describe("an unknown layout", () => {
  it("fails with the columns to pick from and first guesses", () => {
    const result = read("unknown-bank.csv");
    expect(result).toMatchObject({ ok: false, reason: "unknown_format" });
    if (result.ok) return;
    expect(result.choices).toMatchObject({
      columns: ["Date (10/01/2026)", "Payee (Somewhere)", "Debit (5.00)", "Credit"],
      hasHeader: true,
      guess: { date: 0, description: 1, amount: null, debit: 2, credit: 3 },
      // 10/14 settles it: month first.
      dateOrders: { 0: "mdy" },
    });
  });

  it("reads with the columns the person picked: money out and money in", () => {
    const mapping: ColumnMapping = {
      hasHeader: true,
      date: 0,
      description: 1,
      amount: { kind: "split", debit: 2, credit: 3 },
    };
    const result = read("unknown-bank.csv", mapping);
    expect(result.ok && result.format).toEqual({ id: "custom", label: "Columns you picked" });
    expect(rows(result)).toEqual([
      ["2026-10-01", 500],
      ["2026-10-14", -10000],
    ]);
  });

  it("reads one signed amount column, with ISO dates, either sign for money out", () => {
    expect(rows(read("custom-signed.csv", signed("negative")))).toEqual([
      ["2026-09-27", 450],
      ["2026-09-26", -150000],
      ["2026-09-25", 3000],
    ]);
    const positive = read("custom-signed.csv", signed("positive"));
    expect(positive.ok && positive.transactions[0].amountCents).toBe(-450);
  });

  it("says in plain words what's wrong when the picked columns read no rows", () => {
    const result = read("custom-signed.csv", signed("negative", { date: 1, description: 0 }));
    expect(result).toMatchObject({
      ok: false,
      reason: "unknown_format",
      error:
        'None of the rows could be read with those columns. On line 2, "COFFEE PLACE" in the date column isn\'t a date Jane can read.',
    });
    expect(!result.ok && result.choices).toBeTruthy();
  });

  it("treats a first row with a date in it as data, not column names", () => {
    const choices = mappingChoices(parseCsv("2026-09-01,Coffee shop downtown,-4.50\n"));
    expect(choices).toMatchObject({
      columns: ["Column 1 (2026-09-01)", "Column 2 (Coffee shop downtown)", "Column 3 (-4.50)"],
      hasHeader: false,
      guess: { date: 0, description: 1, amount: 2, debit: null, credit: null },
    });
  });
});

describe("day or month first", () => {
  it("reads a day-first file from its 13th and 14th, never 05/09 as May 9", () => {
    const result = read("day-first.csv");
    expect(!result.ok && result.choices?.dateOrders).toEqual({ 0: "dmy" });
    expect(!result.ok && result.choices?.signs[2]?.moneyOut).toBe("negative");
    expect(rows(read("day-first.csv", signed("negative")))).toEqual([
      ["2026-09-14", 2340],
      ["2026-09-13", -210000],
      ["2026-09-05", 1099],
    ]);
  });

  it("asks when the dates can't tell, and reads them once told", () => {
    const result = read("ambiguous-dates.csv");
    expect(!result.ok && result.choices?.dateOrders).toEqual({ 0: "unknown" });
    expect(read("ambiguous-dates.csv", signed("negative"))).toMatchObject({
      ok: false,
      error:
        "Jane can't tell from this file whether 05/09/2026 is month first or day first. Say how the dates are written.",
    });
    expect(rows(read("ambiguous-dates.csv", signed("negative", { dateOrder: "dmy" })))).toEqual([
      ["2026-09-05", 450],
      ["2026-09-06", 1200],
    ]);
    expect(rows(read("ambiguous-dates.csv", signed("negative", { dateOrder: "mdy" })))).toEqual([
      ["2026-05-09", 450],
      ["2026-06-09", 1200],
    ]);
  });
});

describe("which sign is spending", () => {
  it("guesses positive for a file where spending is positive, and says why", () => {
    const result = read("spending-positive.csv");
    expect(!result.ok && result.choices?.signs[2]).toEqual({
      moneyOut: "positive",
      why: 'From rows like "WHOLE FOODS MARKET"',
    });
  });

  it("goes by most rows when no merchant says, and asks when it's even", () => {
    const table = (amounts: string[]) => amounts.map((a) => ["2026-09-01", "THING", a]);
    expect(guessSign(table(["-1.00", "-2.00", "3.00"]), 2, 1)).toEqual({
      moneyOut: "negative",
      why: "Most rows are negative",
    });
    expect(guessSign(table(["1.00", "2.00", "-3.00"]), 2, 1)).toEqual({
      moneyOut: "positive",
      why: "Most rows are positive",
    });
    expect(guessSign(table(["1.00", "-2.00"]), 2, 1)).toEqual({
      moneyOut: null,
      why: "The rows don't say which",
    });
  });

  it("lets pay going in outweigh most rows", () => {
    const table = [
      ["2026-09-01", "ACME CORP PAYROLL", "-2500.00"],
      ["2026-09-02", "THING", "-1.00"],
      ["2026-09-03", "OTHER THING", "-2.00"],
    ];
    expect(guessSign(table, 2, 1).moneyOut).toBe("positive");
  });
});

describe("semicolons, decimal commas and written-out dates", () => {
  it("reads a semicolon file with dates like Sep 5, 2026", () => {
    const result = read("semicolons.csv");
    expect(result).toMatchObject({ ok: false, reason: "unknown_format" });
    if (result.ok) return;
    expect(result.choices).toMatchObject({
      columns: ["Datum (Sep 5, 2026)", "Beschreibung (REWE MARKT)", "Betrag (-23,40)"],
      guess: { date: 0, description: 1, amount: 2 },
      signs: { 2: { moneyOut: "negative" } },
    });
    expect(rows(read("semicolons.csv", signed("negative")))).toEqual([
      ["2026-09-05", 2340],
      ["2026-09-03", -210000],
      ["2026-09-01", 95000],
    ]);
  });

  it("parses amounts with currency signs and decimal commas", () => {
    expect(parseAmount("€12,50")).toBe(1250);
    expect(parseAmount("1.234,56")).toBe(123456);
    expect(parseAmount("-23,40")).toBe(-2340);
    expect(parseAmount("12.50 USD")).toBe(1250);
    expect(parseAmount("1,234.56")).toBe(123456);
    expect(parseAmount("twelve")).toBeNull();
  });
});

describe("a running balance column", () => {
  const text =
    "Date,Description,Withdrawal,Deposit,Balance\n" +
    "10/14/2026,COFFEE,4.50,,995.50\n" +
    "10/13/2026,PAYCHECK,,500.00,1000.00\n";

  it("is guessed from its name, and its balances kept with the rows", () => {
    const first = readCsvFile({ name: "golden1-export.csv", text });
    expect(!first.ok && first.choices?.guess).toMatchObject({ debit: 2, credit: 3, balance: 4 });
    const read = readCsvFile({
      name: "golden1-export.csv",
      text,
      mapping: {
        hasHeader: true,
        date: 0,
        description: 1,
        amount: { kind: "split", debit: 2, credit: 3 },
        balance: 4,
      },
    });
    expect(read.ok && read.balances).toEqual([
      { date: "2026-10-13", balanceCents: 100000 },
      { date: "2026-10-14", balanceCents: 99550 },
    ]);
    // A layout Jane doesn't know: the new account is named from the file.
    expect(read.ok && read.account).toEqual({ name: "Golden1", kind: "checking" });
  });
});

describe("mappingFromForm", () => {
  it("is null when the picker wasn't shown for that file", () => {
    expect(mappingFromForm(form({}), 0)).toBeNull();
  });

  it("reads a signed amount, the date order and the header switch", () => {
    expect(
      mappingFromForm(
        form({
          "map.1.date": "0",
          "map.1.dates": "dmy",
          "map.1.description": "1",
          "map.1.amount": "2",
          "map.1.out": "positive",
          "map.1.header": "1",
        }),
        1,
      ),
    ).toEqual({
      hasHeader: true,
      date: 0,
      dateOrder: "dmy",
      description: 1,
      amount: { kind: "signed", column: 2, moneyOut: "positive" },
    });
  });

  it("reads an optional running balance column", () => {
    expect(
      mappingFromForm(
        form({
          "map.0.date": "0",
          "map.0.description": "1",
          "map.0.debit": "2",
          "map.0.credit": "3",
          "map.0.balance": "4",
        }),
        0,
      ),
    ).toMatchObject({ balance: 4 });
  });

  it("reads money out and money in columns when there's no amount column", () => {
    expect(
      mappingFromForm(
        form({
          "map.0.date": "0",
          "map.0.description": "1",
          "map.0.amount": "",
          "map.0.debit": "2",
          "map.0.credit": "3",
        }),
        0,
      ),
    ).toEqual({
      hasHeader: false,
      date: 0,
      description: 1,
      amount: { kind: "split", debit: 2, credit: 3 },
    });
  });

  it("says what's missing, including which sign is spending", () => {
    expect(mappingFromForm(form({ "map.0.date": "" }), 0)).toBe("Pick the date column.");
    expect(mappingFromForm(form({ "map.0.date": "0" }), 0)).toBe("Pick the description column.");
    expect(
      mappingFromForm(form({ "map.0.date": "0", "map.0.description": "1", "map.0.debit": "2" }), 0),
    ).toBe("Pick the amount column, or both the money out and money in columns.");
    expect(
      mappingFromForm(
        form({ "map.0.date": "0", "map.0.description": "1", "map.0.amount": "2", "map.0.out": "" }),
        0,
      ),
    ).toBe("Say whether money you spent shows as a negative or a positive number.");
    expect(mappingFromForm(form({ "map.0.date": "-1", "map.0.description": "1" }), 0)).toBe(
      "Pick the date column.",
    );
  });
});
