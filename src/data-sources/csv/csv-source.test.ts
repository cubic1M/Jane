import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CsvDataSource, CsvFormatError, readCsvFile } from "./csv-source";

// Fixtures are made-up transactions in Chase's export layouts, not real data.
function fixture(name: string) {
  return { name, text: readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8") };
}

const ACCOUNT = {
  ref: "acct_1",
  name: "Chase checking",
  kind: "checking" as const,
  mask: null,
  currentBalanceCents: 250000,
};

describe("Chase checking export", () => {
  const result = readCsvFile(fixture("chase-checking.csv"));
  if (!result.ok) throw new Error(result.error);

  it("is detected from its header row", () => {
    expect(result.format.id).toBe("chase_checking");
  });

  it("reads every good row, with outflows positive and inflows negative", () => {
    expect(result.transactions).toHaveLength(9);
    expect(result.transactions[0]).toMatchObject({
      date: "2026-10-14",
      amountCents: 1549,
      description: "NETFLIX.COM NETFLIX.COM CA 10/14",
      merchantName: "Netflix",
      pending: false,
      hints: { bankType: "DEBIT_CARD" },
    });
    const payroll = result.transactions.find((t) => t.description.includes("PAYROLL"));
    expect(payroll?.amountCents).toBe(-320000);
  });

  it("skips unreadable rows with the line and a reason", () => {
    expect(result.skipped).toEqual([
      { file: "chase-checking.csv", line: 10, reason: 'Unreadable date "not-a-date"' },
    ]);
  });

  it("keeps two identical coffees on the same day as two rows", () => {
    const coffees = result.transactions.filter((t) => t.merchantName?.startsWith("Blue Bottle"));
    expect(coffees).toHaveLength(2);
    expect(coffees[0].externalId).not.toBe(coffees[1].externalId);
  });
});

describe("Chase credit card export", () => {
  const result = readCsvFile(fixture("chase-credit-card.csv"));
  if (!result.ok) throw new Error(result.error);

  it("is detected from its header row", () => {
    expect(result.format.id).toBe("chase_credit_card");
  });

  it("uses the post date and treats purchases as money out", () => {
    expect(result.transactions[0]).toMatchObject({
      date: "2026-10-13",
      amountCents: 1199,
      merchantName: "Spotify Usa",
      hints: { bankCategory: "Entertainment", bankType: "Sale" },
    });
  });

  it("treats payments and returns as money in", () => {
    const payment = result.transactions.find((t) => t.hints.bankType === "Payment");
    const refund = result.transactions.find((t) => t.hints.bankType === "Return");
    expect(payment?.amountCents).toBe(-85000);
    expect(refund?.amountCents).toBe(-1999);
  });

  it("skips a row with an unreadable amount", () => {
    expect(result.transactions).toHaveLength(6);
    expect(result.skipped).toEqual([
      { file: "chase-credit-card.csv", line: 8, reason: 'Unreadable amount "abc"' },
    ]);
  });
});

describe("readCsvFile", () => {
  it("rejects an unknown format with a readable message instead of crashing", () => {
    const result = readCsvFile(fixture("unknown-bank.csv"));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("don't recognize this file's format");
    expect(result.error).toContain("Chase checking or savings");
    expect(result.error).toContain("Date, Payee, Debit, Credit");
  });

  it("rejects an empty file", () => {
    expect(readCsvFile({ name: "empty.csv", text: "\n\n" })).toEqual({
      ok: false,
      file: "empty.csv",
      error: "The file is empty.",
    });
  });

  it("rejects a file that isn't valid CSV", () => {
    const result = readCsvFile({ name: "bad.csv", text: 'a,"b\n' });
    expect(result.ok).toBe(false);
  });

  it("skips rows with too few or too many columns", () => {
    const text =
      "Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n" +
      "10/01/2026,10/01/2026,Short row\n" +
      "10/01/2026,10/01/2026,Long row,Shopping,Sale,-1.00,,surprise\n";
    const result = readCsvFile({ name: "card.csv", text });

    expect(result.ok && result.skipped.map((s) => s.reason)).toEqual([
      "Expected 7 columns, found 3",
      "Expected 7 columns, found 8",
    ]);
  });

  it("gives the same keys when the same file is read twice", () => {
    const first = readCsvFile(fixture("chase-checking.csv"));
    const second = readCsvFile(fixture("chase-checking.csv"));

    expect(first.ok && first.transactions.map((t) => t.externalId)).toEqual(
      second.ok && second.transactions.map((t) => t.externalId),
    );
  });
});

describe("CsvDataSource", () => {
  it("produces normalized transactions for the chosen account", async () => {
    const batch = await new CsvDataSource(ACCOUNT, [fixture("chase-checking.csv")]).load();

    expect(batch.accounts).toEqual([ACCOUNT]);
    expect(batch.transactions.every((t) => t.accountRef === "acct_1")).toBe(true);
    expect(batch.skipped).toHaveLength(1);
  });

  it("fails the whole upload when any file has an unknown format", async () => {
    const source = new CsvDataSource(ACCOUNT, [
      fixture("chase-checking.csv"),
      fixture("unknown-bank.csv"),
    ]);

    await expect(source.load()).rejects.toBeInstanceOf(CsvFormatError);
  });
});

describe("OFX and QFX uploads", () => {
  it("reads them through the same path as CSV", () => {
    const text = readFileSync(new URL("../ofx/__fixtures__/card-xml.qfx", import.meta.url), "utf8");
    const result = readCsvFile({ name: "card.qfx", text });
    expect(result).toMatchObject({ ok: true, format: { id: "ofx" } });
    expect(result.ok && result.transactions).toHaveLength(2);
  });
});
