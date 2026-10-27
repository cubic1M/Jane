import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mappingChoices, mappingFromForm, type ColumnMapping } from "./column-mapping";
import { readCsvFile } from "./csv-source";
import { parseCsv } from "./parse-csv";

function fixture(name: string) {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");
}

const form = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });

describe("an unknown layout", () => {
  it("fails with the columns to pick from and a first guess", () => {
    const result = readCsvFile({ name: "bank.csv", text: fixture("unknown-bank.csv") });
    expect(result).toMatchObject({ ok: false, reason: "unknown_format" });
    if (result.ok) return;
    expect(result.choices).toEqual({
      columns: ["Date (10/01/2026)", "Payee (Somewhere)", "Debit (5.00)", "Credit"],
      hasHeader: true,
      guess: { date: 0, description: 1, amount: null, debit: 2, credit: 3 },
    });
  });

  it("reads with the columns the person picked: money out and money in", () => {
    const mapping: ColumnMapping = {
      hasHeader: true,
      date: 0,
      description: 1,
      amount: { kind: "split", debit: 2, credit: 3 },
    };
    const result = readCsvFile({ name: "bank.csv", text: fixture("unknown-bank.csv"), mapping });
    expect(result.ok && result.format).toEqual({ id: "custom", label: "Columns you picked" });
    expect(result.ok && result.transactions.map((t) => [t.date, t.amountCents])).toEqual([
      ["2026-10-01", 500],
    ]);
  });

  it("reads one signed amount column, with ISO dates, either sign for money out", () => {
    const text = fixture("custom-signed.csv");
    const signed = (moneyOut: "negative" | "positive") =>
      readCsvFile({
        name: "x.csv",
        text,
        mapping: {
          hasHeader: true,
          date: 0,
          description: 1,
          amount: { kind: "signed", column: 2, moneyOut },
        },
      });
    const negative = signed("negative");
    expect(negative.ok && negative.transactions.map((t) => [t.date, t.amountCents])).toEqual([
      ["2026-09-27", 450],
      ["2026-09-26", -150000],
      ["2026-09-25", 3000],
    ]);
    const positive = signed("positive");
    expect(positive.ok && positive.transactions[0].amountCents).toBe(-450);
  });

  it("says so when the picked columns read no rows", () => {
    const result = readCsvFile({
      name: "x.csv",
      text: fixture("custom-signed.csv"),
      mapping: {
        hasHeader: true,
        date: 1,
        description: 0,
        amount: { kind: "signed", column: 2, moneyOut: "negative" },
      },
    });
    expect(result).toMatchObject({ ok: false, reason: "unknown_format" });
    expect(!result.ok && result.choices).toBeTruthy();
  });

  it("treats a first row with a date in it as data, not column names", () => {
    const choices = mappingChoices(parseCsv("2026-09-01,Coffee shop downtown,-4.50\n"));
    expect(choices).toEqual({
      columns: ["Column 1 (2026-09-01)", "Column 2 (Coffee shop downtown)", "Column 3 (-4.50)"],
      hasHeader: false,
      guess: { date: 0, description: 1, amount: 2, debit: null, credit: null },
    });
  });
});

describe("mappingFromForm", () => {
  it("is null when the picker wasn't shown for that file", () => {
    expect(mappingFromForm(form({}), 0)).toBeNull();
  });

  it("reads a signed amount and the header switch", () => {
    expect(
      mappingFromForm(
        form({
          "map.1.date": "0",
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
      description: 1,
      amount: { kind: "signed", column: 2, moneyOut: "positive" },
    });
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

  it("says what's missing", () => {
    expect(mappingFromForm(form({ "map.0.date": "" }), 0)).toBe("Pick the date column.");
    expect(mappingFromForm(form({ "map.0.date": "0" }), 0)).toBe("Pick the description column.");
    expect(
      mappingFromForm(form({ "map.0.date": "0", "map.0.description": "1", "map.0.debit": "2" }), 0),
    ).toBe("Pick the amount column, or both the money out and money in columns.");
    expect(mappingFromForm(form({ "map.0.date": "-1", "map.0.description": "1" }), 0)).toBe(
      "Pick the date column.",
    );
  });
});
